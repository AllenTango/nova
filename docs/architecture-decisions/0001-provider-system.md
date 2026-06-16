# ADR 0001: Nova Provider System

> **Status**: ✅ Accepted | **Date**: 2026-06-15（2026-06-16 重构：4 family + Custom 合并） | **Scope**: `src-tauri/src/provider/` + `src-tauri/src/providers/` + `src-tauri/src/nova_config.rs`
>
> 原文原位 `src-tauri/src/provider/NOVA_PROVIDER_DESIGN.md` 已迁移至此。
> 历史上嘅 `EnvLoader` / `base_url_env_var` / `api_key_env_vars` / `GoogleGenerative` transport / `provider/google.rs` 等 v1.0 已废弃设计全部省略，仅保留当前事实。

## 架构概览

Nova provider 系统支持"用户自带 API Key + 不限供应商"的桌面应用场景。核心组件：

```
ProviderFactory          — 客户端创建工厂
    │
    ├── config.rs       — PROVIDER_REGISTRY（仅官方 preset 元配置）
    ├── openai.rs       — OpenAI / OpenAI 兼容 客户端
    ├── anthropic.rs    — Anthropic / Anthropic 兼容 客户端
    └── ollama.rs       — Ollama 原生客户端

providers/mod.rs         — ProviderEntry 列表组装（preset + user）
nova_config.rs           — ~/.nova/config.json 读写（providers + secrets + ports）
```

**4 family 分类**：

| Family | 来源 | 实现 client | 典型用例 |
|---|---|---|---|
| OpenAI | Preset | `OpenAIClient` | OpenAI 官方 |
| Anthropic | Preset | `AnthropicClient` | Anthropic 官方 |
| Ollama | Preset | `OllamaClient` | 本地 Ollama |
| Custom | User | 路由到 OpenAI/Anthropic client + 用户 base_url | DeepSeek / 硅基流动 / MiniMax 等 OpenAI 兼容；自部署 Anthropic 兼容转发 |

Custom family **不写死 entry**——它由用户通过 Settings UI 创建（`kind=openai_compat` 或 `anthropic_compat`），不通过静态 `PROVIDER_REGISTRY`。registry 只覆盖 3 个官方 preset。

**凭证源**：`ProviderFactory::create_client(provider, explicit_api_key, explicit_base_url)` 只接受显式参数，不再 fallback 到环境变量。所有凭证由 `providers::resolve_api_key` 从 `~/.nova/config.json::provider_secrets` 读取，由 Settings UI 写入。

## 核心类型

### TransportType

决定 API 协议（仅 3 个，因为 Custom 路由到 OpenAI / Anthropic）：

```rust
pub enum TransportType {
    OpenAIChat,         // POST /v1/chat/completions, Bearer token。OpenAI 官方 + Custom(openai_compat) 共用。
    AnthropicMessages,  // POST /v1/messages, x-api-key header。Anthropic 官方 + Custom(anthropic_compat) 共用。
    OllamaNative,       // POST /api/chat, NDJSON。Ollama 本地服务专用。
}
```

### ProviderConfig

每个 preset 的元配置（编译期常量）。Custom 家族**不入此结构**——它由 `providers` 模块动态组装。

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

### FamilyKind（nova_config.rs）

后端区分 user provider 走哪条协议：

