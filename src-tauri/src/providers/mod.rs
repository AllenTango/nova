//! Provider 注册表，数据后端是统一的 `~/.nova/config.json`。
//!
//! 镜像 opencode 的模型：providers 放在 SQLite 之外，
//! 增删一个 provider 改一个文件就够，schema 变了也不用迁移 DB。
//! 两个数据源：
//!
//!   1. 用户添加的条目——由 Settings 里的 `add_provider` /
//!      `remove_provider` 命令写入。会持久化到 JSON 文件。
//!   2. 内置预设（OpenAI / Anthropic / Ollama）——来自 Rust 静态
//!      `PROVIDER_REGISTRY`。仅当用户在
//!      `config.json::provider_secrets` 里存了匹配的 API key
//!      时才出现在列表里；否则隐藏。
//!
//! 凭据只从 `~/.nova/config.json` 读。环境变量不参与。
//!
//! Settings 页可以增删用户 provider；chat 切换器可以从两个源
//! 里任选。

use crate::nova_config::{self, PresetOverride};
use crate::provider::config::get_provider_config;

// 再导出给 command handler 和其他模块用的类型。
pub use crate::nova_config::{
    FamilyKind, ModelEntry, NewProvider, PRESET_FAMILIES, ProviderEntry, ProviderSource,
    UpdateProvider,
};

fn make_preset_entry(
    family_id: &str,
    ov: Option<&PresetOverride>,
) -> Option<ProviderEntry> {
    let config = get_provider_config(family_id)?;
    // base_url 优先用 user 喺 Settings UI 改过嘅值，否则用 registry 嘅默认。
    let base_url = ov
        .and_then(|o| o.base_url.as_deref())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| config.default_base_url.to_string());
    // ADR 0003 Stage 2 cleanup：preset 路径唔再写入 `model` / `models`
    // 字段——default 嘅权威来源系 `NovaConfig.default_*_id`，
    // entry 本体只承载 base_url（user override）。
    Some(ProviderEntry {
        id: config.id.to_string(),
        label: config.name.to_string(),
        family: config.id.to_string(),
        base_url_editable: false,
        api_key_required: true,
        kind: FamilyKind::Preset,
        base_url,
        model: String::new(),
        models: Vec::new(),
        source: ProviderSource::Preset,
        // Preset 路径：api_key_masked 由 `list_all` 统一 populate
        // （基于 secrets 查表）。
        api_key_masked: None,
    })
}

/// 拼出返回给前端的完整 provider 列表。
///
/// 顺序：
///   1. 预设——仅当 `provider_secrets` 里有匹配的 API key。
///      没 key 的 provider 不可用，所以隐藏。
///   2. 用户添加的条目——`OpenaiCompat` / `AnthropicCompat`。
///
/// **Populate `api_key_masked`**（波士 2026-06-17）：根据 secrets 表
/// 喺 `list_all` 末尾统一注入——preset 路径同 user 路径都过呢个统一逻辑。
/// 冇 secret → `None`（frontend 输入框空白，placeholder 不显示「已配置」）。
/// 有 secret → `Some("••••xxxx")`（最后 4 位明文，前缀 `••••` 长度=长度-4）。
pub fn list_all(app: &tauri::AppHandle) -> Result<Vec<ProviderEntry>, String> {
    let secrets = nova_config::read_secrets(app);
    let preset_overrides = nova_config::read_preset_overrides(app);

    let presets: Vec<ProviderEntry> = PRESET_FAMILIES
        .iter()
        .filter_map(|f| make_preset_entry(f, preset_overrides.get(*f)))
        .filter(|p| secrets.get(&p.id).is_some_and(|k| !k.is_empty()))
        .collect();

    let user = nova_config::read_providers(app);

    let mut combined = presets;
    combined.extend(user);
    // 统一 populate `api_key_masked`：所有 entry 都过呢个逻辑，
    // preset 路径喺 filter 入面已 verified 有 secret，user 路径
    // 由 `read_providers` 本身带唔带 key 决定。
    for entry in combined.iter_mut() {
        entry.api_key_masked = secrets
            .get(&entry.id)
            .and_then(|k| if k.is_empty() { None } else { Some(mask_key(k)) });
    }
    Ok(combined)
}

