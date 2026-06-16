//! OpenAI 家族 + OpenAI 兼容家族（Custom: openai_compat）嘅流式 chat。
//!
//! 协议：`POST {base_url}/chat/completions` 携带 `stream: true`，
//! 响应为 `Content-Type: text/event-stream`，每条事件格式：
//!
//!   data: {"id":"...","choices":[{"delta":{"content":"..."},...}]}
//!
//! 终止标志：单独一行 `data: [DONE]`。
//!
//! 覆盖 4 家族中嘅：
//!   - OpenAI（官方 api.openai.com）
//!   - Custom（kind=openai_compat，base_url 由用户填——例如
//!     `https://api.minimaxi.com/v1`、DeepSeek、本地 Ollama OpenAI
//!     兼容层等）
//!
//! 实现要点（基于对 Mini-Agent `openai_client.py` 嘅理解 + Nova
//! 之前诊断嘅实际 SSE 行为）：
//!   - 必须 BufReader + read_line 流式逐行读，**不可**一次性
//!     `response.text()`——MiniMax/DeepSeek 嘅 chunk 边界会 lazy
//!     flush 导致 hang。
//!   - 同时兼容 `data: {...}` 和 `data:{...}` 两种前缀。
//!   - 错误响应走 `response.text()` 一次性读（非流式）。
//!   - `Accept: text/event-stream` header 帮助部分 server 走 SSE 模式。

use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use reqwest::blocking::Client;
use std::io::{BufRead, BufReader};

/// POST {base_url}/chat/completions 带 `stream: true`，逐行解析 SSE。
fn stream_openai_chat(
    http: &Client,
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    let response = http
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(|e| format!("OpenAI 请求失败：{}", e))?;

    let status = response.status();
    if !status.is_success() {
        // 错误响应一次性读 body
        let text = response.text().unwrap_or_default();
        return Err(format!("OpenAI 返回 {}：{}", status, text));
    }

    // 流式逐行读 SSE。`reqwest::blocking::Response` 本身实现 `Read`，
    // 直接包 BufReader。每行 read_line 一到就解 chunk 推 delta，
    // 唔等 chunked transfer 关闭。
    let mut reader = BufReader::new(response);
    let mut buf = String::new();
    let mut full_text = String::new();
    let mut usage: Option<Usage> = None;

    loop {
        buf.clear();
        let n = reader
            .read_line(&mut buf)
            .map_err(|e| format!("SSE 读取失败：{}", e))?;
        if n == 0 {
            // 流结束
            break;
        }
        let line = buf.trim_end();
        // 同时兼容 "data: {...}" 和 "data:{...}"（部分 server 唔带空格）
        let Some(payload) = line
            .strip_prefix("data: ")
            .or_else(|| line.strip_prefix("data:"))
        else {
            continue;
        };
        let payload = payload.trim();
        if payload == "[DONE]" {
            break;
        }
        if payload.is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(_) => continue, // 跳过心跳/空行/格式异常行
        };
        if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
            if !delta.is_empty() {
                full_text.push_str(delta);
                on_delta(delta)?;
            }
        }
        // 部分 OpenAI 兼容实现（如 DeepSeek）把 usage 放进最后一个 chunk
        if let Some(u) = json.get("usage") {
            usage = Some(Usage {
                prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
            });
        }
    }

    Ok(ChatResponse {
        content: full_text,
        model: body["model"].as_str().unwrap_or("").to_string(),
        usage,
    })
}

pub struct OpenAIClient {
    api_key: String,
    base_url: String,
    http: Client,
}

impl OpenAIClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
            http: Client::new(),
        }
    }

    /// 非流式 fallback：调 `/v1/chat/completions` 不带 `stream`，
    /// 一次性返回。供 `chat()` 走测试 / list_models 等不走流式的场景。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        let url = resolve_chat_url(&self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
        });

        let response = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let status = response.status();
        let text = response.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("OpenAI 兼容 provider 返回 {}：{}", status, text));
        }

        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("OpenAI 兼容 provider 返回了非法 JSON：{}\n{}", e, text))?;
        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let usage = json.get("usage").map(|u| Usage {
            prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
        });

        Ok(ChatResponse {
            content,
            model: request.model,
            usage,
        })
    }
}

/// 把 base URL 解析成 `/v1/chat/completions` 完整端点。
/// 兼容三种输入：
///   - 已经以 `/chat/completions` 结尾（用户填了完整端点）
///   - 已经以 `/v1` 结尾（OpenAI 官方风格 / minimaxi 之类）
///   - 裸根（如 `http://127.0.0.1:11434`）
fn resolve_chat_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

impl LLMClient for OpenAIClient {
    fn provider_name(&self) -> &str {
        "openai"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat_blocking(request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let url = resolve_chat_url(&self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
            "stream": true,
        });
        stream_openai_chat(&self.http, &url, &self.api_key, body, on_delta)
    }
}
