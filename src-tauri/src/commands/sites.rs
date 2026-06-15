use crate::astro::AstroManager;
use crate::db::{Database, Project};
use crate::templates::apply_template;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;
use uuid::Uuid;
use chrono::Utc;

type SharedDatabase = Arc<Mutex<Database>>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub template: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Project> for ProjectInfo {
    fn from(p: Project) -> Self {
        ProjectInfo {
            id: p.id,
            name: p.name,
            kind: p.kind,
            template: p.template,
            path: p.path,
            created_at: p.created_at,
            updated_at: p.updated_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewStatus {
    pub is_running: bool,
    pub current_site: Option<String>,
    pub url: Option<String>,
}

#[tauri::command]
pub async fn list_projects(db: State<'_, SharedDatabase>) -> Result<Vec<ProjectInfo>, String> {
    let db = db.lock().await;
    db.get_all_projects()
        .map(|ps| ps.into_iter().map(ProjectInfo::from).collect())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_project(id: String, db: State<'_, SharedDatabase>) -> Result<Option<ProjectInfo>, String> {
    let db = db.lock().await;
    db.get_project(&id)
        .map(|opt| opt.map(ProjectInfo::from))
        .map_err(|e| e.to_string())
}

/// 创建新项目。Kind 在创建时决定：
///   - "note" → 一个带 `notes/` 子目录的目录
///   - "site" → 一个准备好接 Astro 项目的目录
#[tauri::command]
pub async fn create_project(
    name: String,
    kind: String,
    template: String,
    db: State<'_, SharedDatabase>,
) -> Result<ProjectInfo, String> {
    if kind != "note" && kind != "site" {
        return Err(format!("invalid kind: {}", kind));
    }
    if kind == "site" && template.is_empty() {
        return Err("template required for site projects".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let base_home = resolve_nova_home();
    let project_path = format!("{}/projects/{}", base_home, id);

    let path = PathBuf::from(&project_path);
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create project directory: {}", e))?;
    std::fs::create_dir_all(path.join("notes"))
        .map_err(|e| format!("Failed to create notes directory: {}", e))?;

    if kind == "site" {
        apply_template(&template, &path)?;
    }

    let project = Project {
        id,
        name: name.clone(),
        kind: kind.clone(),
        template,
        path: project_path,
        created_at: now,
        updated_at: now,
    };

    let db = db.lock().await;
    db.create_project(&project).map_err(|e| e.to_string())?;
    Ok(ProjectInfo::from(project))
}

fn resolve_nova_home() -> String {
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "nova", "Nova") {
        return proj_dirs.data_dir().to_string_lossy().to_string();
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from(".")).join(".nova")
        .to_string_lossy().to_string()
}

/// 通过挂载模板把 note 项目升级为 site 项目。
#[tauri::command]
pub async fn upgrade_to_site(
    id: String,
    template: String,
    db: State<'_, SharedDatabase>,
) -> Result<ProjectInfo, String> {
    if template.is_empty() {
        return Err("template required".to_string());
    }
    let db = db.lock().await;
    let project = db
        .get_project(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "project not found".to_string())?;

    apply_template(&template, &PathBuf::from(&project.path))?;

    db.upgrade_to_site(&id, &template)
        .map_err(|e| e.to_string())?;
    db.get_project(&id)
        .map_err(|e| e.to_string())?
        .map(ProjectInfo::from)
        .ok_or_else(|| "project not found after upgrade".to_string())
}

#[tauri::command]
pub async fn delete_project(id: String, db: State<'_, SharedDatabase>) -> Result<(), String> {
    let db = db.lock().await;
    db.delete_project(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_preview_status(astro: State<AstroManager>) -> PreviewStatus {
    let current_site = astro.get_current_site();
    PreviewStatus {
        is_running: current_site.is_some(),
        url: current_site.as_ref().map(|_| "http://localhost:4321".to_string()),
        current_site,
    }
}

#[tauri::command]
pub fn start_preview(site_path: String, port: u16, astro: State<AstroManager>) -> Result<String, String> {
    let path = PathBuf::from(site_path);
    astro.start_preview(path, port)
}

#[tauri::command]
pub fn stop_preview(astro: State<AstroManager>) -> Result<(), String> {
    astro.stop_preview()
}
