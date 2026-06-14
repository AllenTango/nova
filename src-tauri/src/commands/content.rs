use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub title: String,
    pub r#type: String,
    pub content: String,
    pub tags: Vec<String>,
    pub date: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePostRequest {
    pub site_id: String,
    pub title: String,
    pub r#type: String,
    pub content: String,
    pub tags: Vec<String>,
}

#[tauri::command]
pub fn get_posts(site_path: String) -> Result<Vec<Post>, String> {
    let content_dir = PathBuf::from(&site_path).join("content/posts");
    if !content_dir.exists() {
        return Ok(vec![]);
    }

    let mut posts = Vec::new();
    let entries = std::fs::read_dir(&content_dir)
        .map_err(|e| format!("Failed to read content directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let id = path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();

                let (frontmatter, body) = extract_frontmatter(&content);
                let title = frontmatter.get("title")
                    .cloned()
                    .unwrap_or_else(|| "Untitled".to_string());
                let r#type = frontmatter.get("type")
                    .cloned()
                    .unwrap_or_else(|| "blog".to_string());
                let tags_str = frontmatter.get("tags")
                    .cloned()
                    .unwrap_or_default();
                let tags: Vec<String> = tags_str
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                let date = frontmatter.get("date")
                    .cloned()
                    .unwrap_or_else(|| "".to_string());

                posts.push(Post {
                    id,
                    title,
                    r#type,
                    content: body,
                    tags,
                    date,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    posts.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(posts)
}

#[tauri::command]
pub fn create_post(site_path: String, title: String, post_type: String, content: String, tags: Vec<String>) -> Result<Post, String> {
    let content_dir = PathBuf::from(&site_path).join("content/posts");
    std::fs::create_dir_all(&content_dir)
        .map_err(|e| format!("Failed to create content directory: {}", e))?;

    let slug = generate_slug(&title);
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let filename = format!("{}-{}.md", date, slug);
    let file_path = content_dir.join(&filename);

    let frontmatter = format!(
        "---\ntype: {}\ntitle: {}\ndate: {}\ntags: [{}]\n---\n\n{}",
        post_type,
        title,
        date,
        tags.join(", "),
        content
    );

    std::fs::write(&file_path, frontmatter)
        .map_err(|e| format!("Failed to write post file: {}", e))?;

    Ok(Post {
        id: slug,
        title,
        r#type: post_type,
        content,
        tags,
        date,
        path: file_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn update_post(path: String, title: String, content: String, tags: Vec<String>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err("Post file not found".to_string());
    }

    let file_content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read post file: {}", e))?;

    let (frontmatter, _) = extract_frontmatter(&file_content);
    let post_type = frontmatter.get("type")
        .cloned()
        .unwrap_or_else(|| "blog".to_string());
    let date = frontmatter.get("date")
        .cloned()
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    let new_content = format!(
        "---\ntype: {}\ntitle: {}\ndate: {}\ntags: [{}]\n---\n\n{}",
        post_type,
        title,
        date,
        tags.join(", "),
        content
    );

    std::fs::write(&file_path, new_content)
        .map_err(|e| format!("Failed to write post file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_post(path: String) -> Result<(), String> {
    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete post: {}", e))
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
                    if key == "tags" {
                        let tags: Vec<String> = value
                            .trim_matches(|c| c == '[' || c == ']')
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                        map.insert(key, tags.join(", "));
                    } else {
                        map.insert(key, value);
                    }
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
