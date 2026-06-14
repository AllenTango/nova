use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::path::PathBuf;

pub struct AstroManager {
    current_process: Mutex<Option<Child>>,
    current_site_path: Mutex<Option<String>>,
}

impl AstroManager {
    pub fn new() -> Self {
        AstroManager {
            current_process: Mutex::new(None),
            current_site_path: Mutex::new(None),
        }
    }

    pub fn start_preview(&self, site_path: PathBuf, port: u16) -> Result<String, String> {
        let mut process_guard = self.current_process.lock().unwrap();
        let mut path_guard = self.current_site_path.lock().unwrap();

        if let Some(ref mut child) = *process_guard {
            let _ = child.kill();
            let _ = child.wait();
        }

        if !site_path.join("package.json").exists() {
            return Err("This project is not an Astro site yet. Upgrade it to a site first.".to_string());
        }

        if !site_path.join("node_modules").exists() {
            let status = Command::new("npm")
                .args(["install"])
                .current_dir(&site_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .status()
                .map_err(|e| format!("Failed to install site dependencies: {}", e))?;
            if !status.success() {
                return Err("Failed to install site dependencies with npm install".to_string());
            }
        }

        let child = Command::new("npm")
            .args(["run", "dev", "--", "--host", "0.0.0.0", "--port", &port.to_string()])
            .current_dir(&site_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start Astro dev server: {}", e))?;

        *process_guard = Some(child);
        *path_guard = Some(site_path.to_string_lossy().to_string());

        let url = format!("http://localhost:{}", port);
        Ok(url)
    }

    pub fn stop_preview(&self) -> Result<(), String> {
        let mut process_guard = self.current_process.lock().unwrap();
        let mut path_guard = self.current_site_path.lock().unwrap();

        if let Some(ref mut child) = process_guard.take() {
            child.kill().map_err(|e| format!("Failed to stop Astro: {}", e))?;
            child.wait().map_err(|e| format!("Failed to wait for Astro: {}", e))?;
        }

        *path_guard = None;
        Ok(())
    }

    pub fn get_current_site(&self) -> Option<String> {
        self.current_site_path.lock().unwrap().clone()
    }

    pub fn switch_site(&self, site_path: PathBuf, port: u16) -> Result<String, String> {
        self.start_preview(site_path, port)
    }
}

impl Default for AstroManager {
    fn default() -> Self {
        Self::new()
    }
}
