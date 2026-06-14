use crate::commands::settings::DefaultTarget;
use crate::db::Database;
use crate::providers;
use crate::provider::{ChatMessage, ChatRequest, ProviderFactory};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

type SharedDatabase = Arc<Mutex<Database>>;

/// Resolved credentials for an outbound AI call. Holds only the four
/// fields ProviderFactory needs — no Settings baggage.
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
    /// Optional provider id from `~/.nova/config.json`. When set we
    /// pull the api_key/base_url/model from the JSON entry instead of
    /// the boot-time default.
    pub provider_id: Option<String>,
}

/// Resolve provider credentials (provider + api_key + base_url) from
/// the boot-time default and caller-supplied overrides. Model is NOT
/// resolved here — callers that need a model (chat, test) apply their
/// own check after calling this.
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

/// Build a `ResolvedTarget` from boot-time default and overrides.
/// Requires a model to be set (from default, provider entry, or override).
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

#[tauri::command]
pub async fn ai_chat(
    prompt: String,
    system_prompt: Option<String>,
    overrides: Option<ChatOverrides>,
    db: State<'_, SharedDatabase>,
    app: tauri::AppHandle,
) -> Result<String, String> {
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

    let response = client.chat(ChatRequest {
        messages,
        model: target.model,
        temperature: Some(0.7),
        max_tokens: Some(2048),
    })?;

    Ok(response.content)
}

#[tauri::command]
pub async fn test_ai_provider(
    overrides: Option<ChatOverrides>,
    db: State<'_, SharedDatabase>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let target = {
        let db = db.lock().await;
        resolve_target(&app, &db, overrides).await?
    };

    if target.api_key.as_deref().map(|s| s.is_empty()).unwrap_or(true) {
        return Err("API Key 不能为空".to_string());
    }
    if target
        .base_url
        .as_deref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("Base URL 不能为空，请填写 API 端点地址".to_string());
    }

    let client = ProviderFactory::create_client(
        &target.provider,
        target.api_key.as_deref(),
        target.base_url.as_deref(),
    )?;

    let response = client.chat(ChatRequest {
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: "Reply with exactly: NOVA_PROVIDER_OK".to_string(),
        }],
        model: target.model.clone(),
        temperature: Some(0.0),
        max_tokens: Some(32),
    })?;

    Ok(response.content)
}

/// Used by the Settings UI to populate the chat picker. Mirrors the
/// boot-time default — `None` when nothing has been marked default.
#[tauri::command]
pub async fn get_default_target_cmd(
    app: tauri::AppHandle,
) -> Result<DefaultTarget, String> {
    crate::commands::settings::get_default_target(app).await
}
