use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback};
use reqwest::blocking::Client;

/// 解析 Ollama 的 NDJSON 流（不是标准 SSE）。
///
/// 协议：`POST {base}/api/chat` 携带 `"stream": true`，
/// 响应 `Content-Type: application/x-ndjson`，**每行一个完整 JSON 对象**
/// （不是 `data: {...}` 前缀）。终止判断：每行的 `done` 字段为 true。
///
/// chunk 形状：
///   {"model":"...","message":{"role":"assistant","content":"..."},"done":false}
///   ...
///   {"model":"...","done":true,"total_duration":...}
fn stream_ollama_chat(
    http: &Client,
    url: &str,
    body: serde_json::Value,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    let response = http
        .post(url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Ollama 请求失败：{}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(format!("Ollama 返回 {}：{}", status, text));
    }

    let text = response.text().map_err(|e| e.to_string())?;
    let mut full_text = String::new();
    let mut model_name = String::new();

    for line in text.lines() {
        let line = line.trim();
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
