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
    // ADR 0003 Stage 2 cleanup：`is_default` 字段移除——`models` 不持久化
    // （运行时由 `list_models` API 注入），无赋值场景。default 嘅权威来源
    // 系 `NovaConfig.default_model_id`（ADR 0003 §3.1.2）。
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
    // API key 掩码（最后 4 位明文 + 前面 `••••`）——frontend edit 模式
    // prefill 输入框用。`Some(...)` = 有 secret；`None` = 冇 secret。
    // 永远唔返明文（安全考虑）。frontend 入面：
    //   - `Some(masked)` → 预填到 input（user 改动就覆盖）
    //   - `None` → input 空白（user 必填）
    // 配合 serde `skip_serializing_if` 保持 wire format 简洁。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_masked: Option<String>,
    // ADR 0003 Stage 2 cleanup：`model` 字段保留但 skip_serializing_if
    // 空字符串（向后兼容旧 config.json 嘅 `model: "MiniMax-M2.7"`），
    // `add` 路径不再写入。新 config.json 永远唔出现呢个字段。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    // ADR 0003 Stage 2 cleanup：`models` Vec 改为 skip_serializing_if
    // 空 vec——models 不持久化（ADR §3.1.2 运行时由 list_models API
    // 注入）。保留字段供未来扩展。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
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
    // ADR 0003：`model` 字段保留——`add` 命令入面用户选定嘅 model
    // 仅用作「首次 set_default」输入，不写入 entry 本体。
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProvider {
    pub id: String,
    /// 自定义 provider（OpenAI/Anthropic 兼容）重命名 id 用。传入时
    /// backend 会移动 entry 同 secret，并同步更新 `default_provider_id`
    ///（如果该 provider 系当前 default）。
    #[serde(default)]
    pub new_id: Option<String>,
    pub label: Option<String>,
    pub base_url: Option<String>,
    // ADR 0003 Stage 2 cleanup：`model` 字段移除——update 路径
    // 不做 set_default（避免 silent override 当前 default）；
    // 改 default 走独立 `set_default_model` command。
    pub api_key: Option<String>,
}

pub const PRESET_FAMILIES: &[&str] = &["openai", "anthropic", "ollama"];

// ── Preset override ────────────────────────────────────────
// Preset provider（OpenAI / Anthropic）嘅 entry 唔写进 `providers`
// 数组——只有 `provider_secrets` 有对应 key 嘅时候 `list_all` 先
// 临时构造。但 user 喺 Settings UI 改过嘅 base_url 必须持久化
// （例如 Ollama `baseUrlEditable: true`），否则下次启动
// `make_preset_entry` 会 reset 返 registry default。
//
// ADR 0003 Stage 2 cleanup：`model` 字段移除——已被
// `NovaConfig.default_model_id` 取代（ADR 0003 §6.3）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PresetOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

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
    /// Preset provider 嘅 model / base_url 持久化（key = preset id）。
    /// 详见 `PresetOverride` 注释。
    #[serde(default)]
    pub preset_overrides: BTreeMap<String, PresetOverride>,
    /// 全局默认链路嘅 provider id。`None` 即未初始化。
    /// 权威来源（ADR 0003 §2）；`ProviderEntry.models[].is_default`
    /// 同 `ProviderEntry.model: String` 字段都唔再系 default 嘅 truth。
    #[serde(default)]
    pub default_provider_id: Option<String>,
    /// 全局默认链路嘅 model id。`None` 即未初始化。
    #[serde(default)]
    pub default_model_id: Option<String>,
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
            preset_overrides: BTreeMap::new(),
            default_provider_id: None,
            default_model_id: None,
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

/// 读全部 preset override（启动期 `list_all` 用嚟构造 entry）。
pub fn read_preset_overrides(app: &tauri::AppHandle) -> BTreeMap<String, PresetOverride> {
    read_config(app).preset_overrides
}

/// 就地合并一个 preset override 落盘。`None` 字段唔会清除现有值
/// ——调用方想清除要传 `Some("")` 然后 caller 端 trim 处理；呢个
/// 函数本身只 set / replace 已有值。
pub fn write_preset_override(
    app: &tauri::AppHandle,
    id: &str,
    ov: &PresetOverride,
) -> Result<(), String> {
    let mut config = read_config(app);
    config
        .preset_overrides
        .insert(id.to_string(), ov.clone());
    write_config(app, &config)
}

