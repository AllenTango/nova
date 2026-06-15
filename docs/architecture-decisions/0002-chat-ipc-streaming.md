# ADR 0002: Chat IPC + Channel 流式

> **Status**: ✅ Accepted | **Date**: 2026-06-15 | **Scope**: `src-tauri/src/commands/chat.rs` + `src/hooks/useLocalAI.ts` + `src-tauri/src/provider/*` + `src-tauri/src/http_server/mod.rs`
>
> 取代方案：v1.0 嘅 HTTP fetch + SSE wire 解析。

## 1. 背景

Nova webview 与 Rust backend 嘅 chat 通讯，v1.0 走 HTTP fetch + SSE：

```
React useLocalAI
  → fetch('http://localhost:18999/v1/chat/completions', { stream: true })
  → 前端 ReadableStream 解析 SSE wire (data: {…}\n\n)
  → Rust axum handler 转发到 provider
  → 4 个 provider 各自再做一次 SSE 解析
```

三个问题：

1. **需要 1 个对外 HTTP 端口**（v1.0 实际是 18999）。即便 `bind 127.0.0.1` 已经挡住网络层，端口本身仲要管理、token 鉴权、防越界。
2. **SSE wire 解析重复 2 次**——webview 解析一次 SSE，Rust 内部再解一次。
3. **Session token 鉴权**是 webview 唯一安全网——少了 `/v1/chat/completions` 之后，连 token 都唔需要。

## 2. 决策

**内部 chat 通讯全走 Tauri 2 IPC + `tauri::ipc::Channel<T>` 流式。砍掉 `/v1/chat/completions` 路由**（保留 `/health`，未来 MCP 复用）。

## 3. 新架构

### 3.1 调用链

```
React AIChatPanel
  → useLocalAI.sendMessage(text)
  → invoke('ai_chat', { request, onEvent: channel })
  → Rust ai_chat command
  → tokio::task::spawn_blocking:
       ProviderFactory::create_client(...)
         .chat_stream(ChatRequest{ stream: true, ... }, on_delta)
  → on_event.send(ChatEvent::Delta) ─┐
  → on_event.send(ChatEvent::Done)  ─┼─> 透过 IPC Channel
  → on_event.send(ChatEvent::Error) ─┘
  → 返回给 webview
  → Channel.onmessage → appendText
```

### 3.2 ChatEvent enum

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    Delta { delta: String },     // 流式 delta
    Done  { usage: Option<Usage> }, // 终止 + usage
    Error { message: String },    // 错误
}
```

- `#[serde(tag = "type", ...)]` 让 on-wire 形态扁平、向前兼容。
- 新增事件变体 = 纯加法，JS 端走默认分支永远唔会爆。

### 3.3 LLMClient trait

```rust
pub trait LLMClient: Send {
    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String>;
    /// 默认 impl：跑一次 blocking `chat`，把整段响应作为单个 Delta 发出。
    /// 各 provider 可以 override 真正逐 chunk 转发。
    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: &mut dyn FnMut(&str) -> Result<(), String>,
    ) -> Result<ChatResponse, String> {
        let resp = self.chat(request)?;
        on_delta(&resp.content)?;
        Ok(resp)
    }
}
```

默认实现 = 全部走 buffered → 单 chunk 流式。**所有 4 个 provider 都已经 override 真 SSE 解析**：

| Provider | 协议 | chunk 形状 | 终止标志 | usage 抓取 |
|---|---|---|---|---|
| OpenAI / 兼容 | `data: {choices:[{delta:{content:"..."}}]}` | 标准 SSE | `data: [DONE]` | 末 chunk 带 `usage` |
| Anthropic | event-based: `content_block_delta` → `delta.text` | event + data 配对 | `message_stop` | `message_delta.usage` |
| Google Gemini | `data: {candidates:[{content:{parts:[{text:"..."}]}}]}` | 标准 SSE | 自然结束（无 [DONE]） | 暂不抓 |
| Ollama | NDJSON（**不是** SSE），每行完整 JSON `{message:{content:"..."}, done:false}` | NDJSON | `done: true` | 暂不抓 |

⚠️ **Ollama 嘅 NDJSON 陷阱**：每行**完整 JSON 对象**，唔系 SSE 嘅 `data: …` 前缀。如果照搬 SSE parser 解析会爆。Ollama 嘅 parser 系行-based `BufRead::read_line`。

⚠️ **Anthropic 嘅 event-based SSE 陷阱**：普通 SSE 解析器只睇 `data:` 字段，Anthropic 仲要按 `event:` 字段做路由（`content_block_delta` / `message_delta` / `message_stop`）。Parser 要做 state machine，唔系简单 split。

### 3.4 异步包装

`ai_chat` command 系 `#[tauri::command] async fn`，但 `LLMClient::chat_stream` 用 `reqwest::blocking`。**必须**包进 `tokio::task::spawn_blocking`——直接 await blocking I/O 会卡死 Tauri 整个 async runtime。

```rust
#[tauri::command]
pub async fn ai_chat(
    app: tauri::AppHandle,
    request: ChatRequest,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let on_event_clone = on_event.clone();
    tokio::task::spawn_blocking(move || {
        // ... blocking call ...
        on_event_clone.send(ChatEvent::Delta { delta: "..." })?;
        // ...
    })
    .await
    .map_err(|e| format!("spawn_blocking: {e}"))??;
    Ok(())
}
```

## 4. http_server 收紧

`src-tauri/src/http_server/mod.rs` 砍剩 2 路由：

| 路由 | 用途 | 调用方 |
|---|---|---|
| `GET /health` | 健康检查 | 任何工具（标准做法） |
| `POST /v1/chat/completions` | OpenAI 兼容入口 | 外部 AI 客户端（Hermes、curl、OpenAI SDK） |

**内部 webview 不再走 HTTP**。Nova 嘅 OpenAI 兼容入口保留系为咗：

1. 未来 MCP server over HTTP（命题 B）
2. 第三方 OpenAI 兼容客户端能直接接 Nova
3. 调试用（curl/Postman）

## 5. 与 ADR 0001 嘅关系

`provider/*` 嘅 `LLMClient` trait 加 `chat_stream` 默认实现（ADR 0002 引入），**唔影响** ADR 0001 嘅凭证解析路径（`ProviderFactory::create_client(explicit_api_key, explicit_base_url)`）。

## 6. 不适用

- **外部 AI 客户端**（Hermes、Claude Desktop、Cursor、OpenCode）→ 仍走 `http://localhost:18999/v1/chat/completions`
- **MCP 协议** → 未来 `POST /mcp` 路由（计划中）
- **调试 / 健康检查** → `GET /health` 保留

## 7. 后续

- [ ] **P1**：砍 `nova_port` 配置嘅 chat 用法（保留作 MCP 用）
- [ ] **P2**：4 provider 嘅 `usage` 抓取（当前仅 OpenAI / Anthropic 抓得到）
- [ ] **P3**：真·流式 abort（需要 server-side cancellation token）
