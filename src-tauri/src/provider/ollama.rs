use crate::provider::{ChatRequest, ChatResponse, LLMClient};
use reqwest::blocking::Client;

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

    pub fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
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
        self.chat(request)
    }
}
