//! OpenAI 家族 + OpenAI 兼容家族（Custom: openai_compat）嘅流式 chat。
//!
//! 用 `async-openai` 0.41 SDK 作为客户端实现，不再手写 SSE parser：
//!   - 官方 SDK 自动处理 `data: {json}` / `[DONE]` 终止符 / SSE 边界
//!   - 流式 reader 由 SDK 内部 `reqwest` async + `StreamResponse` 实现
//!   - 类型全部在 `async_openai::types::chat::*` 命名空间
//!
//! 覆盖 4 家族中嘅：
//!   - OpenAI（官方 api.openai.com）
//!   - Custom（kind=openai_compat，base_url 由用户填——例如
//!     `https://api.minimaxi.com/v1`、DeepSeek、本地 Ollama OpenAI
//!     兼容层等）
//!
//! 架构：blocking 回调（`StreamCallback`）↔ mpsc::sync_channel ↔ async
//! forwarder ↔ Channel<ChatEvent>。原因：`tauri::ipc::Channel::send` 嘅
//! IPC 桥接系异步嘅，从 `spawn_blocking` 直接调会跨 runtime 边界静默
//! 丢消息；用 mpsc 中转把同步 send 转异步 send 解开此 trap
//! （参见 commit `08fed00` + skill `tauri-react-dualmode`）。

use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use async_openai::config::OpenAIConfig;
use async_openai::types::chat::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestSystemMessageContent, ChatCompletionRequestUserMessage,
    ChatCompletionRequestUserMessageContent, ChatCompletionStreamOptions,
    CreateChatCompletionRequest, CreateChatCompletionResponse, CreateChatCompletionStreamResponse,
    ReasoningEffort,
};
use async_openai::Client;
use futures_util::StreamExt;

/// 把 Nova 内部 ChatMessage 转换成 async-openai 嘅 ChatCompletionRequestMessage。
fn to_openai_message(
    m: &crate::provider::ChatMessage,
) -> ChatCompletionRequestMessage {
    match m.role.as_str() {
        "system" => ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
            content: ChatCompletionRequestSystemMessageContent::Text(m.content.clone()),
            name: None,
        }),
        "assistant" => ChatCompletionRequestMessage::Assistant(
            ChatCompletionRequestAssistantMessage {
                content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                    m.content.clone(),
                )),
                name: None,
                refusal: None,
                audio: None,
                tool_calls: None,
                #[allow(deprecated)]
                function_call: None,
            },
        ),
        // 包含 "user" + 未识别 fallback
        _ => ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Text(m.content.clone()),
            name: None,
        }),
    }
}

/// 组装 chat 通用配置。`is_compat` = true 时（Custom family）注入
/// `reasoning_effort = Medium` 触发 OpenAI 风格 reasoning（minimax
/// 兼容层会忽略此字段；标准 OpenAI 视为 o1/o3 reasoning effort）。
///
/// **minimax `extra_body = {"reasoning_split": True}` 限制**：async-openai
/// 0.41 冇原生 `extra_body` 字段（`CreateChatCompletionRequest` 冇
/// `#[serde(flatten)]`）。完整 minimax 兼容需要 patch SDK 或自己
/// 手建 JSON。当前用 `reasoning_effort` 做折衷——足够触发 minimax
/// 嘅 reasoning 模式。
fn build_request(request: &ChatRequest, is_compat: bool) -> CreateChatCompletionRequest {
    let messages: Vec<ChatCompletionRequestMessage> =
        request.messages.iter().map(to_openai_message).collect();
    let mut req = CreateChatCompletionRequest {
        messages,
        model: request.model.clone(),
        stream: Some(false),
        ..Default::default()
    };
    if request.stream {
        req.stream = Some(true);
        req.stream_options = Some(ChatCompletionStreamOptions {
            include_usage: Some(true),
            include_obfuscation: Some(false),
        });
    }
    if let Some(t) = request.temperature {
        req.temperature = Some(t);
    }
    if let Some(m) = request.max_tokens {
        req.max_completion_tokens = Some(m);
    }
    if is_compat {
        req.reasoning_effort = Some(ReasoningEffort::Medium);
    }
    req
}

/// 构造 OpenAI 客户端（含自定义 base_url）。
fn build_client(api_key: &str, base_url: &str) -> Result<Client<OpenAIConfig>, String> {
    let cfg = OpenAIConfig::new()
        .with_api_key(api_key)
        .with_api_base(base_url.trim_end_matches('/'));
    Ok(Client::with_config(cfg))
}

