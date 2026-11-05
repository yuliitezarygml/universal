use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::state::{AppState, DownloadTask};
use crate::{downloader, sync};

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WsClientCommand {
    Auth {
        token: String,
    },
    Ping,
    Refresh,
    SyncApp {
        app_id: String,
        platform: Option<String>,
    },
    SyncAll,
    RemoteDownload {
        url: String,
        filename: Option<String>,
    },
    DeleteFile {
        filename: String,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum WsServerMessage {
    AuthSuccess,
    AuthError { message: String },
    Init {
        tasks: Vec<DownloadTask>,
        s3_enabled: bool,
        s3_bucket: Option<String>,
        storage_dir: String,
        version: &'static str,
    },
    TaskUpdated(DownloadTask),
    FileAdded {
        filename: String,
        folder: String,
        sha256: String,
    },
    FileDeleted {
        filename: String,
    },
    SyncQueued {
        queued_count: usize,
    },
    Pong,
    Error {
        message: String,
    },
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // Check initial auth from token query or header
    let token_from_query = query.token;
    let token_from_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer ").map(|s| s.to_string()));

    let authenticated = match (token_from_query, token_from_header) {
        (Some(t), _) if t == *state.admin_password => true,
        (_, Some(t)) if t == *state.admin_password => true,
        _ => false,
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, authenticated))
}

async fn handle_socket(socket: WebSocket, state: AppState, mut is_authenticated: bool) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();

    // If authenticated on connection, immediately send Init payload
    if is_authenticated {
        let init_msg = create_init_message(&state).await;
        if let Ok(json) = serde_json::to_string(&init_msg) {
            let _ = sender.send(Message::Text(json.into())).await;
        }
    }

    // Spawn task to forward server broadcast events to this client
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages from the client
    let app_state = state.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    let cmd_res: Result<WsClientCommand, _> = serde_json::from_str(&text);
                    match cmd_res {
                        Ok(cmd) => {
                            if !is_authenticated {
                                match cmd {
                                    WsClientCommand::Auth { token } => {
                                        if token == *app_state.admin_password {
                                            is_authenticated = true;
                                            app_state.broadcast_event(&WsServerMessage::AuthSuccess);
                                            let init = create_init_message(&app_state).await;
                                            app_state.broadcast_event(&init);
                                        } else {
                                            app_state.broadcast_event(&WsServerMessage::AuthError {
                                                message: "Invalid admin password".into(),
                                            });
                                        }
                                    }
                                    _ => {
                                        app_state.broadcast_event(&WsServerMessage::AuthError {
                                            message: "Authentication required".into(),
                                        });
                                    }
                                }
                                continue;
                            }

                            // Authenticated command handling
                            match cmd {
                                WsClientCommand::Auth { .. } => {
                                    app_state.broadcast_event(&WsServerMessage::AuthSuccess);
                                }
                                WsClientCommand::Ping => {
                                    app_state.broadcast_event(&WsServerMessage::Pong);
                                }
                                WsClientCommand::Refresh => {
                                    let init = create_init_message(&app_state).await;
                                    app_state.broadcast_event(&init);
                                }
                                WsClientCommand::SyncApp { app_id, platform } => {
                                    match sync::queue_app_assets_sync(&app_state, &app_id, platform.as_deref()).await {
                                        Ok(queued) => {
                                            app_state.broadcast_event(&WsServerMessage::SyncQueued { queued_count: queued });
                                        }
                                        Err(e) => {
                                            app_state.broadcast_event(&WsServerMessage::Error { message: e });
                                        }
                                    }
                                }
                                WsClientCommand::SyncAll => {
                                    let queued = sync::queue_all_apps_sync(&app_state).await;
                                    app_state.broadcast_event(&WsServerMessage::SyncQueued { queued_count: queued });
                                }
                                WsClientCommand::RemoteDownload { url, filename } => {
                                    let clean_url = url.trim().to_string();
                                    if !clean_url.is_empty() {
                                        let file_name = filename.unwrap_or_else(|| {
                                            clean_url.split('/')
                                                .last()
                                                .unwrap_or("downloaded_file.bin")
                                                .split('?')
                                                .next()
                                                .unwrap_or("downloaded_file.bin")
                                                .to_string()
                                        });

                                        let task_id = uuid::Uuid::new_v4().to_string();
                                        let task = DownloadTask {
                                            id: task_id.clone(),
                                            url: clean_url.clone(),
                                            filename: file_name.clone(),
                                            status: crate::state::TaskStatus::Pending,
                                            created_at: chrono::Local::now().format("%H:%M:%S").to_string(),
                                        };

                                        {
                                            let mut tasks = app_state.tasks.write().await;
                                            tasks.insert(task_id.clone(), task.clone());
                                            let mut order = app_state.tasks_order.write().await;
                                            order.insert(0, task_id.clone());
                                        }

                                        app_state.broadcast_event(&WsServerMessage::TaskUpdated(task));
                                        downloader::start_download_task(
                                            app_state.clone(),
                                            task_id,
                                            clean_url,
                                            file_name,
                                            None,
                                        );
                                    }
                                }
                                WsClientCommand::DeleteFile { filename } => {
                                    if let Some(s3) = &app_state.s3 {
                                        let rel_path = crate::storage::file_subpath(&filename);
                                        let s3_key = rel_path.to_string_lossy().to_string();
                                        let _ = s3.delete_object(&s3_key).await;
                                        let _ = s3.delete_object(&format!("{}.sha256", s3_key)).await;
                                    }
                                    let _ = crate::storage::delete_storage_file(&app_state.storage_dir, &filename).await;
                                    app_state.broadcast_event(&WsServerMessage::FileDeleted { filename });
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse WS message: {}", e);
                        }
                    }
                }
                Message::Ping(_) => {
                    // WebSocket ping/pong handled automatically by axum
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // If any task finishes or disconnects, abort the other
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };
}

async fn create_init_message(state: &AppState) -> WsServerMessage {
    let tasks_map = state.tasks.read().await;
    let order = state.tasks_order.read().await;

    let mut tasks = Vec::new();
    for id in order.iter() {
        if let Some(task) = tasks_map.get(id) {
            tasks.push(task.clone());
        }
    }

    let (s3_enabled, s3_bucket) = match &state.s3 {
        Some(s) => (true, Some(s.config.bucket.clone())),
        None => (false, None),
    };

    WsServerMessage::Init {
        tasks,
        s3_enabled,
        s3_bucket,
        storage_dir: state.storage_dir.display().to_string(),
        version: env!("CARGO_PKG_VERSION"),
    }
}
