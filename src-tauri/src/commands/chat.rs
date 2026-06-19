use crate::commands::settings::DefaultTarget;
use crate::db::Database;
use crate::nova_config::{self, FamilyKind};
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
    /// 出站嘅 entry id（用于 fallback 时区分 provider 切换 vs 仅 model 切换）。
    /// Custom family 时 = user-supplied id；preset 时 = preset id (openai/anthropic/ollama)。
    provider_id: String,
    /// 路由到哪个 transport family。Custom provider 时 family 形如
    /// "custom-openai"，需靠 kind 决定用 OpenAI transport 还是 Anthropic transport。
    kind: FamilyKind,
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

/// 从 `NovaConfig.default_provider_id` / `default_model_id` 解析
/// 出站 AI 调用嘅凭据（ADR 0003 §3.2）。
///
/// Stage 2 之后：default 字段系权威来源。`ProviderEntry.models[].is_default`
/// 同 `ProviderEntry.model: String` 唔再参与 default 推导。
///
/// Inline overrides（`provider_id` / `model` 字段）保留作为
/// debug / test 路径；生产 `ai_chat` 调用唔带 overrides，直接用 default。
fn resolve_credentials(
    app: &tauri::AppHandle,
    overrides: Option<&ChatOverrides>,
) -> Result<ResolvedTarget, String> {
    let config = nova_config::read_config(app);

    // ADR 0003 Stage 1+：default 字段系权威来源
    let (default_pid, default_mid) = match (
        config.default_provider_id.as_deref(),
        config.default_model_id.as_deref(),
    ) {
        (Some(p), Some(m)) => (p, m),
        _ => {
            return Err(
                "default model 未配置——open Settings 添加供应商时选定模型即自动设为默认"
                    .into(),
            );
        }
    };

    // Inline overrides 仅作 debug / test 用
    let pid = overrides
        .and_then(|o| o.provider_id.as_deref())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_pid);
    let mid = overrides
        .and_then(|o| o.model.as_deref())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_mid);

    // 搵 entry（preset 或 user）
    let list = providers::list_all(app)?;
    let entry = list
        .iter()
        .find(|p| p.id == pid)
        .ok_or_else(|| format!("default provider not found: {pid}"))?;

    // 唔本地验证 model 是否在 entry.models —— models 不持久化（ADR 0003
    // §3.1.2），本地检查会因供应商 model 变动出现 false negative。
    // 上游 chat 收到无效 model_id 时会返 4xx，由 Stage 4 fallback 处理。

    let api_key = providers::resolve_api_key(app, &entry.id).unwrap_or(None);

    Ok(ResolvedTarget {
        provider: entry.family.clone(),
        api_key,
        base_url: Some(entry.base_url.clone()),
        model: mid.to_string(),
        provider_id: entry.id.clone(),
        kind: entry.kind.clone(),
    })
}

/// 从 default 字段 + overrides 构造 `ResolvedTarget`。
/// ADR 0003 Stage 2：`resolve_credentials` 已经验证 default 字段存在
/// 并提供 model，所以此处唔再做 `model.is_empty()` check——早 fail
/// 早受益（用户会睇到「default model 未配置」错误而非含糊嘅
/// 「no default model configured」）。
async fn resolve_target(
    app: &tauri::AppHandle,
    _db: &Database,
    overrides: Option<ChatOverrides>,
) -> Result<ResolvedTarget, String> {
    let mut target = resolve_credentials(app, overrides.as_ref())?;

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
/// 拉取供应商模型列表。支持 `provider_id` / `base_url` / `api_key`
/// overrides，用于 Settings 页「验证」按钮：验证失败时唔会落盘，
/// 只返回 model list 或错误。
///
/// 与 `resolve_credentials` 区别：本命令唔强制 `default_model_id`
/// 存在——`list_models` 唔需要 model 字段。
pub async fn list_models(
    overrides: Option<ChatOverrides>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let config = nova_config::read_config(&app);
    let list = providers::list_all(&app)?;

    // 1. 解析 provider_id：override 优先，其次 default，否则报错。
    let pid = overrides
        .as_ref()
        .and_then(|o| o.provider_id.as_deref())
        .filter(|s| !s.trim().is_empty())
        .or(config.default_provider_id.as_deref())
        .ok_or_else(|| "provider 未指定——请先配置默认模型".to_string())?;

    let entry_opt = list.iter().find(|p| p.id == pid);

    // 2. 解析凭据：override 非空则优先，否则读持久化值。
    //    对于未保存 secret 的 preset（新建预设「扫描频段」），直接
    //    用 registry 配置 + overrides，无需落盘。
    let (api_key, base_url, provider) = if let Some(entry) = entry_opt {
        let api_key = overrides
            .as_ref()
            .and_then(|o| o.api_key.as_deref())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| providers::resolve_api_key(&app, &entry.id).unwrap_or(None));

        let base_url = overrides
            .as_ref()
            .and_then(|o| o.base_url.as_deref())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| Some(entry.base_url.clone()));

        (api_key, base_url, entry.family.clone())
    } else if providers::PRESET_FAMILIES.contains(&pid) {
        let api_key = overrides
            .as_ref()
            .and_then(|o| o.api_key.as_deref())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string);

        let base_url = overrides
            .as_ref()
            .and_then(|o| o.base_url.as_deref())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                crate::provider::config::get_provider_config(pid)
                    .map(|c| c.default_base_url.to_string())
            });

        (api_key, base_url, pid.to_string())
    } else {
        return Err(format!("provider not found: {pid}"));
    };

    eprintln!(
        "[DEBUG list_models] provider={}, base_url={}, api_key_set={}",
        provider,
        base_url.as_deref().unwrap_or(""),
        api_key.is_some(),
    );

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
    ///
    /// **Stage 4**：`fallback` 字段非 None 时表示已自动切换 default model，
    /// 前端用此字段显示「⚠ 已自动切换到 XXX」chip。
    Error {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        fallback: Option<FallbackNotice>,
    },
    /// 流中途通知（info-level，不终止流）。Stage 4 用此发 fallback
    /// notice 兼让前端在 assistant bubble 顶部加 chip 显示。
    Notice {
        kind: String, // "fallback_switched"
        message: String,
        old_provider_id: String,
        old_model_id: String,
        new_provider_id: Option<String>,
        new_model_id: String,
    },
}