/// 把 SDK 流式 chunk 抽取成 `(delta_text, optional_usage)`。
fn extract_chunk(chunk: &CreateChatCompletionStreamResponse) -> (String, Option<Usage>) {
    let mut text = String::new();
    for choice in &chunk.choices {
        if let Some(content) = &choice.delta.content {
            text.push_str(content);
        }
    }
    let usage = chunk.usage.as_ref().map(|u| Usage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
    });
    (text, usage)
}

/// 流式 chat：用 async-openai SDK + mpsc 桥接。
///
/// 1. `std::thread::spawn` 跑专属 tokio runtime → `client.chat().create_stream()` 返 `StreamResponse`
/// 2. 同步 `Stream::next()` 推 mpsc::sync_channel
/// 3. 当前 tokio runtime 消费 mpsc → 调 `on_delta` 同步回调
fn stream_via_sdk(
    api_key: &str,
    base_url: &str,
    request: ChatRequest,
    on_delta: StreamCallback,
    is_compat: bool,
) -> Result<ChatResponse, String> {
    use std::sync::mpsc;

    let client = build_client(api_key, base_url)?;
    let req = build_request(&request, is_compat);

    let (tx, rx) = mpsc::sync_channel::<String>(64);
    let (usage_tx, usage_rx) = mpsc::sync_channel::<Usage>(1);

    let stream_handle = std::thread::spawn(move || -> Result<(), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("build stream runtime: {e}"))?;
        let mut full_text = String::new();
        let mut last_usage: Option<Usage> = None;
        rt.block_on(async {
            let mut stream = client
                .chat()
                .create_stream(req)
                .await
                .map_err(|e| format!("OpenAI SDK stream 创建失败：{e}"))?;
            while let Some(chunk_res) = stream.next().await {
                let chunk = chunk_res.map_err(|e| format!("OpenAI stream chunk 错误：{e}"))?;
                let (delta, usage) = extract_chunk(&chunk);
                if !delta.is_empty() {
                    full_text.push_str(&delta);
                    if tx.send(delta).is_err() {
                        break;
                    }
                }
                if let Some(u) = usage {
                    last_usage = Some(u);
                }
            }
            Ok::<_, String>(())
        })?;
        let _ = usage_tx.send(last_usage.unwrap_or(Usage {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        }));
        Ok(())
    });

    // 当前 runtime 同步消费 mpsc
    let rt = tokio::runtime::Handle::current();
    let mut full_text = String::new();
    let _ = rt.block_on(async {
        tokio::task::block_in_place(|| {
            while let Ok(delta) = rx.recv() {
                full_text.push_str(&delta);
                if on_delta(&delta).is_err() {
                    break;
                }
            }
        });
    });

    let usage = usage_rx.recv().ok();
    stream_handle
        .join()
        .map_err(|_| "stream thread join failed".to_string())??;

    Ok(ChatResponse {
        content: full_text,
        model: request.model,
        usage,
    })
}

/// 非流式 chat：用 SDK `create()`。
fn blocking_via_sdk(
    api_key: &str,
    base_url: &str,
    request: ChatRequest,
    is_compat: bool,
) -> Result<ChatResponse, String> {
    let client = build_client(api_key, base_url)?;
    let mut req = build_request(&request, is_compat);
    req.stream = Some(false);
    req.stream_options = None;

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("build runtime: {e}"))?;
    let response: CreateChatCompletionResponse = rt
        .block_on(async { client.chat().create(req).await })
        .map_err(|e| format!("OpenAI 兼容 provider 调用失败：{e}"))?;

    let content = response
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();

    let usage = response.usage.map(|u| Usage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
    });

    Ok(ChatResponse {
        content,
        model: request.model,
        usage,
    })
}

pub struct OpenAIClient {
    api_key: String,
    base_url: String,
}

impl OpenAIClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
        }
    }
}

impl LLMClient for OpenAIClient {
    fn provider_name(&self) -> &str {
        "openai"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        let is_compat = !self.base_url.contains("api.openai.com");
        blocking_via_sdk(&self.api_key, &self.base_url, request, is_compat)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let is_compat = !self.base_url.contains("api.openai.com");
        stream_via_sdk(&self.api_key, &self.base_url, request, on_delta, is_compat)
    }
}