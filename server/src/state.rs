use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum TaskStatus {
    Pending,
    Downloading {
        downloaded: u64,
        total: Option<u64>,
        percent: f32,
    },
    Finished {
        size: u64,
        sha256: String,
    },
    Failed {
        error: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub status: TaskStatus,
    pub created_at: String,
}

#[derive(Clone)]
pub struct AppState {
    pub storage_dir: PathBuf,
    pub admin_password: Arc<String>,
    pub tasks: Arc<RwLock<HashMap<String, DownloadTask>>>,
    pub tasks_order: Arc<RwLock<Vec<String>>>,
    pub base_url: Arc<RwLock<String>>,
    pub s3: Option<Arc<crate::s3::S3Storage>>,
}

impl AppState {
    pub fn new(
        storage_dir: PathBuf,
        admin_password: String,
        default_port: u16,
        s3: Option<Arc<crate::s3::S3Storage>>,
    ) -> Self {
        Self {
            storage_dir,
            admin_password: Arc::new(admin_password),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            tasks_order: Arc::new(RwLock::new(Vec::new())),
            base_url: Arc::new(RwLock::new(format!("http://localhost:{}", default_port))),
            s3,
        }
    }
}

