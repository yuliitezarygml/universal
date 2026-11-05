use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};

use crate::state::{AppState, TaskStatus};
use crate::storage::{file_subpath, temp_subpath};

pub fn start_download_task(
    state: AppState,
    task_id: String,
    url: String,
    filename: String,
    expected_sha256: Option<String>,
) {
    tokio::spawn(async move {
        info!("Starting download task {}: {} -> {}", task_id, url, filename);

        // Sanitize filename
        let safe_name = filename
            .replace('/', "_")
            .replace('\\', "_")
            .replace("..", "_");

        let dest_rel = file_subpath(&safe_name);
        let dest_path = state.storage_dir.join(&dest_rel);
        let part_rel = temp_subpath(&safe_name);
        let part_path = state.storage_dir.join(&part_rel);

        // Ensure temp and dest parent directories exist
        if let Some(parent) = part_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        if let Some(parent) = dest_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }

        let client = reqwest::Client::builder()
            .user_agent("ArtCraft-Server-Mirror/0.1.0")
            .build();

        let client = match client {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("Failed to create HTTP client: {}", e);
                update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                return;
            }
        };

        let response = match client.get(&url).send().await {
            Ok(r) => {
                if !r.status().is_success() {
                    let err_msg = format!("HTTP error: {}", r.status());
                    update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                    return;
                }
                r
            }
            Err(e) => {
                let err_msg = format!("Request failed: {}", e);
                update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                return;
            }
        };

        let total_bytes = response.content_length();

        let mut file = match fs::File::create(&part_path).await {
            Ok(f) => f,
            Err(e) => {
                let err_msg = format!("Could not create temp file: {}", e);
                update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                return;
            }
        };

        let mut stream = response.bytes_stream();
        let mut downloaded_bytes: u64 = 0;
        let mut hasher = Sha256::new();
        let mut last_update = std::time::Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    let err_msg = format!("Download stream interrupted: {}", e);
                    let _ = fs::remove_file(&part_path).await;
                    update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                    return;
                }
            };

            hasher.update(&chunk);
            if let Err(e) = file.write_all(&chunk).await {
                let err_msg = format!("Failed to write chunk: {}", e);
                let _ = fs::remove_file(&part_path).await;
                update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                return;
            }

            downloaded_bytes += chunk.len() as u64;

            // Throttle UI updates to once every 200ms
            if last_update.elapsed().as_millis() > 200 {
                last_update = std::time::Instant::now();
                let percent = total_bytes
                    .map(|tot| ((downloaded_bytes as f64 / tot as f64) * 100.0) as f32)
                    .unwrap_or(0.0);

                update_task_status(
                    &state,
                    &task_id,
                    TaskStatus::Downloading {
                        downloaded: downloaded_bytes,
                        total: total_bytes,
                        percent,
                    },
                )
                .await;
            }
        }

        if let Err(e) = file.flush().await {
            let err_msg = format!("Failed to flush file: {}", e);
            update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
            return;
        }
        drop(file);

        let sha256_hash = hex::encode(hasher.finalize());

        // Checksum verification
        if let Some(expected) = &expected_sha256 {
            let expected_clean = expected.trim().to_lowercase();
            if sha256_hash != expected_clean {
                let err_msg = format!(
                    "SHA-256 hash mismatch! Calculated: {}, Expected: {}. File removed.",
                    sha256_hash, expected_clean
                );
                error!("{}", err_msg);
                let _ = fs::remove_file(&part_path).await;
                update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
                return;
            }
        }

        // Rename .part to final structured path (e.g. apps/photocraft/filename)
        if let Err(e) = fs::rename(&part_path, &dest_path).await {
            let err_msg = format!("Failed to finalize file: {}", e);
            update_task_status(&state, &task_id, TaskStatus::Failed { error: err_msg }).await;
            return;
        }

        // Write sidecar .sha256
        let sidecar = dest_path.with_extension(format!(
            "{}.sha256",
            dest_path.extension().and_then(|s| s.to_str()).unwrap_or("")
        ));
        let _ = fs::write(&sidecar, &sha256_hash).await;

        // Sync to MinIO S3 if configured
        if let Some(s3) = &state.s3 {
            let s3_key = dest_rel.to_string_lossy().to_string();
            if let Ok(bytes) = fs::read(&dest_path).await {
                let content_type = mime_guess::from_path(&dest_path)
                    .first_or_octet_stream()
                    .to_string();
                if let Err(e) = s3.put_object(&s3_key, &bytes, &content_type).await {
                    warn!("Failed to upload to S3 for {}: {}", s3_key, e);
                } else {
                    info!("Uploaded to MinIO S3: {}", s3_key);
                    let _ = s3
                        .put_object(
                            &format!("{}.sha256", s3_key),
                            sha256_hash.as_bytes(),
                            "text/plain",
                        )
                        .await;
                }
            }
        }

        info!(
            "Download task {} finished successfully. Size: {} bytes, Path: {}, SHA-256: {}",
            task_id, downloaded_bytes, dest_rel.display(), sha256_hash
        );

        update_task_status(
            &state,
            &task_id,
            TaskStatus::Finished {
                size: downloaded_bytes,
                sha256: sha256_hash,
            },
        )
        .await;
    });
}

async fn update_task_status(state: &AppState, task_id: &str, status: TaskStatus) {
    let mut tasks = state.tasks.write().await;
    if let Some(task) = tasks.get_mut(task_id) {
        task.status = status;
    }
}
