use axum::extract::Path as AxumPath;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use tokio::fs;
use tracing::{info, warn};

use crate::state::AppState;

const SCREENSHOTS_BASE: &str = "https://raw.githubusercontent.com/storytold/craft-launcher-assets/v1";
const MAX_BYTES: usize = 2 * 1024 * 1024; // 2 MB cap per AGENTS.md

pub async fn screenshot_proxy_handler(
    AxumPath((app, shot)): AxumPath<(String, String)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // Sanitize parameters
    if app.contains('/') || app.contains('\\') || app.contains("..")
        || shot.contains('/') || shot.contains('\\') || shot.contains("..") {
        return (StatusCode::BAD_REQUEST, "Invalid path parameters").into_response();
    }

    let cache_dir = state.storage_dir.join("screenshots").join(&app);
    let cache_file = cache_dir.join(&shot);

    // 1. Check local cache
    if cache_file.exists() {
        if let Ok(bytes) = fs::read(&cache_file).await {
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "public, max-age=86400")],
                bytes,
            ).into_response();
        }
    }

    // 2. Fetch from upstream GitHub repository
    let remote_url = format!("{}/{}/{}", SCREENSHOTS_BASE, app, shot);
    let client = reqwest::Client::builder()
        .user_agent("ArtCraft-Server-Mirror/0.1.0")
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Client error").into_response(),
    };

    let response = match client.get(&remote_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return (StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::NOT_FOUND), "Not found upstream").into_response(),
        Err(e) => {
            warn!("Failed to fetch screenshot {}: {}", remote_url, e);
            return (StatusCode::BAD_GATEWAY, "Failed to fetch from upstream").into_response();
        }
    };

    let bytes = match response.bytes().await {
        Ok(b) if b.len() <= MAX_BYTES => b,
        Ok(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "Screenshot exceeds 2MB").into_response(),
        Err(_) => return (StatusCode::BAD_GATEWAY, "Stream error").into_response(),
    };

    // 3. Verify JPEG magic bytes 0xFF 0xD8 0xFF per AGENTS.md
    if bytes.len() < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes[2] != 0xFF {
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, "Not a valid JPEG image").into_response();
    }

    // 4. Save to local cache in background and sync to S3
    let bytes_vec = bytes.to_vec();
    let cache_file_clone = cache_file.clone();
    let s3_opt = state.s3.clone();
    let app_clone = app.clone();
    let shot_clone = shot.clone();
    tokio::spawn(async move {
        if let Err(e) = fs::create_dir_all(&cache_dir).await {
            warn!("Could not create screenshot dir: {}", e);
            return;
        }
        if let Err(e) = fs::write(&cache_file_clone, &bytes_vec).await {
            warn!("Could not cache screenshot {}: {}", cache_file_clone.display(), e);
        } else {
            info!("Cached screenshot: {}", cache_file_clone.display());
        }

        if let Some(s3) = s3_opt {
            let s3_key = format!("screenshots/{}/{}", app_clone, shot_clone);
            let _ = s3.put_object(&s3_key, &bytes_vec, "image/jpeg").await;
        }
    });

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "public, max-age=86400")],
        bytes,
    ).into_response()
}
