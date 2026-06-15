#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthType {
    ApiKey,
}

/// 传输类型决定 API 协议
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportType {
    OpenAIChat,        // POST /v1/chat/completions，Bearer token
    AnthropicMessages, // POST /v1/messages，x-api-key header
    GoogleGenerative,  // POST /v1beta/models/...:generateContent，API key 走 query
    OllamaNative,      // POST /api/chat
}

/// Provider 配置：默认 URL 和环境变量名
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    /// 唯一标识（如 "openai" / "anthropic" / "google"）
    pub id: &'static str,
    /// 用户可见名称
    pub name: &'static str,
    /// 鉴权类型
    pub auth_type: AuthType,
    /// API 请求的默认 base URL
    pub default_base_url: &'static str,
    /// base_url 覆盖用环境变量名（如 "OPENAI_BASE_URL"）
    pub base_url_env_var: Option<&'static str>,
    /// 按优先级查找的 API key 环境变量列表
    pub api_key_env_vars: &'static [&'static str],
    /// 传输协议
    pub transport: TransportType,
    /// 别名（其他可解析到本 provider 的名字）
    pub aliases: &'static [&'static str],
}

/// Provider 注册表——所有支持的 provider
pub static PROVIDER_REGISTRY: &[ProviderConfig] = &[
    ProviderConfig {
        id: "openai",
        name: "OpenAI",
        auth_type: AuthType::ApiKey,
        default_base_url: "https://api.openai.com/v1",
        base_url_env_var: Some("OPENAI_BASE_URL"),
        api_key_env_vars: &["OPENAI_API_KEY"],
        transport: TransportType::OpenAIChat,
        aliases: &["openai"],
    },
    ProviderConfig {
        id: "anthropic",
        name: "Anthropic",
        auth_type: AuthType::ApiKey,
        default_base_url: "https://api.anthropic.com",
        base_url_env_var: Some("ANTHROPIC_BASE_URL"),
        api_key_env_vars: &["ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN"],
        transport: TransportType::AnthropicMessages,
        aliases: &["anthropic"],
    },
    ProviderConfig {
        id: "google",
        name: "Google",
        auth_type: AuthType::ApiKey,
        default_base_url: "https://generativelanguage.googleapis.com/v1beta",
        base_url_env_var: Some("GOOGLE_BASE_URL"),
        api_key_env_vars: &["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        transport: TransportType::GoogleGenerative,
        aliases: &["google", "gemini"],
    },
    ProviderConfig {
        id: "ollama",
        name: "Ollama",
        auth_type: AuthType::ApiKey,
        default_base_url: "http://127.0.0.1:11434",
        base_url_env_var: Some("OLLAMA_BASE_URL"),
        api_key_env_vars: &["OLLAMA_API_KEY"],
        transport: TransportType::OllamaNative,
        aliases: &["ollama"],
    },

];

/// 按 id 或 alias 查找 provider 配置
pub fn get_provider_config(id: &str) -> Option<&'static ProviderConfig> {
    let id_lower = id.to_lowercase();
    PROVIDER_REGISTRY
        .iter()
        .find(|p| p.id == id_lower || p.aliases.iter().any(|&a| a == id_lower))
}