/// ADR 0003 Stage 4 fallback 通知——前端收到后显示 ephemeral chip。
#[derive(Debug, Clone, Serialize)]
pub struct FallbackNotice {
    pub old_provider_id: String,
    pub old_model_id: String,
    pub new_provider_id: String,
    pub new_model_id: String,
}

/// 识别上游错误是否为 `model_not_found` 类（model 被下线 / 重命名 / 拼错）。
/// 仅此类触发 Stage 4 fallback。其他类（401 auth / 429 rate limit / 5xx server /
/// network）唔重试——避免 silent override 用户操作。
///
/// 各家供应商错误响应千差万别，但常见关键字：
/// - OpenAI / OpenAI 兼容："model_not_found", "The model ... does not exist",
///   "Unknown model", "Invalid model"
/// - Anthropic："model: ...", "not_found_error"（Anthropic 错误嵌套较深）
/// - minimax（OpenAI 兼容 + Anthropic 兼容）："model_not_found", "model not exist"
///
/// 返回值：true = 识别为 model_not_found。
fn is_model_not_found_error(err: &str) -> bool {
    let e = err.to_lowercase();
    // OpenAI 系 + minimax OpenAI 兼容
    if e.contains("model_not_found")
        || e.contains("the model")
            && (e.contains("does not exist") || e.contains("not found"))
        || e.contains("unknown model")
        || e.contains("invalid model")
        || e.contains("model not exist")
    {
        return true;
    }
    // Anthropic 系（errors[].type == "not_found_error" 且 message 含 "model:"）
    if e.contains("not_found_error") && e.contains("model") {
        return true;
    }
    false
}

/// 从候选 model 列表拣一个新 model。启发式（同 series 优先）：
/// 1. 同 prefix（去掉末段版本号）嘅 model：e.g. `MiniMax-M2.7` → `MiniMax-M2.5`
/// 2. 第一个非空候选
/// 3. None（候选列表空）
///
/// 输入保证 `candidates` 不含 `current` model（filter 阶段已剔除）。
fn pick_fallback_model(current: &str, candidates: &[String]) -> Option<String> {
    if candidates.is_empty() {
        return None;
    }
    // 启发式：尝试剥末段（`-M2.7` → `-M2.5` 类似匹配）
    let current_prefix = current
        .rsplit_once('-')
        .map(|x| x.0)
        .unwrap_or("")
        .to_lowercase();
    if !current_prefix.is_empty() {
        if let Some(m) = candidates
            .iter()
            .find(|c| c.to_lowercase().starts_with(&current_prefix) && c.as_str() != current)
        {
            return Some(m.clone());
        }
    }
    // 退化：第一个候选
    Some(candidates[0].clone())
}

