use std::path::{Path, PathBuf};

/// 定位仓库级 templates 目录（开发态用）。
///
/// 生产打包时这里会改成 Tauri resources 路径。眼下优先
/// dev-mode：`src-tauri/` 是当前 crate 目录，仓库根就是它
/// 上一级。
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
    // v1 实际只发版一个真实的 `blog` 模板。其他模板 id 是 UI 里
    // 的合法选项，但会安全地回退到 `blog`
    // 直到对应文件实现为止。这保 UX 诚实：
    // 操作成功，用户拿到一个可用的站点，而不是错误。
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

        // 永远不把生成产物或机器本地工件复制进新站点。
        // 这些会让新项目夹带噪声。
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
            // 升级时不覆盖用户已创建的笔记。
            if to.exists() && to.extension().map(|e| e == "md").unwrap_or(false) {
                continue;
            }
            std::fs::copy(&from, &to)
                .map_err(|e| format!("failed to copy {} -> {}: {}", from.display(), to.display(), e))?;
        }
    }

    Ok(())
}
