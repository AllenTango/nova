use crate::provider::{ChatRequest, ChatResponse, LLMClient, Usage};
use reqwest::blocking::Client;

/// Hard-coded list of available Anthropic models
pub const ANTHROPIC_MODELS: &[&str] = &[
    "claude-opus-4-20250514",
    "claude-opus-3-20250220",
    "claude-opus-3-5-20250220",
    "claude-opus-3-5-20241022",
    "claude-sonnet-4-20250514",
    "claude-sonnet-3-20250220",
    "claude-sonnet-3-5-20250220",
    "claude-sonnet-3-5-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-5-haiku-20250220",
    "claude-3-haiku-20240229",
];

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

    pub fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
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
        let usage = json.get("usage").and_then(|u| {
            Some(Usage {
                prompt_tokens: u["input_tokens"].as_u64().unwrap_or(0) as u32,
                completion_tokens: u["output_tokens"].as_u64().unwrap_or(0) as u32,
                total_tokens: u["input_tokens"].as_u64().unwrap_or(0) as u32
                    + u["output_tokens"].as_u64().unwrap_or(0) as u32,
            })
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
        self.chat(request)
    }
}
