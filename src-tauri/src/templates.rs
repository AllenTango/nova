use std::path::{Path, PathBuf};

/// Locate the repo-level templates directory during development.
///
/// Production packaging will later move this to Tauri resources. For now,
/// dev-mode is the priority: `src-tauri/` is the current crate dir, so the
/// project root is one level above it.
fn templates_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .ok_or_else(|| "failed to locate project root".to_string())?
        .join("templates");
    if root.exists() {
        Ok(root)
    } else {
        Err(format!("templates directory not found: {}", root.display()))
    }
}

pub fn apply_template(template: &str, target: &Path) -> Result<(), String> {
    // v1 only ships a real `blog` template. The rest of the template ids are
    // valid product choices in the UI, but they safely fall back to `blog`
    // until their dedicated files are implemented. This keeps the UX honest:
    // the action succeeds and the user gets a working site instead of an error.
    let resolved = resolve_template(template);
    let source = templates_root()?.join(resolved);
    if !source.exists() {
        return Err(format!("template not found: {}", resolved));
    }
    copy_dir_all(&source, target)
}

fn resolve_template(template: &str) -> &str {
    match template {
        "blog" => "blog",
        "gallery" => "blog",
        "vlog" => "blog",
        "blog-gallery" => "blog",
        "corporate" => "blog",
        "agent-home" => "blog",
        _ => "blog",
    }
}

fn copy_dir_all(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target)
        .map_err(|e| format!("failed to create {}: {}", target.display(), e))?;

    for entry in std::fs::read_dir(source)
        .map_err(|e| format!("failed to read {}: {}", source.display(), e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());

        let name = entry.file_name();
        let name = name.to_string_lossy();

        // Never copy generated or machine-local artifacts into a new site.
        // These caused "产物出现在项目内" and made fresh projects noisy.
        if name == "dist"
            || name == "node_modules"
            || name == ".astro"
            || name == "package-lock.json"
        {
            continue;
        }

        if file_type.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            // Do not overwrite user-created notes when upgrading.
            if to.exists() && to.extension().map(|e| e == "md").unwrap_or(false) {
                continue;
            }
            std::fs::copy(&from, &to)
                .map_err(|e| format!("failed to copy {} -> {}: {}", from.display(), to.display(), e))?;
        }
    }

    Ok(())
}
