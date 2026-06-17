//! Anthropic 家族 + Anthropic 兼容家族（Custom: anthropic_compat）嘅流式 chat。
//!
//! 用 `anthropic-sdk-rust` 0.1.1 SDK 作为客户端实现，不再手写
//! event-based SSE parser。SDK 设计：
//!   - `MessageStream` 唔系 `Stream` trait 实现——只暴露 callback-based
//!     API（`.on_text` / `.on_error` / `.on_final_message`）同 `.final_message().await`
//!   - SDK 内部 `eventsource-stream` crate + tokio `broadcast` 通道处理 SSE
//!   - 0.1.1 API 仍在演进，ContentBlock enum 暂冇 `Thinking` 变体——
//!     minimax Anthropic 兼容端点嘅 thinking block 会被 serde 跳过，
//!     我们只拿 text delta。完整 thinking 文本如需落地应改 SDK enum。
//!
//! 覆盖 4 家族中嘅：
//!   - Anthropic（官方 api.anthropic.com）
//!   - Custom（kind=anthropic_compat，base_url 由用户填——例如
//!     `https://api.minimaxi.com/anthropic` 之类 Anthropic 兼容服务）
//!
//! 架构：blocking `StreamCallback` ↔ mpsc::sync_channel ↔ async forwarder
//! ↔ Channel<ChatEvent>（参见 skill `tauri-react-dualmode`）。
//!
//! 历史曾有 `ANTHROPIC_MODELS` 11 条硬编码常量——已彻底移除。
//! 全部走 `GET /v1/models` 实时拉取。

use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use anthropic_sdk::config::ClientConfig;
use anthropic_sdk::types::messages::{
    MessageCreateBuilder, Role as AnthropicRole,
};
use anthropic_sdk::Anthropic;

/// 从 Anthropic 的 `/v1/models` 端点拉取实时模型列表。
///
/// 与 OpenAI 的 `/v1/models` 同形——返回 `{ "data": [{ "id": "..." }, ...] }`。
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };

    let client = reqwest::blocking::Client::new();
    let response = client
        .get(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Anthropic 模型列表请求失败：{} - {}", status, text));
    }

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Anthropic 模型列表返回了非法 JSON：{}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or("Anthropic 模型列表响应缺少 data 数组")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

/// 构造 Anthropic SDK 客户端（带自定义 base_url）。
fn build_client(api_key: &str, base_url: &str) -> Result<Anthropic, String> {
    let config = ClientConfig::new(api_key).with_base_url(base_url);
    config
        .validate()
        .map_err(|e| format!("Anthropic 配置无效：{e}"))?;
    Anthropic::with_config(config).map_err(|e| format!("Anthropic 客户端构造失败：{e}"))
}

/// 把 Nova 内部 ChatRequest 拆成 SDK MessageCreateBuilder。
///
/// system prompt 走 `.system(s)`；user/assistant 走 `.user(s)` / `.assistant(s)`。
/// SDK 嘅 `MessageContent` enum 接受 `&str`（impl `From<&str>`）。
fn build_sdk_params(
    model: &str,
    max_tokens: u32,
    temperature: f32,
    system_prompt: Option<&str>,
    messages: &[crate::provider::ChatMessage],
) -> MessageCreateBuilder {
    let mut builder = MessageCreateBuilder::new(model, max_tokens).temperature(temperature);
    if let Some(s) = system_prompt {
        if !s.trim().is_empty() {
            builder = builder.system(s);
        }
    }
    for m in messages {
        let role = match m.role.as_str() {
            "assistant" => AnthropicRole::Assistant,
            // 包含 "user" + 未识别 fallback
            _ => AnthropicRole::User,
        };
        let content = m.content.as_str();
        builder = match role {
            AnthropicRole::Assistant => builder.assistant(content),
            AnthropicRole::User => builder.user(content),
        };
    }
    builder
}

