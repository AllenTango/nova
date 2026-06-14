use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub date: String,
    pub path: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateNoteRequest {
    pub project_path: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
}

#[tauri::command]
pub fn list_notes(project_path: String) -> Result<Vec<Note>, String> {
    let notes_dir = PathBuf::from(&project_path).join("notes");
    if !notes_dir.exists() {
        return Ok(vec![]);
    }

    let mut notes = Vec::new();
    let entries = std::fs::read_dir(&notes_dir)
        .map_err(|e| format!("Failed to read notes directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let id = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                let (frontmatter, body) = extract_frontmatter(&content);
                let title = frontmatter
                    .get("title")
                    .cloned()
                    .unwrap_or_else(|| "Untitled".to_string());
                let date = frontmatter
                    .get("date")
                    .cloned()
                    .unwrap_or_default();
                let tags: Vec<String> = frontmatter
                    .get("tags")
                    .cloned()
                    .map(|s| {
                        s.split(',')
                            .map(|x| x.trim().to_string())
                            .filter(|x| !x.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();

                notes.push(Note {
                    id,
                    title,
                    content: body,
                    date,
                    path: path.to_string_lossy().to_string(),
                    tags,
                });
            }
        }
    }

    notes.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(notes)
}

#[tauri::command]
pub fn create_note(
    project_path: String,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<Note, String> {
    let notes_dir = PathBuf::from(&project_path).join("notes");
    std::fs::create_dir_all(&notes_dir)
        .map_err(|e| format!("Failed to create notes directory: {}", e))?;

    let slug = generate_slug(&title);
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let filename = format!("{}-{}.md", date, slug);
    let file_path = notes_dir.join(&filename);

    let frontmatter = format!(
        "---\ntitle: {}\ndate: {}\ntags: [{}]\n---\n\n{}",
        title,
        date,
        tags.join(", "),
        content
    );

    std::fs::write(&file_path, frontmatter)
        .map_err(|e| format!("Failed to write note: {}", e))?;

    Ok(Note {
        id: slug,
        title,
        content,
        date,
        path: file_path.to_string_lossy().to_string(),
        tags,
    })
}

#[tauri::command]
pub fn update_note(
    path: String,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("Note file not found".to_string());
    }

    let existing = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read note: {}", e))?;
    let (frontmatter, _) = extract_frontmatter(&existing);
    let date = frontmatter
        .get("date")
        .cloned()
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    let new_content = format!(
        "---\ntitle: {}\ndate: {}\ntags: [{}]\n---\n\n{}",
        title,
        date,
        tags.join(", "),
        content
    );

    std::fs::write(&file_path, new_content)
        .map_err(|e| format!("Failed to write note: {}", e))
}

#[tauri::command]
pub fn delete_note(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete note: {}", e))
}

fn extract_frontmatter(content: &str) -> (std::collections::HashMap<String, String>, String) {
    let mut map = std::collections::HashMap::new();
    let mut body = content.to_string();

    if content.starts_with("---") {
        if let Some(end_pos) = content[3..].find("---") {
            let frontmatter = &content[3..end_pos + 3];
            body = content[end_pos + 6..].to_string();

            for line in frontmatter.lines() {
                if let Some(colon_pos) = line.find(':') {
                    let key = line[..colon_pos].trim().to_string();
                    let value = line[colon_pos + 1..].trim().to_string();
                    map.insert(key, value);
                }
            }
        }
    }

    (map, body)
}

fn generate_slug(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .take(6)
        .collect::<Vec<_>>()
        .join("-")
}
