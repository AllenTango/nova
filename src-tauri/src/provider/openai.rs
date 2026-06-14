use crate::provider::{ChatRequest, ChatResponse, Usage, LLMClient};
use reqwest::blocking::Client;

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

    pub fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
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
            return Err(format!("OpenAI-compatible provider returned {}: {}", status, text));
        }

        let json: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Invalid JSON from OpenAI-compatible provider: {}\n{}", e, text))?;

        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let usage = json.get("usage").and_then(|u| {
            Some(Usage {
                prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
            })
        });

        Ok(ChatResponse {
            content,
            model: request.model,
            usage,
        })
    }
}

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
        self.chat(request)
    }
}
