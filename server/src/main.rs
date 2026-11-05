mod admin_ui;
mod catalog;
mod downloader;
mod feed;
mod s3;
mod screenshots;
mod state;
mod storage;
mod sync;
mod ws;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{Html, IntoResponse, Json, Redirect, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::state::{AppState, DownloadTask, TaskStatus};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "artcraft_server=info,tower_http=info".into()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin123".into());

    let storage_dir = std::env::var("STORAGE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            if cwd.ends_with("server") {
                cwd.join("storage")
            } else if cwd.join("server").exists() {
                cwd.join("server").join("storage")
            } else {
                cwd.join("storage")
            }
        });

    // Create structured storage directories
    let apps_dir = storage_dir.join("apps");
    let uploads_dir = storage_dir.join("uploads");
    let screenshots_dir = storage_dir.join("screenshots");
    let temp_dir = storage_dir.join("temp");

    fs::create_dir_all(&apps_dir).await?;
    fs::create_dir_all(&uploads_dir).await?;
    fs::create_dir_all(&screenshots_dir).await?;
    fs::create_dir_all(&temp_dir).await?;

    // Optional MinIO S3 integration
    let s3_client = match s3::S3Config::from_env() {
        Some(cfg) => match s3::S3Storage::new(cfg) {
            Ok(storage) => Some(Arc::new(storage)),
            Err(e) => {
                tracing::warn!("MinIO S3 configuration error: {}", e);
                None
            }
        },
        None => None,
    };

    let state = AppState::new(storage_dir.clone(), password.clone(), port, s3_client);

    // Warm up the upstream feed cache on startup in background
    let bg_state = state.clone();
    tokio::spawn(async move {
        feed::get_release_info(bg_state).await;
    });

    // Routes
    let app = Router::new()
        .route("/", get(|| async { Redirect::temporary("/admin") }))
        .route("/admin", get(admin_html_handler))
        .route("/admin/style.css", get(admin_css_handler))
        .route("/admin/app.js", get(admin_js_handler))
        .route("/v1/craft_apps/release_info", get(feed_handler))
        .route("/downloads/{filename}", get(smart_download_handler))
        .route("/screenshots/{app}/{shot}", get(screenshots::screenshot_proxy_handler))
        .route("/api/auth/login", post(login_handler))
        .route("/api/status", get(status_handler))
        .route("/api/files", get(list_files_handler))
        .route("/api/files/{filename}", delete(delete_file_handler))
        .route("/api/upload", post(upload_handler))
        .route("/api/download", post(remote_download_handler))
        .route("/api/tasks", get(list_tasks_handler))
        .route("/api/apps", get(list_apps_sync_handler))
        .route("/api/apps/sync", post(trigger_apps_sync_handler))
        .route("/api/s3/status", get(s3_status_handler))
        .route("/api/s3/files", get(s3_files_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("=========================================================");
    info!("🚀 ArtCraft Distribution & Mirror Server");
    info!("📡 Server listening on: http://0.0.0.0:{}", port);
    info!("🔑 Admin panel: http://localhost:{}/admin", port);
    info!("📦 Structured Storage: {}", storage_dir.display());
    info!("   ├── apps/        (Пакеты приложений Craft Suite)");
    info!("   ├── uploads/     (Пользовательские загрузки)");
    info!("   ├── screenshots/ (Кэш скриншотов)");
    info!("   └── temp/        (Временные файлы загрузок)");
    info!("🌐 Feed URL for Launcher: http://localhost:{}/v1/craft_apps/release_info", port);
    info!("=========================================================");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn admin_html_handler() -> Html<&'static str> {
    Html(admin_ui::HTML)
}

async fn admin_css_handler() -> impl IntoResponse {
    ([(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")], admin_ui::CSS)
}

async fn admin_js_handler() -> impl IntoResponse {
    ([(axum::http::header::CONTENT_TYPE, "application/javascript; charset=utf-8")], admin_ui::JS)
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    if payload.password == *state.admin_password {
        (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response()
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid password" })),
        )
            .into_response()
    }
}

fn check_auth(headers: &HeaderMap, state: &AppState) -> bool {
    if let Some(auth) = headers.get("Authorization").and_then(|h| h.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            return token == *state.admin_password;
        }
    }
    false
}

async fn status_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let base_url = state.base_url.read().await.clone();
    (
        StatusCode::OK,
        Json(json!({
            "base_url": base_url,
            "storage_dir": state.storage_dir.display().to_string(),
            "port": 8080,
            "version": env!("CARGO_PKG_VERSION")
        })),
    )
        .into_response()
}

/// Smart Download Handler:
/// 1. If file is cached locally in `server/storage/` (in `apps/<app>/` or `uploads/`),
///    serves directly with ServeFile (full HTTP Range support for resume).
/// 2. If file is NOT cached, checks known upstream release assets from GitHub.
///    If found, starts a background download to cache it into `apps/<app>/`, AND redirects client to GitHub CDN!
async fn smart_download_handler(
    Path(filename): Path<String>,
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return (StatusCode::BAD_REQUEST, "Invalid filename").into_response();
    }

    if let Some(local_path) = storage::locate_file(&state.storage_dir, &filename).await {
        // Serve locally from its structured folder using ServeFile
        let serve_file = ServeFile::new(&local_path);
        match serve_file.oneshot(request).await {
            Ok(res) => res.into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        }
    } else {
        // Not on local disk: lookup in known upstream assets
        if let Some(asset) = feed::find_upstream_asset(&filename).await {
            info!(
                "On-demand download for {}: not cached locally. Spawning background sync and redirecting to {}",
                filename, asset.upstream_url
            );

            let task_id = uuid::Uuid::new_v4().to_string();
            let task = DownloadTask {
                id: task_id.clone(),
                url: asset.upstream_url.clone(),
                filename: filename.clone(),
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

            downloader::start_download_task(
                state.clone(),
                task_id,
                asset.upstream_url.clone(),
                filename,
                expected_sha256,
            );

            // Redirect user to upstream so they don't wait
            Redirect::temporary(&asset.upstream_url).into_response()
        } else {
            (
                StatusCode::NOT_FOUND,
                format!("File '{}' not found in storage or upstream catalog", filename),
            )
                .into_response()
        }
    }
}

async fn list_files_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let base_url = state.base_url.read().await.clone();
    let files = storage::list_storage_files(&state.storage_dir, &base_url).await;
    (StatusCode::OK, Json(files)).into_response()
}

async fn delete_file_handler(
    Path(filename): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    if let Some(s3) = &state.s3 {
        let rel_path = storage::file_subpath(&filename);
        let s3_key = rel_path.to_string_lossy().to_string();
        let _ = s3.delete_object(&s3_key).await;
        let _ = s3.delete_object(&format!("{}.sha256", s3_key)).await;
    }

    match storage::delete_storage_file(&state.storage_dir, &filename).await {
        Ok(_) => (StatusCode::OK, Json(json!({ "deleted": filename }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn s3_status_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    if let Some(s3) = &state.s3 {
        (
            StatusCode::OK,
            Json(json!({
                "enabled": true,
                "endpoint": s3.config.endpoint,
                "bucket": s3.config.bucket,
                "region": s3.config.region,
                "public_url": s3.config.public_url,
            })),
        )
            .into_response()
    } else {
        (
            StatusCode::OK,
            Json(json!({
                "enabled": false,
                "message": "MinIO S3 is not configured (running in local disk mode)"
            })),
        )
            .into_response()
    }
}

async fn s3_files_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    if let Some(s3) = &state.s3 {
        match s3.list_objects("").await {
            Ok(objs) => (StatusCode::OK, Json(objs)).into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))).into_response(),
        }
    } else {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": "S3 not configured" }))).into_response()
    }
}

async fn upload_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let file_name = match field.file_name() {
            Some(n) => n.to_string(),
            None => continue,
        };

        let safe_name = file_name
            .replace('/', "_")
            .replace('\\', "_")
            .replace("..", "_");

        let rel_path = storage::file_subpath(&safe_name);
        let dest_path = state.storage_dir.join(&rel_path);

        if let Some(parent) = dest_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }

        let mut file = match fs::File::create(&dest_path).await {
            Ok(f) => f,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create file: {}", e),
                )
                    .into_response()
            }
        };

        let mut hasher = Sha256::new();
        while let Ok(Some(chunk)) = field.chunk().await {
            hasher.update(&chunk);
            if let Err(e) = file.write_all(&chunk).await {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to write chunk: {}", e),
                )
                    .into_response();
            }
        }

        let sha256_hash = hex::encode(hasher.finalize());
        let sidecar = dest_path.with_extension(format!(
            "{}.sha256",
            dest_path.extension().and_then(|s| s.to_str()).unwrap_or("")
        ));
        let _ = fs::write(&sidecar, &sha256_hash).await;

        // Sync to MinIO S3 if configured
        if let Some(s3) = &state.s3 {
            let s3_key = rel_path.to_string_lossy().to_string();
            if let Ok(bytes) = fs::read(&dest_path).await {
                let content_type = mime_guess::from_path(&dest_path)
                    .first_or_octet_stream()
                    .to_string();
                let _ = s3.put_object(&s3_key, &bytes, &content_type).await;
                let _ = s3.put_object(&format!("{}.sha256", s3_key), sha256_hash.as_bytes(), "text/plain").await;
            }
        }

        info!("File uploaded: {} -> {} (SHA-256: {})", safe_name, rel_path.display(), sha256_hash);
        return (
            StatusCode::OK,
            Json(json!({
                "filename": safe_name,
                "folder": rel_path.parent().map(|p| p.display().to_string()).unwrap_or_default(),
                "sha256": sha256_hash
            })),
        )
            .into_response();
    }

    (StatusCode::BAD_REQUEST, "No file uploaded").into_response()
}

