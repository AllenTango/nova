use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback};
use reqwest::blocking::Client;

/// 解析 Google Gemini 的 SSE 流。
///
/// 协议：`POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse`
/// 响应 `Content-Type: text/event-stream`，每个事件为 JSON 对象，
/// 内容在 `candidates[0].content.parts[*].text` 里。
///
/// Gemini 跟 OpenAI 差异点：
///   - URL 是 `:streamGenerateContent` 端点（不是 `streamChat`）
///   - body 结构是 `{ "contents": [...], "generationConfig": {...} }`
///   - chunk 不带 `[DONE]` 终止行；用响应自然结束判断
///   - API key 走 query string `?key=...`（不是 header）
fn stream_google_chat(
    http: &Client,
    base_url: &str,
    model: &str,
    api_key: &str,
    body: serde_json::Value,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    let url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse&key={}",
        base_url.trim_end_matches('/'),
        model,
        api_key
    );

    let response = http
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Google 请求失败：{}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(format!("Google 返回 {}：{}", status, text));
    }

    let text = response.text().map_err(|e| e.to_string())?;
    let mut full_text = String::new();

    // Google SSE 也是 `data: {...}` 形式，但没有 `[DONE]`。
    for line in text.lines() {
        let Some(payload) = line.strip_prefix("data: ") else {
            continue;
        };
        let json: serde_json::Value = match serde_json::from_str(payload.trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(parts) = json["candidates"][0]["content"]["parts"].as_array() {
            for part in parts {
                if let Some(t) = part["text"].as_str() {
                    if !t.is_empty() {
                        full_text.push_str(t);
                        on_delta(t)?;
                    }
                }
            }
        }
    }

    Ok(ChatResponse {
        content: full_text,
        model: model.to_string(),
        usage: None,
    })
}

pub struct GoogleClient {
    api_key: String,
    base_url: String,
    http: Client,
}

impl GoogleClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
            http: Client::new(),
        }
    }

    /// 非流式 fallback：调 `:generateContent`（无 stream 后缀），
    /// 一次性返回。供 `chat()` 走不走流式的场景。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        let url = format!(
            "{}/models/{}:generateContent?key={}",
            self.base_url, request.model, self.api_key
        );

        let contents: Vec<serde_json::Value> = request
            .messages
            .iter()
            .map(|msg| {
                serde_json::json!({
                    "role": if msg.role == "user" { "user" } else { "model" },
                    "parts": [{ "text": msg.content }]
                })
            })
            .collect();

        let body = serde_json::json!({
            "contents": contents,
            "generationConfig": {
                "temperature": request.temperature.unwrap_or(0.7),
                "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            }
        });

        let response = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = response.json().map_err(|e| e.to_string())?;

        let content = json["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            model: request.model,
            usage: None,
        })
    }

    /// 把 OpenAI 风格 `messages` 转成 Gemini `contents` 数组。
    fn messages_to_contents(messages: &[crate::provider::ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .map(|msg| {
                serde_json::json!({
                    "role": if msg.role == "user" { "user" } else { "model" },
                    "parts": [{ "text": msg.content }]
                })
            })
            .collect()
    }
}

impl LLMClient for GoogleClient {
    fn provider_name(&self) -> &str {
        "google"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat_blocking(request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let contents = Self::messages_to_contents(&request.messages);
        let body = serde_json::json!({
            "contents": contents,
            "generationConfig": {
                "temperature": request.temperature.unwrap_or(0.7),
                "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            }
        });
        stream_google_chat(
            &self.http,
            &self.base_url,
            &request.model,
            &self.api_key,
            body,
            on_delta,
        )
    }
}
