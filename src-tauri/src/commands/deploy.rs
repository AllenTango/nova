use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Serialize, Deserialize)]
pub struct BuildResult {
    pub output_dir: String,
    pub success: bool,
    pub message: String,
}

/// v1 的最小化部署/构建循环：
/// 1. 确保项目是 site（有 package.json）
/// 2. 没装依赖就装
/// 3. 跑 `npm run build`
/// 4. 返回 dist/ 目录路径
///
/// 这刻意先做"本地导出"——在推到外部平台前，先跑通
/// 写作 → 预览 → 可构建产物 整条链路。
#[tauri::command]
pub fn build_site(site_path: String) -> Result<BuildResult, String> {
    let path = PathBuf::from(&site_path);

    if !path.join("package.json").exists() {
        return Err("This project is not a site yet. Upgrade it to a site first.".to_string());
    }

    if !path.join("node_modules").exists() {
        let status = Command::new("npm")
            .args(["install"])
            .current_dir(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .status()
            .map_err(|e| format!("Failed to install site dependencies: {}", e))?;
        if !status.success() {
            return Err("Failed to install site dependencies with npm install".to_string());
        }
    }

    let output = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to build site: {}", e))?;

    let success = output.status.success();
    let mut message = String::new();
    message.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !message.is_empty() {
            message.push('\n');
        }
        message.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    let dist = path.join("dist");

    Ok(BuildResult {
        output_dir: dist.to_string_lossy().to_string(),
        success,
        message,
    })
}
