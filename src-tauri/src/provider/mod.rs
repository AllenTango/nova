pub mod config;
pub mod openai;
pub mod anthropic;
pub mod google;
pub mod ollama;

use serde::{Deserialize, Serialize};

use crate::provider::config::get_provider_config;
use reqwest::blocking::Client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

pub trait LLMClient: Send + Sync {
    fn provider_name(&self) -> &str;
    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String>;
}

pub struct ProviderFactory;

impl ProviderFactory {
    /// Create an LLM client. Credentials come from the caller — there is
    /// no env-var fallback. Settings UI is the only place where a key is
    /// captured, and it lands in `~/.nova/config.json::provider_secrets`
    /// before the chat layer asks for it.
    ///
    /// Priority chain (highest to lowest):
    /// 1. explicit_api_key / explicit_base_url (caller-provided)
    /// 2. Provider defaults (base_url only; api_key is required)
    pub fn create_client(
        provider: &str,
        explicit_api_key: Option<&str>,
        explicit_base_url: Option<&str>,
    ) -> Result<Box<dyn LLMClient>, String> {
        let config = get_provider_config(provider)
            .ok_or_else(|| format!("Unknown provider: {provider}"))?;

        let resolved_base_url = explicit_base_url
            .filter(|u| !u.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| config.default_base_url.to_string());
        let resolved_api_key = explicit_api_key
            .filter(|k| !k.is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("No API key provided for provider: {provider}"))?;

        match config.transport {
            config::TransportType::OpenAIChat => Ok(Box::new(openai::OpenAIClient::new(
                &resolved_api_key,
                &resolved_base_url,
            ))),
            config::TransportType::AnthropicMessages => Ok(Box::new(
                anthropic::AnthropicClient::new(&resolved_api_key, &resolved_base_url),
            )),
            config::TransportType::GoogleGenerative => Ok(Box::new(google::GoogleClient::new(
                &resolved_api_key,
                &resolved_base_url,
            ))),
            config::TransportType::OllamaNative => Ok(Box::new(ollama::OllamaClient::new(
                &resolved_api_key,
                &resolved_base_url,
            ))),
        }
    }

    /// List available models for a provider. The caller MUST supply an
    /// api_key (when the provider requires one); we do NOT consult the
    /// process environment for credentials.
    ///
    /// - OpenAI / OpenAI-compatible → GET /v1/models
    /// - Google Gemini → GET /v1beta/models
    /// - Ollama → GET /api/tags
    /// - Anthropic → hard-coded list
    pub fn list_models(
        provider: &str,
        explicit_api_key: Option<&str>,
        explicit_base_url: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let config = get_provider_config(provider)
            .ok_or_else(|| format!("Unknown provider: {provider}"))?;

        let resolved_base_url = explicit_base_url
            .filter(|u| !u.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| config.default_base_url.to_string());
        let resolved_api_key = explicit_api_key
            .filter(|k| !k.is_empty())
            .map(str::to_string);

        match config.transport {
            config::TransportType::OpenAIChat => {
                list_models_openai_compatible(&resolved_base_url, resolved_api_key.as_deref())
            }
            config::TransportType::GoogleGenerative => {
                list_models_google(&resolved_base_url)
            }
            config::TransportType::OllamaNative => {
                list_models_ollama(&resolved_base_url)
            }
            config::TransportType::AnthropicMessages => {
                Ok(anthropic::ANTHROPIC_MODELS.iter().map(|s| s.to_string()).collect())
            }
        }
    }
}

fn list_models_openai_compatible(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    // Some base URLs already include /v1 (e.g. https://api.openai.com/v1),
    // others are bare roots (e.g. https://localhost:11434). Detect and
    // only append /v1 when the base doesn't already have it.
    let url = if base.contains("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };
    let client = Client::new();
    let mut req = client.get(&url).header("Content-Type", "application/json");
    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }
    let response = req.send().map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Failed to list models: {} - {}", status, text));
    }
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON from models endpoint: {}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or("Missing 'data' array in models response")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

fn list_models_google(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/models?key={}", base_url.trim_end_matches('/'), "");
    let client = Client::new();
    let response = client.get(&url).send().map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Failed to list Google models: {} - {}", status, text));
    }
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON from Google models endpoint: {}", e))?;
    let models = json["models"]
        .as_array()
        .ok_or("Missing 'models' array in Google models response")?
        .iter()
        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

fn list_models_ollama(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let client = Client::new();
    let response = client.get(&url).send().map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Failed to list Ollama models: {} - {}", status, text));
    }
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Invalid JSON from Ollama tags endpoint: {}", e))?;
    let models = json["models"]
        .as_array()
        .ok_or("Missing 'models' array in Ollama response")?
        .iter()
        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}