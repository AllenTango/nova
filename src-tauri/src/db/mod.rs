use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// A project is the top-level container. It can be:
/// - "note":  just a folder of Markdown files, no Astro engine
/// - "site":  an Astro project that can be previewed and deployed
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// "note" | "site"
    pub kind: String,
    /// Only meaningful when kind == "site"
    pub template: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&path)?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Migrate: create the new projects table if missing.
        // We deliberately do not try to preserve the old `sites` table —
        // this is greenfield code, no production data to migrate.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'note',
                template TEXT NOT NULL DEFAULT '',
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_projects_kind ON projects(kind)",
            [],
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS deploy_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                status TEXT NOT NULL,
                deployed_at INTEGER NOT NULL
            )",
            [],
        )?;
        Ok(())
    }

    pub fn create_project(&self, p: &Project) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, kind, template, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![p.id, p.name, p.kind, p.template, p.path, p.created_at, p.updated_at],
        )?;
        Ok(())
    }

    pub fn get_all_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, template, path, created_at, updated_at FROM projects ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_project)?;
        rows.collect()
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, template, path, created_at, updated_at FROM projects WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row_to_project(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Convert a note project into a site project by attaching a template.
    pub fn upgrade_to_site(&self, id: &str, template: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE projects SET kind = 'site', template = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, template, now],
        )?;
        Ok(())
    }

    /// A downgrade path is intentionally not provided — once a site,
    /// it's a site. (Could be added later if needed.)

    pub fn touch(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    /// Repair early broken paths that accidentally wrote runtime data inside
    /// the repo, e.g. `<repo>/src-tauri/~/.nova/projects/<id>`.
    ///
    /// We migrate both the on-disk directory and the DB path to the proper
    /// Nova data dir. Safe to run on every boot.
    pub fn repair_project_paths(&self, repo_root: &PathBuf, nova_home: &PathBuf) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, path FROM projects")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let broken_prefix = repo_root
            .join("src-tauri")
            .join("~")
            .join(".nova")
            .join("projects")
            .to_string_lossy()
            .to_string();

        for row in rows {
            let (id, path) = row?;
            if !path.starts_with(&broken_prefix) {
                continue;
            }

            let from = PathBuf::from(&path);
            let to = nova_home.join("projects").join(&id);

            if from.exists() {
                if let Some(parent) = to.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if !to.exists() {
                    let _ = std::fs::rename(&from, &to);
                }
            }

            conn.execute(
                "UPDATE projects SET path = ?2 WHERE id = ?1",
                params![id, to.to_string_lossy().to_string()],
            )?;
        }

        Ok(())
    }
}

fn row_to_project(row: &rusqlite::Row) -> Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        template: row.get(3)?,
        path: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