```rust
pub enum FamilyKind {
    Preset,            // 官方 preset（OpenAI/Anthropic/Ollama），仅 Rust 内部用
    OpenaiCompat,      // Custom 走 OpenAI 协议
    AnthropicCompat,   // Custom 走 Anthropic 协议
}
```

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
    provider: &str,           // "openai" | "anthropic" | "ollama" | Custom 的 family
    explicit_api_key: Option<&str>,
    explicit_base_url: Option<&str>,
) -> Result<Box<dyn LLMClient>, String>
```

`explicit_api_key` 为 `None` 或空字符串时返回 `Err("No API key provided for provider: {provider}")`——云端 preset 必须有 key。Ollama 允许空 key。`explicit_base_url` 为空时回退到 `default_base_url`（Custom 用户必填，回退只对 preset 生效）。

**Custom 路由逻辑**：Custom family 的 `provider` 字符串是 user-defined id（例：`"minimax"`），但 `create_client` 内部按 `kind` 字段路由——`openai_compat` 走 `OpenAIClient`，`anthropic_compat` 走 `AnthropicClient`。调用方需要在传 `provider` 时附带 transport 选择，或者 `create_client` 通过 lookup `provider_secrets` 找到对应 entry 后读 `kind` 字段。

### list_models

```rust
pub fn list_models(
    provider: &str,
    explicit_api_key: Option<&str>,
    explicit_base_url: Option<&str>,
) -> Result<Vec<String>, String>
```

- OpenAI / OpenAI-compatible → `GET /v1/models`
- Anthropic / Anthropic-compatible → `GET /v1/models`
- Ollama → `GET /api/tags`

Anthropic 早期硬编码列表（`ANTHROPIC_MODELS` 11 条）已于 v1.0 删除——4 family 全部走 API 实时拉取。

## ProviderEntry 列表组装（providers/mod.rs）

`list_all(app)` 返回给前端的 `Vec<ProviderEntry>`，由两个动作组合：

| 顺序 | 来源 | 写入条件 |
|---|---|---|
| 1 | Preset (OpenAI / Anthropic / Ollama) | `config.json::provider_secrets[id]` 存在且非空 |
| 2 | User (Custom — `openai_compat` / `anthropic_compat`) | `config.json::providers[]` 中存在的条目 |

Preset 必须在 Settings UI 输入过 API Key 才会显示——这就是"未配置供应商不出现在列表内"的核心约束。Custom 永远显示（user 自己加的）。

### ProviderEntry 数据契约

```rust
pub struct ProviderEntry {
    pub id: String,             // user-defined 唯一 id
    pub label: String,          // 显示名
    pub family: String,         // "openai" / "anthropic" / "ollama" / Custom 的 user-id
    pub base_url_editable: bool,// preset = false
    pub api_key_required: bool, // preset = true，Ollama = false
    pub kind: FamilyKind,        // Preset | OpenaiCompat | AnthropicCompat
    pub base_url: String,
    pub model: String,
    pub models: Vec<ModelEntry>,
    pub source: ProviderSource, // Preset | User
}
```

### 凭证解析（resolve_api_key）

```rust
pub fn resolve_api_key(app: &AppHandle, id: &str) -> Result<Option<String>, String>
```

仅返回 `config.json::provider_secrets[id]`（非空过滤）。无 env fallback，无 family stripping，无 user-fallback。

## 支持的 Provider

| ID | 名称 | 默认 Base URL | Transport | 来源 |
|----|------|--------------|-----------|------|
| `openai` | OpenAI | `https://api.openai.com/v1` | OpenAIChat | Preset |
| `anthropic` | Anthropic | `https://api.anthropic.com` | AnthropicMessages | Preset |
| `ollama` | Ollama | `http://127.0.0.1:11434` | OllamaNative | Preset |
| Custom | (user-named) | (user-supplied) | 路由到 OpenAI 或 Anthropic | User |

注：MiniMax / DeepSeek / 硅基流动等历史上没有独立 preset——通过 Settings UI 添加 Custom 条目（`kind=openai_compat`），填写对应 Base URL 与 API Key 即可。

## Settings UI 流程

1. 用户点击「添加」→ 打开 picker dialog
2. 选择 family（preset：`openai` / `anthropic` / `ollama`；Custom：`openai_compat` / `anthropic_compat`）
3. 填写 ID + Base URL + API Key（preset 不可改 ID / Base URL，Custom 全部可改）
4. 点击「获取模型列表」→ `ProviderFactory::list_models(explicit)` 验证凭证
5. 选择一个模型，点击「保存」→
   - preset path: `update_provider({id, base_url, model, api_key})` → 写 `provider_secrets`
   - Custom path: `add_provider({...})` → 写 `providers[]` + `provider_secrets[]`

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
- OpenAI/OpenAI-compatible（默认） → Bearer token, `/v1/chat/completions`
- Anthropic/Anthropic-compatible → x-api-key header, `/v1/messages`
- Ollama → 无认证, `/api/chat`

Custom family 通过 `family` 字段（"openai" / "anthropic"）路由——`openai_compat` 的 entry 走 OpenAI 分支，`anthropic_compat` 走 Anthropic 分支。

凭证获取同样通过 `providers::resolve_api_key` → `config.json::provider_secrets`。

## 文件清单

| 文件 | 职责 |
|------|------|
| `provider/config.rs` | `PROVIDER_REGISTRY`（仅 3 个 preset）+ `get_provider_config()` |
| `provider/openai.rs` | OpenAI / OpenAI 兼容 `LLMClient` 实现 + `chat_stream` 真 SSE override |
| `provider/anthropic.rs` | Anthropic / Anthropic 兼容 `LLMClient` 实现 + `chat_stream` 真 event-based SSE override |
| `provider/ollama.rs` | Ollama native `LLMClient` 实现 + `chat_stream` 真 NDJSON override |
| `provider/mod.rs` | `ProviderFactory` + `LLMClient` trait + `chat_stream` 默认实现 + `list_models_*` 函数 |
| `providers/mod.rs` | ProviderEntry 列表组装（preset + Custom user）+ add/update/remove/resolve_api_key |
| `nova_config.rs` | `~/.nova/config.json` 读写 + types (ProviderEntry / FamilyKind / ProviderSource) |