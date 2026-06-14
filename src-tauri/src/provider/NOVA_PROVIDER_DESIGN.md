# Nova Provider System

## 架构概览

Nova provider 系统支持"用户自带 API Key + 不限供应商"的桌面应用场景。核心组件：

```
ProviderFactory          — 客户端创建工厂
    │
    ├── config.rs       — PROVIDER_REGISTRY（所有 provider 元配置）
    ├── openai.rs       — OpenAI compatible 客户端
    ├── anthropic.rs    — Anthropic Messages API 客户端
    ├── google.rs       — Google Generative AI 客户端
    └── ollama.rs       — Ollama 原生客户端

providers/mod.rs         — ProviderEntry 列表组装（preset + user）
nova_config.rs           — ~/.nova/config.json 读写（providers + secrets + ports）
```

**凭证源**：`ProviderFactory::create_client(provider, explicit_api_key, explicit_base_url)` 只接受显式参数，不再 fallback 到环境变量。所有凭证由 `providers::resolve_api_key` 从 `~/.nova/config.json::provider_secrets` 读取，由 Settings UI 写入。

## 核心类型

### TransportType

决定 API 协议：

```rust
pub enum TransportType {
    OpenAIChat,        // POST /v1/chat/completions, Bearer token
    AnthropicMessages, // POST /v1/messages, x-api-key header
    GoogleGenerative,  // POST /v1beta/models/...:generateContent, key in query
    OllamaNative,      // POST /api/chat
}
```

### ProviderConfig

每个 provider 的元配置（编译期常量）：

```rust
pub struct ProviderConfig {
    pub id: &'static str,               // 唯一标识符
    pub name: &'static str,             // 显示名
    pub auth_type: AuthType,            // 认证类型
    pub default_base_url: &'static str, // 默认 base URL
    pub transport: TransportType,       // 传输协议
    pub aliases: &'static [&'static str], // 别名
}
```

注：早期版本曾带 `base_url_env_var`/`api_key_env_vars` 字段供 `EnvLoader` 读取，已于 v1.0 移除——凭证来源统一为 `~/.nova/config.json`。

### 凭证优先级

```rust
Priority (highest to lowest):
1. explicit_api_key / explicit_base_url  (调用方直接传入，来自 config.json::provider_secrets)
2. Provider defaults                      (PROVIDER_REGISTRY 中的 default_base_url，仅 base_url)
```

环境变量 (`OPENAI_API_KEY` 等) **不再读取**。如果在 shell 里设置了 `OPENAI_API_KEY`，Nova 会忽略它——必须通过 Settings UI 输入并保存到 `~/.nova/config.json` 才生效。

## ProviderFactory API

### create_client

```rust
pub fn create_client(
    provider: &str,
    explicit_api_key: Option<&str>,
    explicit_base_url: Option<&str>,
) -> Result<Box<dyn LLMClient>, String>
```

`explicit_api_key` 为 `None` 或空字符串时返回 `Err("No API key provided for provider: {provider}")`——云端 preset 必须有 key。`explicit_base_url` 为空时回退到 `default_base_url`。

### list_models

```rust
pub fn list_models(
    provider: &str,
    explicit_api_key: Option<&str>,
    explicit_base_url: Option<&str>,
) -> Result<Vec<String>, String>
```

- OpenAI / OpenAI-compatible → `GET /v1/models`
- Google Gemini → `GET /v1beta/models`
- Ollama → `GET /api/tags`
- Anthropic → 硬编码列表（`ANTHROPIC_MODELS`）

## ProviderEntry 列表组装（providers/mod.rs）

`list_all(app)` 返回给前端的 `Vec<ProviderEntry>`，由三个动作组合：

| 顺序 | 来源 | 写入条件 |
|---|---|---|
| 1 | Preset (OpenAI/Anthropic/Google) | `config.json::provider_secrets[id]` 存在且非空 |
| 2 | User (OpenaiCompat/AnthropicCompat/Ollama) | `config.json::providers[]` 中存在的条目 |

