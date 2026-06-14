//! Provider registry backed by the unified `~/.nova/config.json`.
//!
//! Mirrors the opencode model: providers live outside SQLite so adding
//! or removing one is a single file edit and there is no DB migration
//! when the schema changes. Two sources contribute:
//!
//!   1. User-added entries written by Settings → `add_provider` /
//!      `remove_provider` commands. These persist to the JSON file.
//!   2. Built-in presets (OpenAI / Anthropic / Google) from Rust's
//!      static `PROVIDER_REGISTRY`. They appear in the list ONLY
//!      when the user has stored a matching API key in
//!      `config.json::provider_secrets` — otherwise they're hidden.
//!
//! Credentials are read exclusively from `~/.nova/config.json`.
//! Environment variables are NOT consulted.
//!
//! The Settings page can add and remove user providers; the chat
//! switcher can pick from either source.

use crate::nova_config;
use crate::provider::config::get_provider_config;

// Re-export the types that command handlers and other modules consume.
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

/// Compose the full provider list returned to the frontend.
///
/// Order:
///   1. Presets — only when a matching API key exists in
///      `provider_secrets`. Without a key the provider is unusable,
///      so hidden.
///   2. User-added entries — `OpenaiCompat` / `AnthropicCompat`.
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

/// Append a new user provider. Returns the new entry on success.
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

/// Apply a partial update to an existing provider.
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

/// Remove a user provider and its secret.
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

/// Read a provider's API key.
///
/// Resolution order (config.json ONLY — no env vars):
/// 1. `provider_secrets` by exact id
/// 2. None
pub fn resolve_api_key(app: &tauri::AppHandle, id: &str) -> Result<Option<String>, String> {
    let config = nova_config::read_config(app);
    Ok(config
        .provider_secrets
        .get(id)
        .filter(|s| !s.is_empty())
        .cloned())
}
