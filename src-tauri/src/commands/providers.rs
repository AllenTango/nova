use crate::providers::{self, NewProvider, ProviderEntry, UpdateProvider};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_providers(app: AppHandle) -> Result<Vec<ProviderEntry>, String> {
    providers::list_all(&app)
}

#[tauri::command]
pub async fn add_provider(app: AppHandle, provider: NewProvider) -> Result<ProviderEntry, String> {
    providers::add(&app, provider)
}

#[tauri::command]
pub async fn update_provider(
    app: AppHandle,
    patch: UpdateProvider,
) -> Result<ProviderEntry, String> {
    providers::update(&app, patch)
}

#[tauri::command]
pub async fn remove_provider(app: AppHandle, id: String) -> Result<(), String> {
    providers::remove(&app, &id)
}

/// 解析某 provider id 的 API key。未配置时返回 null。
/// 前端在发 chat 请求时用此填充 Authorization header。
#[tauri::command]
pub async fn resolve_provider_key(app: AppHandle, id: String) -> Result<Option<String>, String> {
    providers::resolve_api_key(&app, &id)
}
