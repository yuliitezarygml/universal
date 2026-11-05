use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::state::AppState;
use crate::storage::list_storage_files;

const UPSTREAM_FEED_URL: &str = "https://api.storyteller.ai/v1/craft_apps/release_info";

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct UpstreamAsset {
    pub name: String,
    pub upstream_url: String,
    pub size: u64,
    pub sha256: String,
}

pub static KNOWN_UPSTREAM_ASSETS: LazyLock<Arc<RwLock<HashMap<String, UpstreamAsset>>>> =
    LazyLock::new(|| Arc::new(RwLock::new(HashMap::new())));

pub async fn find_upstream_asset(name: &str) -> Option<UpstreamAsset> {
    let map = KNOWN_UPSTREAM_ASSETS.read().await;
    map.get(name).cloned()
}

pub async fn get_release_info(state: AppState) -> Value {
    let base_url = state.base_url.read().await.clone();
    let local_files = list_storage_files(&state.storage_dir, &base_url).await;
    let local_map: HashMap<String, (String, u64, String)> = local_files
        .into_iter()
        .map(|f| (f.name.clone(), (f.download_url, f.size, f.sha256)))
        .collect();

    // Try fetching official upstream feed with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("ArtCraft-Server-Mirror/0.1.0")
        .build();

    let mut upstream_json: Option<Value> = None;
    if let Ok(c) = client {
        if let Ok(res) = c.get(UPSTREAM_FEED_URL).send().await {
            if res.status().is_success() {
                if let Ok(j) = res.json::<Value>().await {
                    upstream_json = Some(j);
                }
            }
        }
    }

    if let Some(mut root) = upstream_json {
        let mut new_known_assets = HashMap::new();

        // Parse apps and rewrite download URLs to point to our local server
        let mut apps_container = if root.get("apps").is_some() {
            root.get_mut("apps")
        } else {
            root.get_mut("release_info").and_then(|r| r.get_mut("apps"))
        };

        if let Some(apps) = apps_container.as_mut().and_then(|a| a.as_object_mut()) {
            for (_app_name, app_val) in apps.iter_mut() {
                let release = if app_val.get("release").is_some() {
                    app_val.get_mut("release")
                } else {
                    app_val.get_mut("latest_release")
                };

                if let Some(release) = release {
                    if let Some(assets) = release.get_mut("assets").and_then(|a| a.as_array_mut()) {
                        for asset in assets.iter_mut() {
                            if let Some(name) = asset.get("name").and_then(|n| n.as_str()).map(str::to_string) {
                                let orig_url = asset
                                    .get("browser_download_url")
                                    .or_else(|| asset.get("download_url"))
                                    .and_then(|u| u.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                let orig_size = asset
                                    .get("size")
                                    .or_else(|| asset.get("size_bytes"))
                                    .and_then(|s| s.as_u64())
                                    .unwrap_or(0);

                                let orig_sha256 = asset
                                    .get("sha256")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("")
                                    .to_string();

                                if !orig_url.is_empty() {
                                    new_known_assets.insert(
                                        name.clone(),
                                        UpstreamAsset {
                                            name: name.clone(),
                                            upstream_url: orig_url,
                                            size: orig_size,
                                            sha256: orig_sha256.clone(),
                                        },
                                    );
                                }

                                // Always route through our server mirror:
                                // http://<server>/downloads/<filename>
                                let local_server_url = format!("{}/downloads/{}", base_url, name);
                                asset["browser_download_url"] = json!(local_server_url);
                                asset["download_url"] = json!(local_server_url);

                                if let Some((_, local_size, local_hash)) = local_map.get(&name) {
                                    asset["size"] = json!(local_size);
                                    asset["size_bytes"] = json!(local_size);
                                    asset["sha256"] = json!(local_hash);
                                    asset["is_local_mirror"] = json!(true);
                                    asset["status"] = json!("cached_locally");
                                } else {
                                    asset["is_local_mirror"] = json!(false);
                                    asset["status"] = json!("on_demand_proxy");
                                }
                            }
                        }
                    }
                }
            }
        }

        // Update global asset cache
        if !new_known_assets.is_empty() {
            let mut cache = KNOWN_UPSTREAM_ASSETS.write().await;
            for (k, v) in new_known_assets {
                cache.insert(k, v);
            }
        }

        // Inject Custom Apps from database
        let custom_apps = if let Some(db) = &state.db {
            db.list_custom_apps().await
        } else {
            Vec::new()
        };

        let mut custom_catalog_entries = Vec::new();

        if let Some(apps) = apps_container.as_mut().and_then(|a| a.as_object_mut()) {
            for ca in &custom_apps {
                let app_assets: Vec<Value> = ca.assets.iter().map(|a| {
                    let local_server_url = format!("{}/downloads/{}", base_url, a.filename);
                    json!({
                        "name": a.filename,
                        "browser_download_url": local_server_url,
                        "download_url": local_server_url,
                        "sha256": a.sha256,
                        "size": a.size_bytes,
                        "size_bytes": a.size_bytes,
                        "is_local_mirror": true,
                        "status": "cached_locally",
                        "platform": {
                            "os": a.platform_os,
                            "arch": a.platform_arch,
                            "package_type": a.package_type
                        }
                    })
                }).collect();

                let app_entry = json!({
                    "name": ca.name,
                    "repo": ca.repo,
                    "app_last_fetched": chrono::Utc::now().to_rfc3339(),
                    "latest_release": {
                        "name": format!("{} v{}", ca.name, ca.version),
                        "tag": format!("v{}", ca.version),
                        "version": ca.version,
                        "notes_markdown": ca.notes,
                        "published_at": ca.updated_at,
                        "html_url": format!("{}/apps/{}", base_url, ca.id),
                        "assets": app_assets
                    }
                });

                apps.insert(ca.id.clone(), app_entry);

                custom_catalog_entries.push(json!({
                    "id": ca.id,
                    "name": ca.name,
                    "tagline": ca.tagline,
                    "repo": ca.repo,
                    "color": ca.color,
                    "version": ca.version,
                    "mac_team": ca.mac_team
                }));
            }
        }

        root["custom_catalog"] = json!(custom_catalog_entries);
        root
    } else {
        // Fallback: local standalone feed
        let mut feed = generate_local_feed(&local_map, &base_url);
        let custom_apps = if let Some(db) = &state.db {
            db.list_custom_apps().await
        } else {
            Vec::new()
        };

        let mut custom_catalog_entries = Vec::new();
        if let Some(apps) = feed.get_mut("apps").and_then(|a| a.as_object_mut()) {
            for ca in &custom_apps {
                let app_assets: Vec<Value> = ca.assets.iter().map(|a| {
                    let local_server_url = format!("{}/downloads/{}", base_url, a.filename);
                    json!({
                        "name": a.filename,
                        "browser_download_url": local_server_url,
                        "download_url": local_server_url,
                        "sha256": a.sha256,
                        "size": a.size_bytes,
                        "size_bytes": a.size_bytes,
                        "is_local_mirror": true,
                        "status": "cached_locally",
                        "platform": {
                            "os": a.platform_os,
                            "arch": a.platform_arch,
                            "package_type": a.package_type
                        }
                    })
                }).collect();

                let app_entry = json!({
                    "name": ca.name,
                    "repo": ca.repo,
                    "app_last_fetched": chrono::Utc::now().to_rfc3339(),
                    "latest_release": {
                        "name": format!("{} v{}", ca.name, ca.version),
                        "tag": format!("v{}", ca.version),
                        "version": ca.version,
                        "notes_markdown": ca.notes,
                        "published_at": ca.updated_at,
                        "html_url": format!("{}/apps/{}", base_url, ca.id),
                        "assets": app_assets
                    }
                });

                apps.insert(ca.id.clone(), app_entry);

                custom_catalog_entries.push(json!({
                    "id": ca.id,
                    "name": ca.name,
                    "tagline": ca.tagline,
                    "repo": ca.repo,
                    "color": ca.color,
                    "version": ca.version,
                    "mac_team": ca.mac_team
                }));
            }
        }
        feed["custom_catalog"] = json!(custom_catalog_entries);
        feed
    }
}

fn generate_local_feed(
    local_files: &HashMap<String, (String, u64, String)>,
    _base_url: &str,
) -> Value {
    let mut apps = serde_json::Map::new();

    for (name, (url, size, sha256)) in local_files {
        let parts: Vec<&str> = name.split('-').collect();
        let app_id = parts.first().copied().unwrap_or("unknown");
        let version = parts.get(1).copied().unwrap_or("0.1.0");
        let tag = if version.starts_with('v') {
            version.to_string()
        } else {
            format!("v{}", version)
        };

        let app_entry = apps.entry(app_id.to_string()).or_insert_with(|| {
            json!({
                "repo": format!("storytold/{}", app_id),
                "fetched_at": chrono::Utc::now().timestamp(),
                "release": {
                    "tag": tag,
                    "published_at": chrono::Utc::now().to_rfc3339(),
                    "assets": []
                }
            })
        });

        if let Some(assets) = app_entry
            .get_mut("release")
            .and_then(|r| r.get_mut("assets"))
            .and_then(|a| a.as_array_mut())
        {
            assets.push(json!({
                "name": name,
                "size": size,
                "browser_download_url": url,
                "download_url": url,
                "sha256": sha256,
                "is_local_mirror": true
            }));
        }
    }

    json!({
        "last_fetched": chrono::Utc::now().timestamp(),
        "apps": apps,
        "announcements": [],
        "alerts": []
    })
}
