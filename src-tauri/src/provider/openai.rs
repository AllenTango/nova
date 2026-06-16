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
use futures_util::StreamExt;
use reqwest::Client;

/// POST {base_url}/chat/completions 带 `stream: true`，逐行解析 SSE。
/// 用 async reqwest + 同步 `block_on` 在已有 tokio runtime 里跑——
/// 完全避开 `reqwest::blocking` 内部 runtime 冲突。
fn stream_openai_chat(
    http: &Client,
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    let rt = tokio::runtime::Handle::current();
    let response = rt.block_on(async {
        http.post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI 请求失败：{}", e))
    })?;

    let status = response.status();
    if !status.is_success() {
        // 错误响应：用 `bytes()` 一次性 read（async runtime 控制），不会
        // 触发 "Cannot drop a runtime in a context where blocking is not allowed"。
        let _ = rt.block_on(async {
            response.bytes().await.map(|_| ()).unwrap_or(())
        });
        return Err(format!("OpenAI 返回 {}", status));
    }

    // 流式逐行读 SSE。直接把 `bytes_stream()` 用 async runtime 消费，
    // 逐 chunk decode UTF-8 然后手动拆行。完全在 async runtime 里跑，
    // 唔用 blocking Read API，避免 "Cannot drop a runtime" panic。
    let mut stream = response.bytes_stream();
    let mut leftover = String::new(); // 半截行跨 chunk 缓存
    let mut full_text = String::new();
    let mut usage: Option<Usage> = None;

    rt.block_on(async {
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result
                .map_err(|e| format!("SSE 读取失败：{}", e))?;
            // 追加到遗留缓冲区
            leftover.push_str(&String::from_utf8_lossy(&chunk));

            // 按 `\n` 拆行；最后一行可能不完整，留到下次 chunk
            let mut lines: Vec<String> = leftover
                .split('\n')
                .map(|s| s.to_string())
                .collect();
            // 最后一截可能不完整
            let tail = lines.pop().unwrap_or_default();
            leftover = tail;

            for line in lines {
                let line = line.trim_end_matches('\r');
                let Some(payload) = line
                    .strip_prefix("data: ")
                    .or_else(|| line.strip_prefix("data:"))
                else {
                    continue;
                };
                let payload = payload.trim();
                if payload == "[DONE]" {
                    return Ok::<_, String>(());
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
                if let Some(u) = json.get("usage") {
                    usage = Some(Usage {
                        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
                        total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
                    });
                }
            }
        }
        Ok::<_, String>(())
    })?;

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
    /// 用 async reqwest + block_on 在已有 tokio runtime 里跑——
    /// 完全避开 `reqwest::blocking` 内部 runtime 冲突。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        let url = resolve_chat_url(&self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
        });

        let rt = tokio::runtime::Handle::current();
        let (status, text) = rt.block_on(async {
            let resp = self
                .http
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = resp.status();
            let text = resp.text().await.map_err(|e| e.to_string())?;
            Ok::<_, String>((status, text))
        })?;

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