/// 启动期迁移旧 `~/.nova/config.json` 至 ADR 0003 default-model
/// 显式字段。幂等——已迁移嘅 config 重复调用直接 return。
///
/// **优先级**：
/// 1. 已迁移（`default_provider_id` 已存在）→ 跳过
/// 2. User `providers` 数组入面有 `model` 字段嘅第一个 entry
///    （向后兼容旧 user entry，Stage 2 cleanup 期间 `ProviderEntry.model`
///    保留但 skip_serializing_if 空字符串）
///
/// 冇得迁（用户未配置任何 provider）→ 保持 `uninitialized`，UI 引导。
///
/// ADR 0003 Stage 2 cleanup：清理旧 config 残留字段，保证 entry.model 永远为空。
/// 幂等：每次启动都运行。
///
/// 职责分两层：
///   1. 若 `default_provider_id` 未初始化：从 entry.model 迁移到顶层字段。
///   2. 无条件清理所有 entry.model（无论 default 是否已初始化）。
///      ——旧版 migration 代码设置了 default 但没有同步清空 entry.model，
///        导致 config.json 里 `model: "MiniMax-M2.7"` 一直残留，
///        造成 provider.model 与 default_model_id 不一致。
pub fn migrate_default_state(app: &tauri::AppHandle) -> Result<(), String> {
    let mut config = read_config(app);
    let mut changed = false;

    // 层 1：初始化 default（若尚未初始化）
    if config.default_provider_id.is_none() {
        if let Some(p) = config
            .providers
            .iter()
            .find(|p| !p.model.trim().is_empty())
        {
            config.default_provider_id = Some(p.id.clone());
            config.default_model_id = Some(p.model.trim().to_string());
            changed = true;
            eprintln!(
                "[migrate] 初始化 default：provider={}, model={}",
                p.id,
                p.model.trim()
            );
        }
    }

    // 层 2：无条件清理 entry.model（幂等清理旧 migration 残留）
    for entry in &mut config.providers {
        if !entry.model.trim().is_empty() {
            eprintln!(
                "[migrate] 清理 provider {} 嘅旧 model 字段：\"{}\" → \"\"",
                entry.id,
                entry.model
            );
            entry.model = String::new();
            changed = true;
        }
    }

    if changed {
        write_config(app, &config)?;
    }

    // 层 3：启动期只做 field 迁移，不做网络验证。
    // 模型验证（ADR 0003 Stage 4）移到 ai_chat 第一次调用时做（lazy），
    // 避免 startup 阻塞和网络延迟——模型列表可能在运行时变化。

    Ok(())
}

/// ADR 0003 Stage 4：懒验证——ai_chat 首次调用时验证 default_model_id
/// 是否在 provider 可用列表里。若无效，降级到第一个可用模型并 retry。
/// 由 `commands::chat::resolve_credentials` 调用。
pub fn ensure_valid_default_model(app: &tauri::AppHandle) -> Result<(), String> {
    let config = read_config(app);
    let (pid, current_mid) = match (
        config.default_provider_id.as_deref(),
        config.default_model_id.as_deref(),
    ) {
        (Some(p), Some(m)) => (p, m),
        _ => return Ok(()),
    };

    let entry = config
        .providers
        .iter()
        .find(|p| p.id == pid)
        .ok_or_else(|| format!("default provider not found: {pid}"))?;

    let api_key = config
        .provider_secrets
        .get(pid)
        .filter(|s| !s.is_empty())
        .cloned();

    // 调用阻塞式 HTTP——ProviderFactory::list_models 内部用 spawn_blocking，
    // 需要在有 runtime 的 async context 里调用。ai_chat 本身是 async，
    // 所以这里用 tokio::task::spawn_blocking 包装。
    let entry_family = entry.family.clone();
    let entry_base_url = entry.base_url.clone();
    let rt = tokio::runtime::Handle::current();
    let available = rt.block_on(async {
        tokio::task::spawn_blocking(move || {
            crate::provider::ProviderFactory::list_models(
                &entry_family,
                api_key.as_deref(),
                Some(&entry_base_url),
            )
        })
        .await
        .map_err(|e| format!("blocking task failed: {e}"))?
    }).map_err(|e| format!("list_models for validation failed: {e}"))?;

    if available.iter().any(|m| m == current_mid) {
        return Ok(());
    }

    // default_model_id 无效，降级到第一个可用模型
    if let Some(first) = available.first() {
        eprintln!(
            "[validate_default] WARNING: model '{}' not in available list, falling back to '{}'",
            current_mid, first
        );
        let mut config = read_config(app);
        config.default_model_id = Some(first.clone());
        write_config(app, &config)?;
        eprintln!("[validate_default] default_model_id updated to '{}'", first);
    } else {
        eprintln!(
            "[validate_default] WARNING: model '{}' invalid and no available models to fall back to",
            current_mid
        );
    }

    Ok(())
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