/// Stage 4 fallback 主流程：chat 失败 + model_not_found 类 → 拉候选 →
/// 拣新 model → 写入 default → 重试一次。
///
/// 返回 `Ok((response, fallback_notice))` 或 `Err`（fallback 失败）。
async fn try_fallback_and_retry(
    app: &tauri::AppHandle,
    target: &ResolvedTarget,
    messages: &[ChatMessage],
    on_event: &Channel<ChatEvent>,
) -> Result<(crate::provider::ChatResponse, FallbackNotice), String> {
    eprintln!("[Stage 4 fallback] 模型 {} 失效，尝试 fallback", target.model);

    // ── Clone 目标字段供 spawn_blocking + 后续使用 ──────
    let model = target.model.clone();
    let provider_id = target.provider_id.clone();
    let provider = target.provider.clone();
    let api_key = target.api_key.clone();
    let base_url = target.base_url.clone();
    let kind = target.kind.clone();

    // Custom provider 按 kind 映射到 transport provider（统一 String 避免生命周期）
    let transport_provider: String = match kind {
        FamilyKind::OpenaiCompat => "openai".to_string(),
        FamilyKind::AnthropicCompat => "anthropic".to_string(),
        FamilyKind::Preset => provider.clone(),
    };

    // 1. 拉候选 model list（spawn_blocking：list_models 内部用
    //    reqwest::blocking::Client，从 async 上下文直接调会 panic）
    let p_for_blocking = transport_provider.clone();
    let k_for_blocking = api_key.clone();
    let b_for_blocking = base_url.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        ProviderFactory::list_models(&p_for_blocking, k_for_blocking.as_deref(), b_for_blocking.as_deref())
    })
    .await
    .map_err(|e| format!("blocking task failed: {e}"))?
    .map_err(|e| format!("fallback 拉候选失败：{e}"))?;

    // 2. 拣新 model
    let candidates_filtered: Vec<String> = candidates
        .into_iter()
        .filter(|m| m.as_str() != model)
        .collect();
    let new_model = match pick_fallback_model(&model, &candidates_filtered) {
        Some(m) => m,
        None => {
            return Err(format!(
                "model `{}` 已被供应商下线，但 fallback 候选为空",
                model
            ));
        }
    };

    eprintln!(
        "[Stage 4 fallback] 自动切换: {} → {}",
        model, new_model
    );

    // 3. 写入 default 字段
    let mut config = nova_config::read_config(app);
    config.default_provider_id = Some(provider_id.clone());
    config.default_model_id = Some(new_model.clone());
    nova_config::write_config(app, &config).map_err(|e| format!("fallback 写 default 失败：{e}"))?;

    // 4. 发 Notice 事件（前端 chip 显示）
    let notice = FallbackNotice {
        old_provider_id: provider_id.clone(),
        old_model_id: model.clone(),
        new_provider_id: provider_id.clone(),
        new_model_id: new_model.clone(),
    };
    let _ = on_event.send(ChatEvent::Notice {
        kind: "fallback_switched".into(),
        message: format!(
            "原默认模型 `{}` 已被供应商下线，已自动切换到 `{}`",
            model, new_model
        ),
        old_provider_id: provider_id.clone(),
        old_model_id: model.clone(),
        new_provider_id: Some(provider_id.clone()),
        new_model_id: new_model.clone(),
    });

    // 5. 用新 model 重试 chat（仅一次）
    let client = ProviderFactory::create_client(&transport_provider, api_key.as_deref(), base_url.as_deref())?;

    let new_request = ChatRequest {
        messages: messages.to_vec(),
        model: new_model.clone(),
        temperature: Some(0.7),
        max_tokens: Some(2048),
        stream: true,
    };

    let response = run_chat_stream(client, new_request, on_event).await?;
    Ok((response, notice))
}

/// 共用的 chat_stream 封装：spawn_blocking 跑 blocking 流 + mpsc 桥
/// 到 async Channel::send。
///
/// 架构：sync `StreamCallback` → mpsc::unbounded_channel → async forwarder
/// → Channel<ChatEvent>。原因：`tauri::ipc::Channel::send` 内部系异步，
/// 从 `spawn_blocking` 直接 send 会跨 runtime 边界静默丢消息（skill
/// `tauri-react-dualmode` 提到的 trap）。mpsc 中转解开此问题。
///
/// **Box<dyn LLMClient> 不能 clone**，所以一次性 move 到 spawn_blocking
/// 闭包——此函数返回 Result 包含完整 response，调用方 await 后即丢弃。
async fn run_chat_stream(
    client: Box<dyn crate::provider::LLMClient>,
    request: ChatRequest,
    on_event: &Channel<ChatEvent>,
) -> Result<crate::provider::ChatResponse, String> {
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::unbounded_channel::<ChatEvent>();
    let on_event_clone = on_event.clone();

    // async forwarder：消费 mpsc → send Channel<ChatEvent>
    let forwarder = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if on_event_clone.send(event).is_err() {
                break; // webview dropped channel
            }
        }
    });

    // spawn_blocking 跑 blocking 流（client move 进闭包，无 clone）
    let tx_clone = tx.clone();
    let result = tokio::task::spawn_blocking(move || {
        client.chat_stream(request, &mut |delta: &str| -> Result<(), String> {
            tx_clone
                .send(ChatEvent::Delta {
                    text: delta.to_string(),
                })
                .map_err(|e| format!("mpsc send: {e}"))
        })
    })
    .await
    .map_err(|e| format!("blocking task failed: {e}"))?;

    // explicit drop 关闭 mpsc，forwarder drain 后退出
    drop(tx);
    let _ = forwarder.await;

    result
}

