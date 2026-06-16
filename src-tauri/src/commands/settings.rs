use crate::db::Database;
use crate::nova_config;
use crate::nova_config::SettingsConfig;
use crate::providers;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

type SharedDatabase = Arc<Mutex<Database>>;

/// 暴露给前端的 Settings——通过 `nova_config` 读写统一的
/// `~/.nova/config.json`。
pub use crate::nova_config::SettingsConfig as Settings;

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<SettingsConfig, String> {
    Ok(nova_config::read_settings(&app))
}

#[tauri::command]
pub async fn save_settings(settings: SettingsConfig, app: tauri::AppHandle) -> Result<(), String> {
    nova_config::write_settings(&app, &settings)
}

/// 一次性 DB 清理：删除 provider 注册表迁出 SQLite 之前那些
/// 留在本表的遗留 key。每次启动都跑都安全。
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

/// 副官「默认模型」嘅单一权威写入入口（ADR 0003 §3.5）。
///
/// `provider_id` 必须存在喺 `providers::list_all` 结果入面。
/// `model_id` 唔本地验证——models 不持久化（ADR 0003 §3.1.2），
/// 验证推迟到 chat 阶段嘅 fallback（Stage 4）。
///
/// 旧嘅 `get_default_target` 命令保留向后兼容，但内部逻辑后续
/// Stage 2 也会切到读 NovaConfig 默认字段。
#[tauri::command]
pub async fn set_default_model(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    if model_id.trim().is_empty() {
        return Err("model_id 不能为空".into());
    }

    // Validate provider 存在
    let list = providers::list_all(&app)?;
    list.iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("provider not found: {provider_id}"))?;

    // 写入 default 字段
    let mut config = nova_config::read_config(&app);
    config.default_provider_id = Some(provider_id);
    config.default_model_id = Some(model_id.trim().to_string());
    nova_config::write_config(&app, &config)?;
    Ok(())
}

/// 副官「默认模型」读取入口（ADR 0003 §3.5）。
/// 返回 Option pair——`None` 即未初始化。Frontend 用于 chip 显示
/// 「当前 default」同「设为默认」按钮嘅 disable 判断。
#[tauri::command]
pub async fn get_default_model(app: tauri::AppHandle) -> Result<DefaultModelState, String> {
    let config = nova_config::read_config(&app);
    Ok(DefaultModelState {
        provider_id: config.default_provider_id,
        model_id: config.default_model_id,
    })
}

/// `get_default_model` 命令嘅 wire shape。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DefaultModelState {
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

/// 启动期默认值的快照，从 providers 列表派生。
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
    // ADR 0003：default 嘅权威来源系 `NovaConfig.default_*_id`，
    // 唔再依赖 entry.models[].is_default（Stage 2 cleanup 已移除）。
    let config = nova_config::read_config(&app);
    let (pid, mid) = match (
        config.default_provider_id.as_deref(),
        config.default_model_id.as_deref(),
    ) {
        (Some(p), Some(m)) => (p, m),
        _ => {
            return Ok(DefaultTarget {
                provider_id: None,
                provider_label: None,
                provider_family: None,
                base_url: None,
                model: None,
                api_key: None,
            });
        }
    };

    let providers = providers::list_all(&app)?;
    if let Some(entry) = providers.iter().find(|p| p.id == pid) {
        let api_key = providers::resolve_api_key(&app, &entry.id).unwrap_or(None);
        return Ok(DefaultTarget {
            provider_id: Some(entry.id.clone()),
            provider_label: Some(entry.label.clone()),
            provider_family: Some(entry.family.clone()),
            base_url: Some(entry.base_url.clone()),
            model: Some(mid.to_string()),
            api_key,
        });
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
