use crate::provider::{ChatRequest, ChatResponse, LLMClient};
use reqwest::blocking::Client;

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

    pub fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
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
}

impl LLMClient for GoogleClient {
    fn provider_name(&self) -> &str {
        "google"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat(request)
    }
}
