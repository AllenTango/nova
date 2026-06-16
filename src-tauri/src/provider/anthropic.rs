//! Anthropic 家族 + Anthropic 兼容家族（Custom: anthropic_compat）嘅流式 chat。
//!
//! 协议：`POST {base_url}/v1/messages` 携带 `stream: true`，响应为
//! `Content-Type: text/event-stream`。Anthropic 嘅 SSE 与 OpenAI
//! 不同——它是 **event-based** 格式：
//!
//!   event: message_start
//!   data: {"type":"message_start","message":{...}}
//!
//!   event: content_block_start
//!   data: {"type":"content_block_start",...}
//!
//!   event: content_block_delta
//!   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
//!
//!   event: content_block_stop
//!   data: {...}
//!
//!   event: message_delta
//!   data: {"type":"message_delta","delta":{...},"usage":{"output_tokens":N}}
//!
//!   event: message_stop
//!   data: {"type":"message_stop"}
//!
//! 终止标志：`message_stop`。
//!
//! 覆盖 4 家族中嘅：
//!   - Anthropic（官方 api.anthropic.com）
//!   - Custom（kind=anthropic_compat，base_url 由用户填——例如
//!     `https://api.minimaxi.com/anthropic` 之类 Anthropic 兼容服务）
//!
//! 实现要点（基于对 Mini-Agent `anthropic_client.py` 嘅理解）：
//!   - 必须 BufReader + read_line 流式逐行读，**不可**一次性
//!     `response.text()`——Anthropic 兼容服务（特别是 minimaxi 之类）
//!     嘅 SSE 边界会 lazy flush 导致 hang。
//!   - event/data 两行配对累积 payload，遇空行时一次解析。
//!   - 错误响应走 `response.text()` 一次性读（非流式）。
//!   - 必传 header：`x-api-key` + `anthropic-version: 2023-06-01`。
//!
//! 历史曾有 `ANTHROPIC_MODELS` 11 条硬编码常量——已彻底移除。
//! 全部走 `GET /v1/models` 实时拉取。

use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::io::{BufRead, BufReader};

/// 从 Anthropic 的 `/v1/models` 端点拉取实时模型列表。
///
/// 与 OpenAI 的 `/v1/models` 同形——返回 `{ "data": [{ "id": "..." }, ...] }`。
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };

    let client = Client::new();
    let response = client
        .get(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Anthropic 模型列表请求失败：{} - {}", status, text));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Anthropic 模型列表返回了非法 JSON：{}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or("Anthropic 模型列表响应缺少 data 数组")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

pub struct AnthropicClient {
    api_key: String,
    base_url: String,
    http: Client,
}

impl AnthropicClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
            http: Client::new(),
        }
    }

    /// 流式 chat：POST `/v1/messages` 带 `stream: true`，按 event-based
    /// SSE 逐块把 `content_block_delta` 事件的 `delta.text` 推给
    /// `on_delta`。终止事件 `message_stop` 后再尝试取一次
    /// `message_delta.usage`（Anthropic 把 usage 放在终止事件里）。
    fn chat_stream_inner(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/v1/messages", self.base_url);

        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
            "stream": true,
        });

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .header("Accept", "text/event-stream")
            .json(&body)
            .send()
            .map_err(|e| format!("Anthropic 请求失败：{}", e))?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            return Err(format!("Anthropic 返回 {}：{}", status, text));
        }

        let mut full_text = String::new();
        let mut usage: Option<Usage> = None;

        // Anthropic SSE 事件类型：
        //   message_start        - 含 message id/model/usage.input_tokens
        //   content_block_start
        //   content_block_delta  - 含 delta.text（要流出去的内容）
        //   content_block_stop
        //   message_delta        - 含 usage.output_tokens
        //   message_stop         - 终止
        //   ping                 - 心跳，忽略
        // 我们关心的是 content_block_delta 里的 text 与 message_delta
        // 里的 usage。
        //
        // 协议：每个事件由 `event: NAME` + `data: JSON` + 空行 组成。
        // 多行 data 用 `data: X\ndata: Y` 累积（罕见但 SSE 标准允许）。
        let mut reader = BufReader::new(response);
        let mut buf = String::new();
        let mut event_name = String::new();
        let mut data_lines: Vec<String> = Vec::new();

        loop {
            buf.clear();
            let n = reader
                .read_line(&mut buf)
                .map_err(|e| format!("Anthropic SSE 读取失败：{}", e))?;
            if n == 0 {
                break; // 流结束
            }
            let line = buf.trim_end();
            if let Some(rest) = line
                .strip_prefix("event: ")
                .or_else(|| line.strip_prefix("event:"))
            {
                event_name = rest.trim().to_string();
                continue;
            }
            if let Some(rest) = line
                .strip_prefix("data: ")
                .or_else(|| line.strip_prefix("data:"))
            {
                data_lines.push(rest.trim().to_string());
                continue;
            }
            // 空行 = 事件边界，把累积的 data 解析一次
            if line.is_empty() && !data_lines.is_empty() {
                let payload = data_lines.join("\n");
                data_lines.clear();
                let json: serde_json::Value = match serde_json::from_str(&payload) {
                    Ok(v) => v,
                    Err(_) => {
                        event_name.clear();
                        continue;
                    }
                };
                match event_name.as_str() {
                    "content_block_delta" => {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            full_text.push_str(text);
                            on_delta(text)?;
                        }
                    }
                    "message_delta" => {
                        if let Some(u) = json["usage"].as_object() {
                            let input = u
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32;
                            let output = u
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32;
                            usage = Some(Usage {
                                prompt_tokens: input,
                                completion_tokens: output,
                                total_tokens: input + output,
                            });
                        }
                    }
                    "message_stop" => {
                        // 终止事件，立即结束读取
                        event_name.clear();
                        return Ok(ChatResponse {
                            content: full_text,
                            model: request.model,
                            usage,
                        });
                    }
                    _ => {}
                }
                event_name.clear();
            }
        }

        Ok(ChatResponse {
            content: full_text,
            model: request.model,
            usage,
        })
    }

    /// 非流式 fallback：调 `/v1/messages` 不带 `stream`，一次性返回。
    /// 保留给 `chat()` 调用方（list_models 等不走流式）。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        #[derive(Deserialize)]
        struct AnthropicUsage {
            input_tokens: Option<u32>,
            output_tokens: Option<u32>,
        }

        let url = format!("{}/v1/messages", self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
        });

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = response.json().map_err(|e| e.to_string())?;
        let content = json["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let usage = json
            .get("usage")
            .and_then(|u| serde_json::from_value::<AnthropicUsage>(u.clone()).ok())
            .map(|u| Usage {
                prompt_tokens: u.input_tokens.unwrap_or(0),
                completion_tokens: u.output_tokens.unwrap_or(0),
                total_tokens: u.input_tokens.unwrap_or(0) + u.output_tokens.unwrap_or(0),
            });

        Ok(ChatResponse {
            content,
            model: request.model,
            usage,
        })
    }
}

impl LLMClient for AnthropicClient {
    fn provider_name(&self) -> &str {
        "anthropic"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat_blocking(request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        self.chat_stream_inner(request, on_delta)
    }
}