/// 流式 AI chat。`on_event` channel 是前端接收响应的唯一途径——
/// 本命令无返回值（JS 端从 `Delta` 拼出完整文本，缺失 `Done` 视为错误）。
///
/// **ADR 0003 Stage 4**：chat 失败时识别 model_not_found 类错误并
/// 自动 fallback（拉候选 model + 写 default + 重试一次）。Fallback
/// 结果通过 Notice 事件告知前端。
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
    eprintln!("[DEBUG ai_chat] ENTERED — prompt_len={}, system_prompt={:?}, overrides={:?}", prompt.len(), system_prompt, overrides);
    let target = {
        let db = db.lock().await;
        resolve_target(&app, &db, overrides).await?
    };

    eprintln!(
        "[DEBUG ai_chat] provider={}, base_url={}, model={}, api_key_set={}, provider_id={}",
        target.provider,
        target.base_url.as_deref().unwrap_or(""),
        target.model,
        target.api_key.is_some(),
        target.provider_id,
    );

    // Custom provider（kind=OpenaiCompat/AnthropicCompat）按 kind 映射到实际 transport。
    // Preset provider（kind=Preset）直接用 family。
    let transport_provider = match target.kind {
        FamilyKind::OpenaiCompat => "openai",
        FamilyKind::AnthropicCompat => "anthropic",
        FamilyKind::Preset => &target.provider,
    };
    let client = ProviderFactory::create_client(
        transport_provider,
        target.api_key.as_deref(),
        target.base_url.as_deref(),
    )?;

    let mut messages = Vec::new();
    if let Some(system) = system_prompt.as_deref() {
        if !system.trim().is_empty() {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: system.to_string(),
            });
        }
    }
    let user_message = ChatMessage {
        role: "user".to_string(),
        content: prompt.clone(),
    };
    messages.push(user_message.clone());

    let request = ChatRequest {
        messages: messages.clone(),
        model: target.model.clone(),
        temperature: Some(0.7),
        max_tokens: Some(2048),
        stream: true,
    };

    // 第一次尝试
    let on_event_first = on_event.clone();
    let first_result = run_chat_stream(client, request, &on_event_first).await;

    match first_result {
        Ok(response) => {
            let _ = on_event.send(ChatEvent::Done { usage: response.usage });
            Ok(())
        }
        Err(e) => {
            // Stage 4 fallback 判断
            if !is_model_not_found_error(&e) {
                // 非 model_not_found 类错误——按原 error 透传
                eprintln!("[DEBUG ai_chat] stream error: {}", e);
                let _ = on_event.send(ChatEvent::Error {
                    message: e,
                    fallback: None,
                });
                return Ok(());
            }

            // 触发 fallback
            eprintln!("[Stage 4] chat 4xx model_not_found 触发 fallback: {}", e);
            match try_fallback_and_retry(&app, &target, &messages, &on_event).await {
                Ok((response, notice)) => {
                    eprintln!(
                        "[Stage 4] fallback 成功: {} → {}",
                        notice.old_model_id, notice.new_model_id
                    );
                    let _ = on_event.send(ChatEvent::Done { usage: response.usage });
                    Ok(())
                }
                Err(fallback_err) => {
                    // fallback 也失败——返原 error + fallback context
                    eprintln!(
                        "[Stage 4] fallback 失败：{} (原 error: {})",
                        fallback_err, e
                    );
                    let _ = on_event.send(ChatEvent::Error {
                        message: e,
                        fallback: Some(FallbackNotice {
                            old_provider_id: target.provider_id.clone(),
                            old_model_id: target.model.clone(),
                            new_provider_id: target.provider_id.clone(),
                            new_model_id: String::new(), // 空 = 标记 fallback 失败
                        }),
                    });
                    Ok(())
                }
            }
        }
    }
}

/// Settings UI 用此填充 chat 切换器。镜像启动期默认值——
/// 未标记默认时返回 `None`。
#[tauri::command]
pub async fn get_default_target_cmd(
    app: tauri::AppHandle,
) -> Result<DefaultTarget, String> {
    crate::commands::settings::get_default_target(app).await
}