/// API key 掩码生成：`••••xxxx`（最后 4 位明文 + 前面 `••••`）。
/// - key 长度 ≤ 4 → 全部掩码（`••••`，长度 = 原长度）
/// - key 长度 > 4 → 掩码部分长度 = `key.len() - 4`，最后 4 位明文
/// - 永远唔返明文 prefix
fn mask_key(key: &str) -> String {
    let len = key.chars().count();
    if len <= 4 {
        "•".repeat(len)
    } else {
        let mask_count = len - 4;
        let visible: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("{}{}", "•".repeat(mask_count), visible)
    }
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
        // ADR 0003 Stage 2 cleanup：`model` 字段不写入——default 嘅
        // 权威来源系 NovaConfig.default_*_id，entry 唔重复存。
        // 用户选定嘅 model 已经通过下方 set_default 逻辑写入顶层字段。
        model: String::new(),
        models: Vec::new(),
        source: ProviderSource::User,
        // 新建路径：api_key_masked 由 caller 决定——通常 `add` 入面会
        // 立即调 `list_all` 重新拉取（populate masked），呢度保持 None。
        api_key_masked: None,
    };
    providers.push(entry.clone());
    nova_config::write_providers(app, &providers)?;

    if !new.api_key.is_empty() {
        nova_config::write_secret(app, &id, &new.api_key)?;
    }

    // ADR 0003 Stage 2：若 default 未初始化，自动用新 entry 嘅
    // model 初始化 default。**再次添加**（default 已存在）→ 唔动，
    // 避免 silent override 当前 default 状态。
    let mut config = nova_config::read_config(app);
    if config.default_provider_id.is_none() && !new.model.trim().is_empty() {
        config.default_provider_id = Some(id.clone());
        config.default_model_id = Some(new.model.trim().to_string());
        nova_config::write_config(app, &config)?;
    }

    Ok(entry)
}

/// 对已存在的 provider 应用部分更新。自定义 provider 可藉 `new_id` 重命名。
pub fn update(app: &tauri::AppHandle, patch: UpdateProvider) -> Result<ProviderEntry, String> {
    let id = patch.id.clone();

    let mut config = nova_config::read_config(app);

    // 用 index 定位：先 immutable find（住喺 idx），再 mutable index。
    let idx = config.providers.iter().position(|p| p.id == id);

    // ── User provider 路径 ────────────────────────────────
    if let Some(idx) = idx {
        let old_id = config.providers[idx].id.clone();

        // 唯一性检查：此时只持有 immutable borrow，无冲突。
        if let Some(ref new_id) = patch.new_id {
            let new_id = new_id.trim().to_string();
            if new_id.is_empty() {
                return Err("provider id cannot be empty".into());
            }
            if !new_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err(
                    "provider id may only contain letters, digits, '-', '_', '.'".into(),
                );
            }
            if PRESET_FAMILIES.contains(&new_id.as_str()) {
                return Err(format!("provider id '{new_id}' is reserved for preset"));
            }
            if config.providers.iter().any(|p| p.id == new_id && p.id != old_id) {
                return Err(format!("provider id already exists: {new_id}"));
            }
        }

        // 现在开始 mutation——fresh mutable borrow
        let entry = &mut config.providers[idx];

        if let Some(new_id) = patch.new_id {
            let new_id = new_id.trim().to_string();
            entry.id = new_id.clone();
            // 移动 secret 到新 id
            if let Some(key) = config.provider_secrets.remove(&old_id) {
                config.provider_secrets.insert(new_id.clone(), key);
            }
            // 如果重命名嘅系当前 default provider，同步更新 default 指针
            if config.default_provider_id.as_deref() == Some(&old_id) {
                config.default_provider_id = Some(new_id);
            }
        }

        let current_id = entry.id.clone();

        if let Some(label) = patch.label {
            entry.label = label;
        }
        if let Some(base_url) = patch.base_url {
            entry.base_url = base_url;
        }

        // 处理 api_key 更新
        if let Some(key) = patch.api_key {
            if key.is_empty() {
                config.provider_secrets.remove(&current_id);
            } else {
                config.provider_secrets.insert(current_id, key);
            }
        }

        let updated = entry.clone();
        nova_config::write_config(app, &config)?;
        return Ok(updated);
    }

    // ── 非 user provider：预设路径 ────────────────────────
    if !PRESET_FAMILIES.contains(&id.as_str()) {
        return Err(format!("provider not found: {id}"));
    }
    // Preset 路径：entry 唔写进 `providers` 数组，base_url 持久化
    // 去 `preset_overrides` map。secret 仍然写去 `provider_secrets`。
    // `make_preset_entry` 读呢两个 map 重新组装 entry 返俾前端。
    let existing = nova_config::read_preset_overrides(app);
    let mut ov = existing.get(&id).cloned().unwrap_or_default();
    // ADR 0003 Stage 2 cleanup：移除 patch.model 处理——preset 路径
    // 嘅 model 写入亦改走独立 `set_default_model` command。
    if let Some(base_url) = patch.base_url {
        if base_url.trim().is_empty() {
            ov.base_url = None;
        } else {
            ov.base_url = Some(base_url);
        }
    }
    nova_config::write_preset_override(app, &id, &ov)?;

    if let Some(api_key) = patch.api_key {
        if api_key.is_empty() {
            nova_config::clear_secret(app, &id)?;
        } else {
            nova_config::write_secret(app, &id, &api_key)?;
        }
    }

    // 用最新 override 重新构造 entry 返俾前端。
    make_preset_entry(&id, Some(&ov)).ok_or_else(|| format!("invalid preset: {id}"))
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
