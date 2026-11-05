use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::catalog::SUITE_APPS;
use crate::downloader::start_download_task;
use crate::state::{AppState, DownloadTask, TaskStatus};
use crate::storage::list_storage_files;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppAssetStatus {
    pub name: String,
    pub size: u64,
    pub sha256: String,
    pub download_url: String,
    pub is_cached: bool,
    pub local_download_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppSyncStatus {
    pub id: String,
    pub name: String,
    pub repo: String,
    pub description: String,
    pub color: String,
    pub latest_tag: Option<String>,
    pub published_at: Option<String>,
    pub total_assets: usize,
    pub cached_assets: usize,
    pub assets: Vec<AppAssetStatus>,
}

pub async fn get_suite_sync_status(state: &AppState) -> Vec<AppSyncStatus> {
    let base_url = state.base_url.read().await.clone();
    let local_files = list_storage_files(&state.storage_dir, &base_url).await;
    let local_map: HashMap<String, String> = local_files
        .into_iter()
        .map(|f| (f.name, f.sha256))
        .collect();

    // Fetch upstream feed
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("ArtCraft-Server-Mirror/0.1.0")
        .build();

    let mut upstream_data: Option<Value> = None;
    if let Ok(c) = client {
        if let Ok(res) = c.get("https://api.storyteller.ai/v1/craft_apps/release_info").send().await {
            if res.status().is_success() {
                upstream_data = res.json().await.ok();
            }
        }
    }

    let mut result = Vec::new();

    for meta in SUITE_APPS {
        let mut app_status = AppSyncStatus {
            id: meta.id.to_string(),
            name: meta.name.to_string(),
            repo: meta.repo.to_string(),
            description: meta.description.to_string(),
            color: meta.color.to_string(),
            latest_tag: None,
            published_at: None,
            total_assets: 0,
            cached_assets: 0,
            assets: Vec::new(),
        };

        if let Some(root) = &upstream_data {
            let apps_dict = root
                .get("release_info")
                .and_then(|r| r.get("apps"))
                .or_else(|| root.get("apps"));

            if let Some(app_val) = apps_dict.and_then(|a| a.get(meta.id)) {
                if let Some(rel) = app_val.get("latest_release").or_else(|| app_val.get("release")) {
                    app_status.latest_tag = rel.get("tag").or_else(|| rel.get("tag_name")).and_then(|t| t.as_str()).map(str::to_string);
                    app_status.published_at = rel.get("published_at").and_then(|p| p.as_str()).map(str::to_string);

                    if let Some(assets) = rel.get("assets").and_then(|a| a.as_array()) {
                        app_status.total_assets = assets.len();
                        for a in assets {
                            let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                            if name.is_empty() { continue; }

                            let size = a.get("size_bytes").or_else(|| a.get("size")).and_then(|s| s.as_u64()).unwrap_or(0);
                            let sha256 = a.get("sha256").and_then(|s| s.as_str()).unwrap_or("").to_string();
                            let download_url = a.get("download_url").or_else(|| a.get("browser_download_url")).and_then(|u| u.as_str()).unwrap_or("").to_string();

                            let is_cached = local_map.contains_key(&name);
                            if is_cached {
                                app_status.cached_assets += 1;
                            }

                            app_status.assets.push(AppAssetStatus {
                                local_download_url: if is_cached {
                                    Some(format!("{}/downloads/{}", base_url, name))
                                } else {
                                    None
                                },
                                is_cached,
                                name,
                                size,
                                sha256,
                                download_url,
                            });
                        }
                    }
                }
            }
        }

        result.push(app_status);
    }

    // Append custom apps from PostgreSQL
    if let Some(db) = &state.db {
        let custom_apps = db.list_custom_apps().await;
        for ca in custom_apps {
            let mut assets = Vec::new();
            let mut cached = 0;
            for a in &ca.assets {
                let is_cached = local_map.contains_key(&a.filename);
                if is_cached {
                    cached += 1;
                }
                assets.push(AppAssetStatus {
                    name: a.filename.clone(),
                    size: a.size_bytes as u64,
                    sha256: a.sha256.clone(),
                    download_url: a.download_url.clone(),
                    is_cached,
                    local_download_url: if is_cached {
                        Some(format!("{}/downloads/{}", base_url, a.filename))
                    } else {
                        None
                    },
                });
            }
            result.push(AppSyncStatus {
                id: ca.id,
                name: ca.name,
                repo: ca.repo,
                description: ca.tagline,
                color: ca.color,
                latest_tag: Some(format!("v{}", ca.version)),
                published_at: Some(ca.updated_at),
                total_assets: assets.len(),
                cached_assets: cached,
                assets,
            });
        }
    }

    result
}

pub async fn queue_app_assets_sync(
    state: &AppState,
    app_id: &str,
    platform_filter: Option<&str>,
) -> Result<usize, String> {
    let suite = get_suite_sync_status(state).await;
    let app = suite.into_iter().find(|a| a.id == app_id).ok_or_else(|| format!("App '{}' not found", app_id))?;

    let mut queued = 0;
    for asset in app.assets {
        if asset.is_cached {
            continue; // Already downloaded
        }

        if let Some(filter) = platform_filter {
            let matches = match filter {
                "macos" => asset.name.ends_with(".dmg") || asset.name.contains("macos"),
                "windows" => asset.name.ends_with(".msi") || asset.name.ends_with(".exe") || asset.name.contains("windows"),
                "linux" => asset.name.ends_with(".AppImage") || asset.name.ends_with(".deb") || asset.name.ends_with(".rpm") || asset.name.ends_with(".flatpak") || asset.name.contains("linux"),
                _ => true,
            };
            if !matches {
                continue;
            }
        }

        let task_id = uuid::Uuid::new_v4().to_string();
        let task = DownloadTask {
            id: task_id.clone(),
            url: asset.download_url.clone(),
            filename: asset.name.clone(),
            status: TaskStatus::Pending,
            created_at: chrono::Local::now().format("%H:%M:%S").to_string(),
        };

        {
            let mut tasks = state.tasks.write().await;
            tasks.insert(task_id.clone(), task);
            let mut order = state.tasks_order.write().await;
            order.insert(0, task_id.clone());
        }

        let expected_sha256 = if asset.sha256.len() == 64 {
            Some(asset.sha256)
        } else {
            None
        };

        start_download_task(state.clone(), task_id, asset.download_url, asset.name, expected_sha256);
        queued += 1;
    }

    Ok(queued)
}

pub async fn queue_all_apps_sync(state: &AppState) -> usize {
    let mut total_queued = 0;
    for app in SUITE_APPS {
        if let Ok(q) = queue_app_assets_sync(state, app.id, None).await {
            total_queued += q;
        }
    }
    total_queued
}
