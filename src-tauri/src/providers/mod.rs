//! Provider 注册表，数据后端是统一的 `~/.nova/config.json`。
//!
//! 镜像 opencode 的模型：providers 放在 SQLite 之外，
//! 增删一个 provider 改一个文件就够，schema 变了也不用迁移 DB。
//! 两个数据源：
//!
//!   1. 用户添加的条目——由 Settings 里的 `add_provider` /
//!      `remove_provider` 命令写入。会持久化到 JSON 文件。
//!   2. 内置预设（OpenAI / Anthropic / Google）——来自 Rust 静态
//!      `PROVIDER_REGISTRY`。仅当用户在
//!      `config.json::provider_secrets` 里存了匹配的 API key
//!      时才出现在列表里；否则隐藏。
//!
//! 凭据只从 `~/.nova/config.json` 读。环境变量不参与。
//!
//! Settings 页可以增删用户 provider；chat 切换器可以从两个源
//! 里任选。

use crate::nova_config;
use crate::provider::config::get_provider_config;

// 再导出给 command handler 和其他模块用的类型。
pub use crate::nova_config::{
    FamilyKind, ModelEntry, NewProvider, PRESET_FAMILIES, ProviderEntry, ProviderSource,
    UpdateProvider,
};

fn make_preset_entry(family_id: &str) -> Option<ProviderEntry> {
    let config = get_provider_config(family_id)?;
    Some(ProviderEntry {
        id: config.id.to_string(),
        label: config.name.to_string(),
        family: config.id.to_string(),
        base_url_editable: false,
        api_key_required: true,
        kind: FamilyKind::Preset,
        base_url: config.default_base_url.to_string(),
        model: String::new(),
        models: Vec::new(),
        source: ProviderSource::Preset,
    })
}

/// 拼出返回给前端的完整 provider 列表。
///
/// 顺序：
///   1. 预设——仅当 `provider_secrets` 里有匹配的 API key。
///      没 key 的 provider 不可用，所以隐藏。
///   2. 用户添加的条目——`OpenaiCompat` / `AnthropicCompat`。
pub fn list_all(app: &tauri::AppHandle) -> Result<Vec<ProviderEntry>, String> {
    let secrets = nova_config::read_secrets(app);

    let presets: Vec<ProviderEntry> = PRESET_FAMILIES
        .iter()
        .filter_map(|f| make_preset_entry(f))
        .filter(|p| secrets.get(&p.id).is_some_and(|k| !k.is_empty()))
        .collect();

    let user = nova_config::read_providers(app);

    let mut combined = presets;
    combined.extend(user);
    Ok(combined)
}

/// 追加一个新用户 provider。成功时返回新条目。
pub fn add(app: &tauri::AppHandle, new: NewProvider) -> Result<ProviderEntry, String> {
    let id = new.id.trim().to_string();
    if id.is_empty() {
        return Err("provider id cannot be empty".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("provider id may only contain letters, digits, '-', '_', '.'".into());
    }

    if get_provider_config(&new.family).is_none() {
        return Err(format!("unknown provider family: {}", new.family));
    }
    if !matches!(
        new.kind,
        FamilyKind::OpenaiCompat | FamilyKind::AnthropicCompat
    ) {
        return Err(
            "only OpenaiCompat / AnthropicCompat entries can be added by the user".into(),
        );
    }

    let mut providers = nova_config::read_providers(app);
    if providers.iter().any(|p| p.id == id) {
        return Err(format!("provider id already exists: {id}"));
    }

    let entry = ProviderEntry {
        id: id.clone(),
        label: new.label.trim().to_string(),
        family: new.family.clone(),
        base_url_editable: true,
        api_key_required: true,
        kind: new.kind.clone(),
        base_url: new.base_url.trim().to_string(),
        model: new.model.trim().to_string(),
        models: Vec::new(),
        source: ProviderSource::User,
    };
    providers.push(entry.clone());
    nova_config::write_providers(app, &providers)?;

    if !new.api_key.is_empty() {
        nova_config::write_secret(app, &id, &new.api_key)?;
    }

    Ok(entry)
}

/// 对已存在的 provider 应用部分更新。
pub fn update(app: &tauri::AppHandle, patch: UpdateProvider) -> Result<ProviderEntry, String> {
    let id = patch.id.clone();

    let mut providers = nova_config::read_providers(app);

    if let Some(entry) = providers.iter_mut().find(|p| p.id == id) {
        if let Some(label) = patch.label {
            entry.label = label;
        }
        if let Some(base_url) = patch.base_url {
            entry.base_url = base_url;
        }
        if let Some(model) = patch.model {
            entry.model = model;
        }
        let updated = entry.clone();
        nova_config::write_providers(app, &providers)?;

        if let Some(key) = patch.api_key {
            if key.is_empty() {
                nova_config::clear_secret(app, &id)?;
            } else {
                nova_config::write_secret(app, &id, &key)?;
            }
        }
        return Ok(updated);
    }

    if !PRESET_FAMILIES.contains(&id.as_str()) {
        return Err(format!("provider not found: {id}"));
    }
    let mut preset = make_preset_entry(&id).ok_or_else(|| format!("invalid preset: {id}"))?;
    if let Some(model) = patch.model {
        preset.model = model;
    }
    if let Some(api_key) = patch.api_key {
        if api_key.is_empty() {
            nova_config::clear_secret(app, &id)?;
        } else {
            nova_config::write_secret(app, &id, &api_key)?;
        }
    }
    Ok(preset)
}

/// 删除一个用户 provider 及其密钥。
pub fn remove(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut providers = nova_config::read_providers(app);
    let before = providers.len();
    providers.retain(|p| p.id != id);
    if providers.len() == before {
        return Err(format!("no user provider with id {id}"));
    }
    nova_config::write_providers(app, &providers)?;
    nova_config::clear_secret(app, id)?;
    Ok(())
}

/// 读某 provider 的 API key。
///
/// 解析顺序（只从 config.json，不读环境变量）：
/// 1. `provider_secrets` 按精确 id 查
/// 2. 没有
pub fn resolve_api_key(app: &tauri::AppHandle, id: &str) -> Result<Option<String>, String> {
    let config = nova_config::read_config(app);
    Ok(config
        .provider_secrets
        .get(id)
        .filter(|s| !s.is_empty())
        .cloned())
}
