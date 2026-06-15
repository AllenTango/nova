use crate::commands::settings::DefaultTarget;
use crate::db::Database;
use crate::providers;
use crate::provider::{ChatMessage, ChatRequest, ProviderFactory};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Mutex;

type SharedDatabase = Arc<Mutex<Database>>;

/// 出站 AI 调用解析后的凭据。只装 `ProviderFactory` 需要的 4 个字段
/// ——不附带 Settings 的额外负担。
#[derive(Debug, Clone)]
struct ResolvedTarget {
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatOverrides {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// `~/.nova/config.json` 里的 provider id（可选）。设置时
    /// 我们从 JSON 条目里取 api_key/base_url/model，而不是用
    /// 启动期默认值。
    pub provider_id: Option<String>,
}

/// 从启动期默认值和 overrides 解析 provider 凭据
/// （provider + api_key + base_url）。不解析 model——需要 model 的
/// 调用方（chat、test）自己解析完之后再校验。
fn resolve_credentials(
    app: &tauri::AppHandle,
    overrides: Option<&ChatOverrides>,
) -> Result<ResolvedTarget, String> {
    let mut target = ResolvedTarget {
        provider: String::new(),
        api_key: None,
        base_url: None,
        model: String::new(),
    };

    // 1. Boot-time default — derived from config.json.
    let list = providers::list_all(app)?;
    if let Some(entry) = list.iter().find(|p| p.models.iter().any(|m| m.is_default)) {
        target.provider = entry.family.clone();
        target.base_url = Some(entry.base_url.clone());
        target.model = entry
            .models
            .iter()
            .find(|m| m.is_default)
            .map(|m| m.id.clone())
            .unwrap_or_default();
        if let Ok(Some(key)) = providers::resolve_api_key(app, &entry.id) {
            target.api_key = Some(key);
        }
    }

    // 2. Provider-id override.
    if let Some(pid) = overrides
        .and_then(|o| o.provider_id.as_deref())
        .filter(|s| !s.trim().is_empty())
    {
        if let Some(entry) = list.iter().find(|p| p.id == *pid) {
            target.provider = entry.family.clone();
            target.base_url = Some(entry.base_url.clone());
            if let Ok(Some(key)) = providers::resolve_api_key(app, pid) {
                target.api_key = Some(key);
            }
            if !entry.model.is_empty() {
                target.model = entry.model.clone();
            }
        }
    }

    // 3. Inline overrides — explicit per-call values.
    if let Some(ov) = overrides {
        if let Some(v) = ov.provider.as_deref().filter(|s| !s.trim().is_empty()) {
            target.provider = v.to_string();
        }
        if let Some(v) = ov.api_key.as_deref().filter(|s| !s.is_empty()) {
            target.api_key = Some(v.to_string());
        }
        if let Some(v) = ov.base_url.as_deref().filter(|s| !s.trim().is_empty()) {
            target.base_url = Some(v.to_string());
        }
        if let Some(v) = ov.model.as_deref().filter(|s| !s.trim().is_empty()) {
            target.model = v.to_string();
        }
    }

    if target.provider.is_empty() {
        return Err(
            "no AI provider configured — open Settings and pick a default model".to_string(),
        );
    }
    Ok(target)
}

/// 从启动期默认值和 overrides 构造 `ResolvedTarget`。
/// 要求 model 已设置（来自默认值、provider 条目或 override）。
async fn resolve_target(
    app: &tauri::AppHandle,
    _db: &Database,
    overrides: Option<ChatOverrides>,
) -> Result<ResolvedTarget, String> {
    let mut target = resolve_credentials(app, overrides.as_ref())?;

    if target.model.trim().is_empty() {
        return Err(
            "no default model configured — open Settings and mark a model as default".to_string(),
        );
    }

    target.model = normalize_model_name(
        &target.model,
        &target.provider,
        target.base_url.as_deref().unwrap_or(""),
    );
    Ok(target)
}

fn normalize_model_name(model: &str, provider: &str, base_url: &str) -> String {
    let trimmed = model.trim();
    let is_compatible = provider == "openai" || provider == "ollama";
    if is_compatible && !base_url.contains("api.openai.com") {
        if let Some((_, rest)) = trimmed.split_once('/') {
            return rest.to_string();
        }
    }
    trimmed.to_string()
}

#[tauri::command]
pub async fn list_models(
    overrides: Option<ChatOverrides>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let target = resolve_credentials(&app, overrides.as_ref())?;

    eprintln!(
        "[DEBUG list_models] provider={}, base_url={}, api_key_set={}",
        target.provider,
        target.base_url.as_deref().unwrap_or(""),
        target.api_key.is_some(),
    );

    let provider = target.provider.clone();
    let api_key = target.api_key.clone();
    let base_url = target.base_url.clone();

    let result = tokio::task::spawn_blocking(move || {
        ProviderFactory::list_models(
            &provider,
            api_key.as_deref(),
            base_url.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("blocking task failed: {e}"))?;

    if let Err(ref e) = result {
        eprintln!("[DEBUG list_models] ERROR: {}", e);
    } else {
        eprintln!("[DEBUG list_models] OK: {:?}", result.as_ref().unwrap());
    }

    result
}

/// 流式 chat 事件。`#[serde(tag = "type", ...)]` 让线缆形态保持
/// 扁平且向前兼容：新增事件变体只是纯加法，JS 端永远走默认分支
/// 不会爆。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    /// 收到上游模型推送的新文本 delta。前端追加到当前 assistant 气泡。
    Delta { text: String },
    /// 流正常结束。携带 usage 用于成本跟踪。
    Done { usage: Option<crate::provider::Usage> },
    /// 流以错误信息中止。永远是终态——前端清空半截气泡并显示错误。
    Error { message: String },
}

/// 流式 AI chat。`on_event` channel 是前端接收响应的唯一途径——
/// 本命令无返回值（JS 端从 `Delta` 拼出完整文本，缺失 `Done` 视为错误）。
///
/// 取代旧的单次 `ai_chat`（返回 `String`，需要 webview 经独立
/// HTTP 端点 `/v1/chat/completions` 走 Rust）。该 HTTP server 仍
/// 挂载给外部消费者（MCP 客户端、curl、OpenAI SDK），但内部流量
/// 留在进程内。
#[tauri::command]
pub async fn ai_chat(
    prompt: String,
    system_prompt: Option<String>,
    overrides: Option<ChatOverrides>,
    on_event: Channel<ChatEvent>,
    db: State<'_, SharedDatabase>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let target = {
        let db = db.lock().await;
        resolve_target(&app, &db, overrides).await?
    };

    let client = ProviderFactory::create_client(
        &target.provider,
        target.api_key.as_deref(),
        target.base_url.as_deref(),
    )?;

    let mut messages = Vec::new();
    if let Some(system) = system_prompt {
        if !system.trim().is_empty() {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: system,
            });
        }
    }
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: prompt,
    });

    let request = ChatRequest {
        messages,
        model: target.model,
        temperature: Some(0.7),
        max_tokens: Some(2048),
        stream: true,
    };

    // 流式客户端底层用 `reqwest::blocking`，所以必须在 blocking
    // 线程跑——在 Tauri async runtime 上跑 blocking I/O 会卡住
    // 所有其他 command。
    let on_event_clone = on_event.clone();
    let result = tokio::task::spawn_blocking(move || {
        client.chat_stream(request, &mut |delta: &str| -> Result<(), String> {
            on_event_clone
                .send(ChatEvent::Delta {
                    text: delta.to_string(),
                })
                .map_err(|e| format!("channel 发送失败：{e}"))
        })
    })
    .await
    .map_err(|e| format!("blocking task 失败：{e}"))?;

    match result {
        Ok(response) => {
            // 尽力发送的最终事件。如果 channel 已关（如 webview
            // 流中途跳走），就静默丢弃——反正没人听了。
            let _ = on_event.send(ChatEvent::Done { usage: response.usage });
        }
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error { message: e });
        }
    }

    Ok(())
}

/// Settings UI 用此填充 chat 切换器。镜像启动期默认值——
/// 未标记默认时返回 `None`。
#[tauri::command]
pub async fn get_default_target_cmd(
    app: tauri::AppHandle,
) -> Result<DefaultTarget, String> {
    crate::commands::settings::get_default_target(app).await
}
