//! Ollama 本地家族嘅流式 chat。
//!
//! 协议：`POST {base}/api/chat` 携带 `"stream": true`，
//! 响应 `Content-Type: application/x-ndjson`（**非**标准 SSE）：
//! 每行一个完整 JSON 对象，无 `data:` 前缀。
//!
//! chunk 形状：
//!   {"model":"...","message":{"role":"assistant","content":"..."},"done":false}
//!   ...
//!   {"model":"...","done":true,"total_duration":...}
//!
//! 终止判断：每行的 `done` 字段为 true。
//!
//! 4 家族中此为 Ollama 本地服务专用——Custom 家族（openai_compat）
//! 嘅 Ollama 入口走 `OpenAIClient` 走 `http://localhost:11434/v1`
//! 嘅 OpenAI 兼容层，与本 native Ollama transport 并存。
//!
//! 实现要点：
//!   - NDJSON 必须 BufReader + read_line 逐行读，**不可**一次性
//!     `response.text()`——Ollama 长输出场景下 chunk 边界会
//!     lazy flush 导致 hang。
//!   - 错误响应走 `response.text()` 一次性读（非流式）。

use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback};
use reqwest::blocking::Client;
use std::io::{BufRead, BufReader};

fn stream_ollama_chat(
    http: &Client,
    url: &str,
    body: serde_json::Value,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    let response = http
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/x-ndjson")
        .json(&body)
        .send()
        .map_err(|e| format!("Ollama 请求失败：{}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(format!("Ollama 返回 {}：{}", status, text));
    }

    // NDJSON 逐行解析。每行一个 JSON 对象，无前缀。
    let mut reader = BufReader::new(response);
    let mut buf = String::new();
    let mut full_text = String::new();
    let mut model_name = String::new();

    loop {
        buf.clear();
        let n = reader
            .read_line(&mut buf)
            .map_err(|e| format!("Ollama NDJSON 读取失败：{}", e))?;
        if n == 0 {
            break; // 流结束
        }
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if model_name.is_empty() {
            if let Some(m) = json["model"].as_str() {
                model_name = m.to_string();
            }
        }
        if let Some(content) = json["message"]["content"].as_str() {
            if !content.is_empty() {
                full_text.push_str(content);
                on_delta(content)?;
            }
        }
        if json["done"].as_bool().unwrap_or(false) {
            break;
        }
    }

    Ok(ChatResponse {
        content: full_text,
        model: model_name,
        usage: None,
    })
}

pub struct OllamaClient {
    #[allow(dead_code)]
    api_key: String,
    base_url: String,
    http: Client,
}

impl OllamaClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
            http: Client::new(),
        }
    }

    /// 非流式 fallback：调 `/api/chat` 不带 `stream`，一次性返回。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        let url = format!("{}/api/chat", self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
        });

        let response = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = response.json().map_err(|e| e.to_string())?;

        let content = json["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            model: request.model,
            usage: None,
        })
    }
}

impl LLMClient for OllamaClient {
    fn provider_name(&self) -> &str {
        "ollama"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat_blocking(request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/api/chat", self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "stream": true,
        });
        stream_ollama_chat(&self.http, &url, body, on_delta)
    }
}
