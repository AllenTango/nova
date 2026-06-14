use crate::db::Database;
use crate::nova_config;
use crate::nova_config::SettingsConfig;
use crate::providers;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

type SharedDatabase = Arc<Mutex<Database>>;

/// Settings exposed to the frontend — read/written to the unified
/// `~/.nova/config.json` via `nova_config`.
pub use crate::nova_config::SettingsConfig as Settings;

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<SettingsConfig, String> {
    Ok(nova_config::read_settings(&app))
}

#[tauri::command]
pub async fn save_settings(settings: SettingsConfig, app: tauri::AppHandle) -> Result<(), String> {
    nova_config::write_settings(&app, &settings)
}

/// One-shot DB cleanup: remove any of the legacy keys that used to
/// live here before the provider registry moved out of SQLite.
/// Safe to run on every boot.
pub fn purge_legacy_ai_keys(db: &Database) {
    const LEGACY: &[&str] = &[
        "ai_provider",
        "ai_api_key",
        "ai_base_url",
        "ai_model",
        "default_provider_id",
        "default_model",
        "current_provider_id",
        "current_model",
    ];
    for k in LEGACY {
        let _ = db.delete_setting(k);
    }
}

#[tauri::command]
pub async fn get_session_token(db: State<'_, SharedDatabase>) -> Result<String, String> {
    let db = db.lock().await;
    db.get_setting("session_token")
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No session token found".to_string())
}

/// Snapshot of the boot-time default, derived from providers list.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DefaultTarget {
    pub provider_id: Option<String>,
    pub provider_label: Option<String>,
    pub provider_family: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn get_default_target(app: tauri::AppHandle) -> Result<DefaultTarget, String> {
    let providers = providers::list_all(&app)?;
    for entry in &providers {
        if let Some(model) = entry.models.iter().find(|m| m.is_default) {
            let api_key = providers::resolve_api_key(&app, &entry.id).unwrap_or(None);
            return Ok(DefaultTarget {
                provider_id: Some(entry.id.clone()),
                provider_label: Some(entry.label.clone()),
                provider_family: Some(entry.family.clone()),
                base_url: Some(entry.base_url.clone()),
                model: Some(model.id.clone()),
                api_key,
            });
        }
    }
    Ok(DefaultTarget {
        provider_id: None,
        provider_label: None,
        provider_family: None,
        base_url: None,
        model: None,
        api_key: None,
    })
}
