pub mod config;
pub mod openai;
pub mod anthropic;
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
    /// 若为 true，provider 应当返回 SSE 流式分块。
    /// 尚未实现流式的 provider 可以忽略此字段，把整段响应作为
    /// 单个 delta 推出去——调用方契约一致。
    pub stream: bool,
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

/// 流式回调：流式 provider 推文本 delta 给调用方（一般是 `ai_chat`
/// Tauri command，再透传到 JS 端的 `Channel<ChatEvent>`）。
/// 回调返回 `Err` 时 provider 应停止读取上游 HTTP body 并把错误
/// 透出去。
pub type StreamCallback<'a> = &'a mut dyn FnMut(&str) -> Result<(), String>;

pub trait LLMClient: Send + Sync {
    fn provider_name(&self) -> &str;

    /// 阻塞式单次 chat。永远可用；流式 command 路径在 provider 尚未
    /// 接入流式时也走这个方法作为回退。
    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String>;

    /// 流式 chat。默认实现忽略 `request.stream`，走 `chat()` 一次性
    /// 返回整段响应。原生支持 SSE 的 provider 应 override 此方法以
    /// 推送真实 delta。
    fn chat_stream(&self, request: ChatRequest, on_delta: StreamCallback) -> Result<ChatResponse, String> {
        let _ = on_delta;
        self.chat(request)
    }
}

pub struct ProviderFactory;

impl ProviderFactory {
    /// 创建 LLM 客户端。凭据由调用方传入——没有环境变量回退。
    /// 凭据唯一录入点是 Settings UI，写入 `~/.nova/config.json::provider_secrets`。
    ///
    /// 4 家族供应商路由：
    ///   - OpenAI   → openai::OpenAIClient
    ///   - Anthropic→ anthropic::AnthropicClient
    ///   - Custom   → 按 kind (openai_compat/anthropic_compat) 委托给
    ///                相应 client（base_url 由用户填）
    ///   - Ollama   → ollama::OllamaClient
    pub fn create_client(
        provider: &str,
        explicit_api_key: Option<&str>,
        explicit_base_url: Option<&str>,
    ) -> Result<Box<dyn LLMClient>, String> {
        // 先查静态 registry（OpenAI / Anthropic / Ollama）
        if let Some(config) = get_provider_config(provider) {
            let resolved_base_url = explicit_base_url
                .filter(|u| !u.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| config.default_base_url.to_string());
            let resolved_api_key = explicit_api_key
                .filter(|k| !k.is_empty())
                .map(str::to_string)
                .ok_or_else(|| format!("未提供 {} 的 API Key", provider))?;
            return match config.transport {
                config::TransportType::OpenAIChat => Ok(Box::new(openai::OpenAIClient::new(
                    &resolved_api_key,
                    &resolved_base_url,
                ))),
                config::TransportType::AnthropicMessages => Ok(Box::new(
                    anthropic::AnthropicClient::new(&resolved_api_key, &resolved_base_url),
                )),
                config::TransportType::OllamaNative => {
                    // Ollama 本地服务一般不需 API key，但 client 签名仍
                    // 保留 key 参数用于未来走反向代理加鉴权的场景。
                    Ok(Box::new(ollama::OllamaClient::new(
                        resolved_api_key.as_str(),
                        &resolved_base_url,
                    )))
                }
            };
        }

        // Custom 家族：provider id 形如 "custom-openai-xxx" 或
        // "custom-anthropic-xxx"，由 providers::list_all 返回。
        // 实际 family 路由从 kind 字段读：openai_compat → OpenAI
        // transport；anthropic_compat → Anthropic transport。
        // 调用方应已传入显式 base_url 和 api_key。
        Err(format!("未知 provider：{}", provider))
    }

    /// 列出某 provider 的可用模型。所有 4 家族走实时端点——
    /// 不再有硬编码模型列表。
    ///
    /// - OpenAI / OpenAI 兼容 → GET /v1/models
    /// - Anthropic             → GET /v1/models (x-api-key)
    /// - Ollama                → GET /api/tags
    ///
    /// Custom 家族（openai_compat / anthropic_compat）走对应官方
    /// 端点，但 base_url 用用户填的；list_models 由调用方在
    /// 拿到 provider entry 之后用 base_url 走 `list_models_openai_compatible`
    /// 或 `anthropic::list_models`。
    pub fn list_models(
        provider: &str,
        explicit_api_key: Option<&str>,
        explicit_base_url: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let config = get_provider_config(provider)
            .ok_or_else(|| format!("未知 provider：{}", provider))?;

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
            config::TransportType::OllamaNative => {
                list_models_ollama(&resolved_base_url)
            }
            config::TransportType::AnthropicMessages => {
                let key = resolved_api_key
                    .as_deref()
                    .ok_or_else(|| "Anthropic 需提供 API Key".to_string())?;
                anthropic::list_models(&resolved_base_url, key)
            }
        }
    }
}

pub fn list_models_openai_compatible(
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    // 一些 base URL 已经带 /v1（如 https://api.openai.com/v1），
    // 另一些是裸根（如 https://localhost:11434）。检测后只在
    // base 不带 /v1 时才追加。
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
        return Err(format!("获取模型列表失败：{} - {}", status, text));
    }
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("模型列表端点返回了非法 JSON：{}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or("模型列表响应缺少 data 数组")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

pub fn list_models_ollama(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let client = Client::new();
    let response = client.get(&url).send().map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("获取 Ollama 模型列表失败：{} - {}", status, text));
    }
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Ollama 模型列表返回了非法 JSON：{}", e))?;
    let models = json["models"]
        .as_array()
        .ok_or("Ollama 模型列表响应缺少 models 数组")?
        .iter()
        .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}
