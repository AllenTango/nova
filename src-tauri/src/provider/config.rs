#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthType {
    ApiKey,
}

/// Transport type determines the API protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportType {
    OpenAIChat,          // POST /v1/chat/completions, Bearer token
    AnthropicMessages,   // POST /v1/messages, x-api-key header
    GoogleGenerative,    // POST /v1beta/models/...:generateContent, API key in query
    OllamaNative,        // POST /api/chat
}

/// Provider configuration with default URLs and env var names
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    /// Unique identifier (e.g., "openai", "anthropic", "google")
    pub id: &'static str,
    /// Human-readable name
    pub name: &'static str,
    /// Authentication type
    pub auth_type: AuthType,
    /// Default base URL for API requests
    pub default_base_url: &'static str,
    /// Environment variable for base_url override (e.g., "OPENAI_BASE_URL")
    pub base_url_env_var: Option<&'static str>,
    /// Environment variables to check for API key (in priority order)
    pub api_key_env_vars: &'static [&'static str],
    /// Transport protocol
    pub transport: TransportType,
    /// Aliases (alternative names that resolve to this provider)
    pub aliases: &'static [&'static str],
}

/// Provider registry - all supported providers
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

/// Look up a provider config by id or alias
pub fn get_provider_config(id: &str) -> Option<&'static ProviderConfig> {
    let id_lower = id.to_lowercase();
    PROVIDER_REGISTRY
        .iter()
        .find(|p| p.id == id_lower || p.aliases.iter().any(|&a| a == id_lower))
}