/// 流式 chat：用 anthropic-sdk callback-based stream + mpsc 桥接。
///
/// `MessageStream` 0.1.1 唔系 `Stream` trait 实现——必须用
/// `.on_text(callback).final_message().await` 模式。`on_text` 接受
/// sync callback `Fn(&str, &str)`，正合我哋 mpsc sync_channel 模式。
///
/// 内部用专属 tokio runtime 跑 SDK 异步流（避免污染 Tauri runtime），
/// callback 同步 push delta 到 mpsc；当前 tokio runtime 消费 mpsc
/// 推送到 `on_delta` 同步回调（再经 `tauri::ipc::Channel` 出 webview）。
fn stream_via_sdk(
    api_key: &str,
    base_url: &str,
    request: ChatRequest,
    on_delta: StreamCallback,
) -> Result<ChatResponse, String> {
    use std::sync::mpsc;

    let api_key = api_key.to_string();
    let base_url = base_url.to_string();

    let (tx, rx) = mpsc::sync_channel::<String>(64);
    // 收集最后 usage：MessageDelta 事件触发；final_message 兜底
    let (usage_tx, usage_rx) = mpsc::sync_channel::<Usage>(4);

    let (model, max_tokens, temperature, system_prompt, messages) = extract_request(&request);

    let stream_handle = std::thread::spawn(move || -> Result<(), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("build stream runtime: {e}"))?;
        rt.block_on(async {
            let client = match build_client(&api_key, &base_url) {
                Ok(c) => c,
                Err(e) => return Err(e),
            };
            let params = build_sdk_params(
                &model,
                max_tokens,
                temperature,
                system_prompt.as_deref(),
                &messages,
            );
            let stream = match client.messages().create_stream(params.build()).await {
                Ok(s) => s,
                Err(e) => return Err(format!("Anthropic SDK stream 创建失败：{e}")),
            };

            // 1. 装 on_text callback——text delta 同步推到 mpsc
            // 2. 装 on_stream_event callback——MessageDelta 事件拎 usage
            // 3. .final_message().await 阻塞等完——返回 final Message 拿 usage
            //    （即便 on_stream_event 已先收到，亦不冲突：final_message 是兜底）
            let tx_clone = tx.clone();
            let usage_tx_clone = usage_tx.clone();
            let final_message = stream
                .on_text(move |delta: &str, _snapshot: &str| {
                    if tx_clone.send(delta.to_string()).is_err() {
                        // 接收端已 drop，提前终止
                    }
                })
                .on_stream_event(move |event, _snapshot| {
                    if let anthropic_sdk::MessageStreamEvent::MessageDelta { usage, .. } = event {
                        let _ = usage_tx_clone.send(Usage {
                            prompt_tokens: usage.input_tokens.unwrap_or(0),
                            completion_tokens: usage.output_tokens,
                            total_tokens: usage.input_tokens.unwrap_or(0) + usage.output_tokens,
                        });
                    }
                })
                .final_message()
                .await
                .map_err(|e| format!("Anthropic stream 完成失败：{e}"))?;

            // 兜底：final_message 嘅 usage（如果 on_stream_event 漏掉）
            let _ = usage_tx.send(Usage {
                prompt_tokens: final_message.usage.input_tokens,
                completion_tokens: final_message.usage.output_tokens,
                total_tokens: final_message.usage.total_tokens(),
            });
            Ok::<_, String>(())
        })?;
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

/// 非流式 fallback：调 `/v1/messages` 不带 `stream`，一次性返回。
fn blocking_via_sdk(
    api_key: &str,
    base_url: &str,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let api_key = api_key.to_string();
    let base_url = base_url.to_string();

    let (model, max_tokens, temperature, system_prompt, messages) = extract_request(&request);

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("build runtime: {e}"))?;
    let response = match rt.block_on(async {
        let client = match build_client(&api_key, &base_url) {
            Ok(c) => c,
            Err(e) => return Err(e),
        };
        let params = build_sdk_params(
            &model,
            max_tokens,
            temperature,
            system_prompt.as_deref(),
            &messages,
        );
        match client.messages().create(params.build()).await {
            Ok(r) => Ok(r),
            Err(e) => Err(format!("Anthropic 兼容 provider 调用失败：{e}")),
        }
    }) {
        Ok(r) => r,
        Err(e) => return Err(e),
    };

    // ContentBlock 当前 enum 冇 Thinking 变体，text 抽取用 pattern match
    let mut content = String::new();
    for block in &response.content {
        if let anthropic_sdk::ContentBlock::Text { text } = block {
            content.push_str(text.as_str());
        }
    }

    let usage = Usage {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens(),
    };

    Ok(ChatResponse {
        content,
        model: request.model,
        usage: Some(usage),
    })
}

/// 把 Nova 内部 ChatRequest 拆成 SDK 调用所需参数。
fn extract_request(
    request: &ChatRequest,
) -> (String, u32, f32, Option<String>, Vec<crate::provider::ChatMessage>) {
    let model = request.model.clone();
    let max_tokens = request.max_tokens.unwrap_or(2048);
    let temperature = request.temperature.unwrap_or(0.7);

    // 拎 system prompt（如果有）
    let system_prompt = request
        .messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // 滤走 system（SDK 走独立 system() builder method）
    let messages: Vec<crate::provider::ChatMessage> = request
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .cloned()
        .collect();

    (model, max_tokens, temperature, system_prompt, messages)
}

pub struct AnthropicClient {
    api_key: String,
    base_url: String,
}

impl AnthropicClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
        }
    }
}

impl LLMClient for AnthropicClient {
    fn provider_name(&self) -> &str {
        "anthropic"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        blocking_via_sdk(&self.api_key, &self.base_url, request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        stream_via_sdk(&self.api_key, &self.base_url, request, on_delta)
    }
}