Preset 必须在 Settings UI 输入过 API Key 才会显示——这就是"未配置供应商不出现在列表内"的核心约束。Env source 已彻底移除。

### ProviderEntry 数据契约

```rust
pub struct ProviderEntry {
    pub id: String,
    pub label: String,
    pub family: String,           // 用于 ProviderFactory::create_client
    pub base_url_editable: bool,  // preset = false
    pub api_key_required: bool,   // preset = true，Ollama = false
    pub kind: FamilyKind,         // Preset | OpenaiCompat | AnthropicCompat
    pub base_url: String,
    pub model: String,
    pub models: Vec<ModelEntry>,
    pub source: ProviderSource,   // Preset | User
}
```

### 凭证解析（resolve_api_key）

```rust
pub fn resolve_api_key(app: &AppHandle, id: &str) -> Result<Option<String>, String>
```

仅返回 `config.json::provider_secrets[id]`（非空过滤）。无 env fallback，无 family stripping，无 user-fallback。

## 支持的 Provider

| ID | 名称 | 默认 Base URL | Transport |
|----|------|--------------|-----------|
| `openai` | OpenAI | `https://api.openai.com/v1` | OpenAIChat |
| `anthropic` | Anthropic | `https://api.anthropic.com` | AnthropicMessages |
| `google` / `gemini` | Google | `https://generativelanguage.googleapis.com/v1beta` | GoogleGenerative |
| `ollama` | Ollama | `http://127.0.0.1:11434` | OllamaNative |

注：MiniMax / DeepSeek / Custom 等历史上存在的预设目前**未在 `PROVIDER_REGISTRY` 内**——若需使用，请通过 Settings UI 添加 OpenAI 兼容条目（`kind=openai_compat`），填写对应 Base URL 与 API Key 即可。

## Settings UI 流程

1. 用户点击「添加」→ 打开 picker dialog
2. 选择 family (preset / openai_compat / anthropic_compat / ollama)
3. 填写 ID + Base URL + API Key
4. 点击「获取模型列表」→ `ProviderFactory::list_models(explicit)` 验证凭证
5. 选择一个模型，点击「保存」→
   - preset path: `update_provider({id, base_url, model, api_key})` → 写 `provider_secrets`
   - user path: `add_provider({...})` → 写 `providers[]` + `provider_secrets[]`

## HTTP Server 中的 Provider 处理

HTTP server (`http_server/mod.rs`) 的流式请求不走 `LLMClient` trait，而是通过 `resolve_stream_endpoint()` 直接构建 reqwest 请求：

```rust
fn resolve_stream_endpoint(
    provider: &str,
    base_url: &str,
    api_key: &str,
) -> (url, auth_value, auth_header_type)
```

此函数根据 provider 类型决定：
- OpenAI/OpenAI-compatible → Bearer token, `/v1/chat/completions`
- Anthropic → x-api-key header, `/v1/messages`
- Ollama → 无认证, `/api/chat`
- Google → key in query param

凭证获取同样通过 `providers::resolve_api_key` → `config.json::provider_secrets`。

## 文件清单

| 文件 | 职责 |
|------|------|
| `provider/config.rs` | `PROVIDER_REGISTRY` + `get_provider_config()` |
| `provider/openai.rs` | OpenAI-compatible `LLMClient` 实现 |
| `provider/anthropic.rs` | Anthropic Messages API `LLMClient` 实现 |
| `provider/google.rs` | Google Generative AI `LLMClient` 实现 |
| `provider/ollama.rs` | Ollama native `LLMClient` 实现 |
| `provider/mod.rs` | `ProviderFactory` + `LLMClient` trait + `list_models_*` 函数 |
| `providers/mod.rs` | ProviderEntry 列表组装 + add/update/remove/resolve_api_key |
| `nova_config.rs` | `~/.nova/config.json` 读写 + types (ProviderEntry / FamilyKind / ProviderSource) |
