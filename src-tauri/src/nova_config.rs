use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ── Provider 数据类型（配置文件和前端共享）──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderSource {
    Preset,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FamilyKind {
    Preset,
    OpenaiCompat,
    AnthropicCompat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderEntry {
    pub id: String,
    pub label: String,
    pub family: String,
    pub base_url_editable: bool,
    pub api_key_required: bool,
    pub kind: FamilyKind,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
    pub source: ProviderSource,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewProvider {
    pub id: String,
    pub label: String,
    pub family: String,
    pub kind: FamilyKind,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProvider {
    pub id: String,
    pub label: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

pub const PRESET_FAMILIES: &[&str] = &["openai", "anthropic", "ollama"];

// ── 统一配置文件 ──────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct NovaConfig {
    #[serde(default = "default_nova_port")]
    pub nova_port: u16,
    #[serde(default = "default_preview_port")]
    pub preview_port: u16,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub providers: Vec<ProviderEntry>,
    #[serde(default)]
    pub provider_secrets: BTreeMap<String, String>,
}

fn default_nova_port() -> u16 { 3847 }
fn default_preview_port() -> u16 { 4321 }
fn default_theme() -> String { "dark".to_string() }

impl Default for NovaConfig {
    fn default() -> Self {
        NovaConfig {
            nova_port: 3847,
            preview_port: 4321,
            theme: "dark".to_string(),
            providers: Vec::new(),
            provider_secrets: BTreeMap::new(),
        }
    }
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
    Ok(dir)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("config.json"))
}

pub fn read_config(app: &tauri::AppHandle) -> NovaConfig {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return NovaConfig::default(),
    };
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => NovaConfig::default(),
    }
}

pub fn write_config(app: &tauri::AppHandle, config: &NovaConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("serialize config.json: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {path:?}: {e}"))
}

/// 从 `nova_home` 目录读配置（启动期用）。
pub fn read_config_from(nova_home: &PathBuf) -> NovaConfig {
    let path = nova_home.join("config.json");
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => NovaConfig::default(),
    }
}

/// 读配置，只返回 settings 字段。
pub fn read_settings(app: &tauri::AppHandle) -> SettingsConfig {
    let c = read_config(app);
    SettingsConfig {
        nova_port: c.nova_port,
        preview_port: c.preview_port,
        theme: c.theme,
    }
}

/// 就地更新 settings 字段并落盘。
pub fn write_settings(app: &tauri::AppHandle, s: &SettingsConfig) -> Result<(), String> {
    let mut config = read_config(app);
    config.nova_port = s.nova_port;
    config.preview_port = s.preview_port;
    config.theme = s.theme.clone();
    write_config(app, &config)
}

/// 读配置，只返回 provider 密钥表。
pub fn read_secrets(app: &tauri::AppHandle) -> BTreeMap<String, String> {
    read_config(app).provider_secrets
}

/// 更新单个密钥并落盘。
pub fn write_secret(app: &tauri::AppHandle, id: &str, key: &str) -> Result<(), String> {
    let mut config = read_config(app);
    config.provider_secrets.insert(id.to_string(), key.to_string());
    write_config(app, &config)
}

/// 删除一个密钥并落盘。
pub fn clear_secret(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut config = read_config(app);
    config.provider_secrets.remove(id);
    write_config(app, &config)
}

/// 读配置，只返回 providers 列表。
pub fn read_providers(app: &tauri::AppHandle) -> Vec<ProviderEntry> {
    read_config(app).providers
}

/// 就地替换 providers 列表并落盘。
pub fn write_providers(app: &tauri::AppHandle, providers: &[ProviderEntry]) -> Result<(), String> {
    let mut config = read_config(app);
    config.providers = providers.to_vec();
    write_config(app, &config)
}

// ── Settings 结构（给 commands/settings.rs 用）─────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingsConfig {
    pub nova_port: u16,
    pub preview_port: u16,
    pub theme: String,
}

impl Default for SettingsConfig {
    fn default() -> Self {
        SettingsConfig {
            nova_port: 3847,
            preview_port: 4321,
            theme: "dark".to_string(),
        }
    }
}