#[derive(Deserialize)]
struct DownloadRequest {
    url: String,
    filename: Option<String>,
}

async fn remote_download_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<DownloadRequest>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let url = payload.url.trim().to_string();
    if url.is_empty() {
        return (StatusCode::BAD_REQUEST, "Empty URL").into_response();
    }

    let filename = if let Some(custom) = payload.filename {
        custom
    } else {
        url.split('/')
            .last()
            .unwrap_or("downloaded_file.bin")
            .split('?')
            .next()
            .unwrap_or("downloaded_file.bin")
            .to_string()
    };

    let task_id = uuid::Uuid::new_v4().to_string();
    let task = DownloadTask {
        id: task_id.clone(),
        url: url.clone(),
        filename: filename.clone(),
        status: TaskStatus::Pending,
        created_at: chrono::Local::now().format("%H:%M:%S").to_string(),
    };

    {
        let mut tasks = state.tasks.write().await;
        tasks.insert(task_id.clone(), task);
        let mut order = state.tasks_order.write().await;
        order.insert(0, task_id.clone());
    }

    downloader::start_download_task(state, task_id.clone(), url, filename, None);

    (StatusCode::OK, Json(json!({ "task_id": task_id }))).into_response()
}

async fn list_tasks_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let tasks = state.tasks.read().await;
    let order = state.tasks_order.read().await;

    let mut result = Vec::new();
    for id in order.iter() {
        if let Some(task) = tasks.get(id) {
            result.push(task.clone());
        }
    }

    (StatusCode::OK, Json(result)).into_response()
}

async fn list_apps_sync_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let status = sync::get_suite_sync_status(&state).await;
    (StatusCode::OK, Json(status)).into_response()
}

#[derive(Deserialize)]
struct AppSyncRequest {
    app_id: Option<String>,
    platform: Option<String>,
    all: Option<bool>,
}

async fn trigger_apps_sync_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(payload): Json<AppSyncRequest>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    if payload.all.unwrap_or(false) {
        let queued = sync::queue_all_apps_sync(&state).await;
        return (StatusCode::OK, Json(json!({ "queued_tasks": queued }))).into_response();
    }

    if let Some(app_id) = payload.app_id {
        match sync::queue_app_assets_sync(&state, &app_id, payload.platform.as_deref()).await {
            Ok(queued) => (StatusCode::OK, Json(json!({ "queued_tasks": queued }))).into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
        }
    } else {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": "Missing app_id or all=true" }))).into_response()
    }
}

async fn feed_handler(State(state): State<AppState>) -> impl IntoResponse {
    let feed_json = feed::get_release_info(state).await;
    (
        StatusCode::OK,
        [("Content-Type", "application/json")],
        Json(feed_json),
    )
}
