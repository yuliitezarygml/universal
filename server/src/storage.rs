use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::catalog::SUITE_APPS;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredFileInfo {
    pub name: String,
    pub folder: String,
    pub category: String,
    pub size: u64,
    pub sha256: String,
    pub modified: String,
    pub download_url: String,
}

/// Detects which app a filename belongs to (e.g. "photocraft-0.20.1-macos.dmg" -> "photocraft")
pub fn detect_app_id(filename: &str) -> Option<&'static str> {
    let lower = filename.to_lowercase();
    for app in SUITE_APPS {
        let prefix_dash = format!("{}-", app.id);
        let prefix_underscore = format!("{}_", app.id);
        if lower.starts_with(&prefix_dash) || lower.starts_with(&prefix_underscore) || lower == app.id {
            return Some(app.id);
        }
        // Handle special cases like artcraft-launcher / craft-launcher
        if (app.id == "craft-launcher" || app.id == "artcraft-launcher")
            && (lower.starts_with("artcraft-launcher-") || lower.starts_with("craft-launcher-"))
        {
            return Some("craft-launcher");
        }
    }
    None
}

/// Returns the structured relative path for a file inside `storage_dir`.
/// e.g. "photocraft-0.20.1.dmg" -> "apps/photocraft/photocraft-0.20.1.dmg"
/// e.g. "custom-setup.exe" -> "uploads/custom-setup.exe"
pub fn file_subpath(filename: &str) -> PathBuf {
    if let Some(app_id) = detect_app_id(filename) {
        PathBuf::from("apps").join(app_id).join(filename)
    } else {
        PathBuf::from("uploads").join(filename)
    }
}

/// Returns the temporary path for a file during downloading
pub fn temp_subpath(filename: &str) -> PathBuf {
    PathBuf::from("temp").join(format!("{}.part", filename))
}

/// Locates where a file is saved on disk inside `storage_dir`
pub async fn locate_file(storage_dir: &Path, filename: &str) -> Option<PathBuf> {
    // 1. Check direct structured path
    let expected = storage_dir.join(file_subpath(filename));
    if expected.is_file() {
        return Some(expected);
    }

    // 2. Check flat legacy path
    let legacy = storage_dir.join(filename);
    if legacy.is_file() {
        return Some(legacy);
    }

    // 3. Search inside apps/ and uploads/
    let mut search_dirs = vec![storage_dir.join("apps"), storage_dir.join("uploads")];
    while let Some(dir) = search_dirs.pop() {
        if let Ok(mut entries) = fs::read_dir(&dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    search_dirs.push(path);
                } else if path.is_file() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name == filename {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }

    None
}

/// Calculate SHA-256 of a file on disk, with caching in `<filename>.sha256` sidecar
pub async fn compute_or_read_sha256(path: &Path) -> Result<String, std::io::Error> {
    let sidecar = path.with_extension(format!(
        "{}.sha256",
        path.extension().and_then(|s| s.to_str()).unwrap_or("")
    ));

    if let Ok(cached) = fs::read_to_string(&sidecar).await {
        let trimmed = cached.trim().to_string();
        if trimmed.len() == 64 {
            return Ok(trimmed);
        }
    }

    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let hash = hex::encode(hasher.finalize());
    let _ = fs::write(&sidecar, &hash).await;
    Ok(hash)
}

pub async fn list_storage_files(storage_dir: &Path, base_url: &str) -> Vec<StoredFileInfo> {
    let mut out = Vec::new();
    let mut dirs_to_scan = vec![storage_dir.to_path_buf()];

    while let Some(current_dir) = dirs_to_scan.pop() {
        let mut entries = match fs::read_dir(&current_dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let file_name = match entry.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };

            // Skip hidden, temp and sidecar files
            if file_name.starts_with('.') || file_name.ends_with(".part") || file_name.ends_with(".sha256") {
                continue;
            }

            if path.is_dir() {
                // Do not scan screenshots or temp directories as packages
                if file_name == "screenshots" || file_name == "temp" {
                    continue;
                }
                dirs_to_scan.push(path);
                continue;
            }

            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            let size = metadata.len();
            let modified = metadata
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                })
                .unwrap_or_else(|| "unknown".into());

            let sha256 = compute_or_read_sha256(&path)
                .await
                .unwrap_or_else(|_| "computing...".into());

            // Determine folder name relative to storage_dir
            let rel_folder = path
                .parent()
                .and_then(|p| p.strip_prefix(storage_dir).ok())
                .map(|p| p.display().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "root".into());

            let category = if rel_folder.starts_with("apps/") {
                let app_id = rel_folder.strip_prefix("apps/").unwrap_or(&rel_folder);
                SUITE_APPS
                    .iter()
                    .find(|a| a.id == app_id)
                    .map(|a| a.name.to_string())
                    .unwrap_or_else(|| app_id.to_string())
            } else if rel_folder == "uploads" {
                "Загрузки пользователя".to_string()
            } else {
                "Общее хранилище".to_string()
            };

            out.push(StoredFileInfo {
                name: file_name.clone(),
                folder: rel_folder,
                category,
                size,
                sha256,
                modified,
                download_url: format!("{}/downloads/{}", base_url, urlencoding_simple(&file_name)),
            });
        }
    }

    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub async fn delete_storage_file(storage_dir: &Path, filename: &str) -> Result<(), std::io::Error> {
    if filename.contains('/') || filename.contains('\\') || filename.starts_with('.') {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Invalid filename",
        ));
    }

    if let Some(target) = locate_file(storage_dir, filename).await {
        fs::remove_file(&target).await?;

        let sidecar = target.with_extension(format!(
            "{}.sha256",
            target.extension().and_then(|s| s.to_str()).unwrap_or("")
        ));
        if sidecar.exists() {
            let _ = fs::remove_file(&sidecar).await;
        }
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "File not found in storage",
        ))
    }
}

fn urlencoding_simple(s: &str) -> String {
    s.replace(' ', "%20")
}
