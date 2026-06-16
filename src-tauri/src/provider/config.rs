/// 4 个供应商家族（2026-06-16 重构）：
///
///   - OpenAI      → 官方 OpenAI（POST /v1/chat/completions + Bearer）
///   - Anthropic   → 官方 Anthropic（POST /v1/messages + x-api-key）
///   - Custom      → 任何 OpenAI 兼容 或 Anthropic 兼容 嘅第三方
///                   服务商（用户自己填 base_url，Nova 不内置
///                   "Anthropic 兼容"/"OpenAI 兼容" 这种 wrapper 预设）
///   - Ollama      → 本地 Ollama（POST /api/chat + NDJSON 流式）
///
/// 历史曾有 Google (Gemini) 家族——已彻底移除，调用方/UI 都不再支持。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthType {
    ApiKey,
}

/// 传输类型决定 API 协议。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportType {
    /// POST /v1/chat/completions + Bearer。OpenAI 官方 + Custom(OpenAI 兼容)
    /// 共用同一条 transport。
    OpenAIChat,
    /// POST /v1/messages + x-api-key + anthropic-version header。
    /// Anthropic 官方 + Custom(Anthropic 兼容) 共用。
    AnthropicMessages,
    /// POST /api/chat + NDJSON 流式。Ollama 本地服务专用。
    OllamaNative,
}

/// Provider 配置：默认 URL 和鉴权相关元数据。
///
/// **Custom 家族不写死 entry**——它由用户通过 Settings UI 创建
/// （kind=openai_compat 或 anthropic_compat），不通过静态 registry。
/// registry 只覆盖官方固定供应商（OpenAI / Anthropic / Ollama）。
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    /// 唯一标识（如 "openai" / "anthropic" / "ollama"）
    pub id: &'static str,
    /// 用户可见名称（Settings UI 显示）
    pub name: &'static str,
    /// 鉴权类型
    pub auth_type: AuthType,
    /// API 请求的默认 base URL
    pub default_base_url: &'static str,
    /// base_url 覆盖用环境变量名
    pub base_url_env_var: Option<&'static str>,
    /// 按优先级查找的 API key 环境变量列表（仅兜底，Nova 优先从
    /// `~/.nova/config.json::provider_secrets` 读）
    pub api_key_env_vars: &'static [&'static str],
    /// 传输协议
    pub transport: TransportType,
    /// 别名（其他可解析到本 provider 的名字）
    pub aliases: &'static [&'static str],
}

/// 4 家族供应商的静态注册表（Custom 家族不入此表）。
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

/// 按 id 或 alias 查找 provider 配置。Custom 家族不通过此函数——
///// 它由 `providers` 模块动态组装。
pub fn get_provider_config(id: &str) -> Option<&'static ProviderConfig> {
    let id_lower = id.to_lowercase();
    PROVIDER_REGISTRY
        .iter()
        .find(|p| p.id == id_lower || p.aliases.iter().any(|&a| a == id_lower))
}
