use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use reqwest::blocking::Client;

/// 解析 OpenAI / OpenAI 兼容 provider 的 SSE 流。
///
/// 协议：`POST /v1/chat/completions` 携带 `stream: true`，
/// 响应为 `Content-Type: text/event-stream`，每个事件格式：
///
///   data: {"id":"...","choices":[{"delta":{"content":"..."},...}]}
///
/// 终止标志：单独一行 `data: [DONE]`。
///
/// 4 个家族（OpenAI / DeepSeek / MiniMax / 任意 OpenAI 兼容）共用
/// 同一个 SSE 解析路径——chunk 形状一致。
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
        .json(&body)
        .send()
        .map_err(|e| format!("OpenAI 请求失败：{}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(format!("OpenAI 返回 {}：{}", status, text));
    }

    let text = response.text().map_err(|e| e.to_string())?;
    let mut full_text = String::new();
    let mut usage: Option<Usage> = None;

    for line in text.lines() {
        let Some(payload) = line.strip_prefix("data: ") else {
            continue;
        };
        let payload = payload.trim();
        if payload == "[DONE]" {
            break;
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
            return Err(format!(
                "OpenAI 兼容 provider 返回 {}：{}",
                status, text
            ));
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
///   - 已经以 `/v1` 结尾（OpenAI 官方风格）
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
