use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// 项目是顶层容器。可以是：
/// - "note"：纯 Markdown 文件夹，无 Astro 引擎
/// - "site"：Astro 项目，可预览可部署
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    /// "note" | "site"
    pub kind: String,
    /// 仅当 kind == "site" 时才有意义
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

        // 迁移：建新 projects 表（如果还没建）。
        // 我们刻意不保留旧 `sites` 表——这是 greenfield 代码，
        // 没什么生产数据要迁移。
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

    /// 通过挂上模板，把 note 项目升级为 site 项目。
    pub fn upgrade_to_site(&self, id: &str, template: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE projects SET kind = 'site', template = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, template, now],
        )?;
        Ok(())
    }

    /// 故意不提供降级路径——一旦是 site，就是 site。
    /// （有需要的话日后可以加。）

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

    /// 修复早期意外把运行时数据写到 repo 里的破路径，
    /// 例如 `<repo>/src-tauri/~/.nova/projects/<id>`。
    ///
    /// 我们把磁盘目录和 DB 路径都迁到正确的 Nova 数据目录。
    /// 每次启动都跑都安全。
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
