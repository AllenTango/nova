pub mod commands;
pub mod db;
pub mod astro;
pub mod http_server;
pub mod mcp;
pub mod nova_config;
pub mod provider;
pub mod providers;
pub mod templates;

use db::Database;
use astro::AstroManager;
use http_server::start_http_server;
use std::path::PathBuf;
use std::sync::Arc;
use directories::ProjectDirs;
use tauri::Manager;
use tokio::sync::Mutex;

fn get_nova_home() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("com", "nova", "Nova") {
        proj_dirs.data_dir().to_path_buf()
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".nova")
    }
}

fn ensure_session_token(db: &Database) {
    let existing = db.get_setting("session_token").ok().flatten();
    if existing.is_none() {
        let token = uuid::Uuid::new_v4().to_string();
        let _ = db.set_setting("session_token", &token);
        println!("[Nova] Generated new session token");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let nova_home = get_nova_home();
    std::fs::create_dir_all(&nova_home).expect("Failed to create nova home directory");

    let db_path = nova_home.join("nova.db");
    eprintln!("[DEBUG] Creating database at {:?}", db_path);
    let db = Database::new(db_path).expect("Failed to initialize database");
    eprintln!("[DEBUG] Database created OK");

    ensure_session_token(&db);
    eprintln!("[DEBUG] Session token OK");

    let astro_manager = AstroManager::new();
    eprintln!("[DEBUG] AstroManager OK");

    let config = nova_config::read_config_from(&nova_home);
    let nova_port = config.nova_port;
    eprintln!("[DEBUG] nova_port = {}", nova_port);

    // 把 Database 包进 Arc<Mutex<>>，支持 HTTP server 和 commands
    // 多个线程共享访问。
    let db_arc = Arc::new(Mutex::new(db));
    eprintln!("[DEBUG] db_arc wrapped OK");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(db_arc.clone())
        .manage(astro_manager)
        .invoke_handler(tauri::generate_handler![
            commands::sites::list_projects,
            commands::sites::get_project,
            commands::sites::create_project,
            commands::sites::upgrade_to_site,
            commands::sites::delete_project,
            commands::sites::get_preview_status,
            commands::sites::start_preview,
            commands::sites::stop_preview,
            commands::content::get_posts,
            commands::content::create_post,
            commands::content::update_post,
            commands::content::delete_post,
            commands::notes::list_notes,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::chat::ai_chat,
            commands::chat::list_models,
            commands::deploy::build_site,
            commands::settings::get_settings,
            commands::settings::get_default_target,
            commands::settings::save_settings,
            commands::settings::get_session_token,
            commands::providers::list_providers,
            commands::providers::add_provider,
            commands::providers::update_provider,
            commands::providers::remove_provider,
            commands::providers::resolve_provider_key,
            commands::settings::set_default_model,
            commands::settings::get_default_model,
        ])
        .setup(move |app| {
            let nova_home = get_nova_home();
            std::fs::create_dir_all(nova_home.join("projects")).ok();

            let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            let db_state = app.state::<Arc<Mutex<Database>>>();
            let db = db_state.inner().blocking_lock();
            let _ = db.repair_project_paths(&repo_root, &nova_home);
            // 一次性清理 SQLite 里的遗留 settings key。
            // 每次启动都跑都安全。
            commands::settings::purge_legacy_ai_keys(&db);
            drop(db);

            // ADR 0003 Stage 1：启动期迁移旧 config.json 至显式
            // default 字段。幂等，无副作用。失败只 eprintln，唔阻塞
            // app 启动——用户仍可手动调 set_default_model。
            if let Err(e) = nova_config::migrate_default_state(app.handle()) {
                eprintln!("[migrate_default_state] failed: {}", e);
            }

            let bad_runtime_root = repo_root.join("src-tauri").join("~");
            let _ = std::fs::remove_dir_all(&bad_runtime_root);

            println!("Nova home: {:?}", nova_home);

            // 后台启动 HTTP server
            let db_for_server = db_arc.clone();
            let port = nova_port;
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                start_http_server(db_for_server, port, Some(app_handle)).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}