use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use serde::{Deserialize, Serialize};
use tokio_postgres::NoTls;
use tracing::{error, info};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomAppAsset {
    pub id: String,
    pub app_id: String,
    pub filename: String,
    pub platform_os: String,
    pub platform_arch: String,
    pub package_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub download_url: String,
    pub s3_key: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomApp {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub repo: String,
    pub color: String,
    pub version: String,
    pub notes: String,
    pub mac_team: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub assets: Vec<CustomAppAsset>,
    #[serde(default)]
    pub screenshots: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DbFile {
    pub id: String,
    pub filename: String,
    pub s3_key: String,
    pub folder: String,
    pub category: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub content_type: Option<String>,
    pub downloads: i64,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DbTask {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub status: String,
    pub progress_percent: f32,
    pub downloaded_bytes: i64,
    pub total_bytes: Option<i64>,
    pub sha256: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    pub pool: Pool,
}

impl Database {
    pub async fn connect(database_url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let pg_config: tokio_postgres::Config = database_url.parse()?;
        let mgr_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        };
        let mgr = Manager::from_config(pg_config, NoTls, mgr_config);
        let pool = Pool::builder(mgr).max_size(16).build()?;

        // Verify connectivity
        let client = pool.get().await?;
        info!("Connected to PostgreSQL database successfully");

        let db = Self { pool };
        db.init_schema(&client).await?;
        Ok(db)
    }

    async fn init_schema(&self, client: &tokio_postgres::Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Initializing PostgreSQL schema...");

        // Files Table
        client.batch_execute("
            CREATE TABLE IF NOT EXISTS files (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                filename TEXT UNIQUE NOT NULL,
                s3_key TEXT NOT NULL,
                folder TEXT NOT NULL,
                category TEXT NOT NULL,
                size_bytes BIGINT NOT NULL,
                sha256 VARCHAR(64) NOT NULL,
                content_type TEXT,
                downloads BIGINT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
            CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
            CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                status TEXT NOT NULL,
                progress_percent REAL DEFAULT 0.0,
                downloaded_bytes BIGINT DEFAULT 0,
                total_bytes BIGINT,
                sha256 VARCHAR(64),
                error_message TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

            CREATE TABLE IF NOT EXISTS screenshots (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_id TEXT NOT NULL,
                shot_name TEXT NOT NULL,
                s3_key TEXT NOT NULL,
                size_bytes BIGINT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (app_id, shot_name)
            );

            CREATE INDEX IF NOT EXISTS idx_screenshots_app ON screenshots(app_id);

            CREATE TABLE IF NOT EXISTS custom_apps (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                tagline TEXT NOT NULL,
                repo VARCHAR(128) NOT NULL,
                color VARCHAR(16) NOT NULL DEFAULT '#6366f1',
                version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
                notes TEXT NOT NULL DEFAULT '',
                mac_team VARCHAR(32),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS custom_app_assets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_id VARCHAR(64) NOT NULL REFERENCES custom_apps(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                platform_os VARCHAR(32) NOT NULL,
                platform_arch VARCHAR(32) NOT NULL,
                package_type VARCHAR(32) NOT NULL,
                size_bytes BIGINT NOT NULL DEFAULT 0,
                sha256 VARCHAR(64) NOT NULL DEFAULT '',
                download_url TEXT NOT NULL,
                s3_key TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_custom_app_assets_app ON custom_app_assets(app_id);
        ").await?;

        info!("PostgreSQL schema tables verified and ready (files, tasks, screenshots, custom_apps)");
        Ok(())
    }

    pub async fn upsert_file(
        &self,
        filename: &str,
        s3_key: &str,
        folder: &str,
        category: &str,
        size_bytes: i64,
        sha256: &str,
        content_type: Option<&str>,
    ) {
        if let Ok(client) = self.pool.get().await {
            let res = client.execute(
                "INSERT INTO files (filename, s3_key, folder, category, size_bytes, sha256, content_type, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                 ON CONFLICT (filename) DO UPDATE SET
                    s3_key = EXCLUDED.s3_key,
                    folder = EXCLUDED.folder,
                    category = EXCLUDED.category,
                    size_bytes = EXCLUDED.size_bytes,
                    sha256 = EXCLUDED.sha256,
                    content_type = EXCLUDED.content_type,
                    updated_at = NOW()",
                &[&filename, &s3_key, &folder, &category, &size_bytes, &sha256, &content_type],
            ).await;
            if let Err(e) = res {
                error!("Failed to upsert file in postgres: {}", e);
            }
        }
    }

    pub async fn delete_file(&self, filename: &str) {
        if let Ok(client) = self.pool.get().await {
            let res = client.execute("DELETE FROM files WHERE filename = $1", &[&filename]).await;
            if let Err(e) = res {
                error!("Failed to delete file from postgres: {}", e);
            }
        }
    }

    pub async fn list_files(&self) -> Vec<DbFile> {
        let mut result = Vec::new();
        if let Ok(client) = self.pool.get().await {
            if let Ok(rows) = client.query(
                "SELECT id::text, filename, s3_key, folder, category, size_bytes, sha256, content_type, downloads, created_at::text
                 FROM files ORDER BY updated_at DESC",
                &[],
            ).await {
                for r in rows {
                    result.push(DbFile {
                        id: r.get(0),
                        filename: r.get(1),
                        s3_key: r.get(2),
                        folder: r.get(3),
                        category: r.get(4),
                        size_bytes: r.get(5),
                        sha256: r.get(6),
                        content_type: r.get(7),
                        downloads: r.get(8),
                        created_at: r.get(9),
                    });
                }
            }
        }
        result
    }

    pub async fn upsert_task(
        &self,
        id: &str,
        url: &str,
        filename: &str,
        status: &str,
        progress_percent: f32,
        downloaded_bytes: i64,
        total_bytes: Option<i64>,
        sha256: Option<&str>,
        error_message: Option<&str>,
    ) {
        if let Ok(client) = self.pool.get().await {
            let res = client.execute(
                "INSERT INTO tasks (id, url, filename, status, progress_percent, downloaded_bytes, total_bytes, sha256, error_message, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    progress_percent = EXCLUDED.progress_percent,
                    downloaded_bytes = EXCLUDED.downloaded_bytes,
                    total_bytes = EXCLUDED.total_bytes,
                    sha256 = EXCLUDED.sha256,
                    error_message = EXCLUDED.error_message,
                    updated_at = NOW()",
                &[&id, &url, &filename, &status, &progress_percent, &downloaded_bytes, &total_bytes, &sha256, &error_message],
            ).await;
            if let Err(e) = res {
                error!("Failed to upsert task in postgres: {}", e);
            }
        }
    }

    pub async fn upsert_screenshot(&self, app_id: &str, shot_name: &str, s3_key: &str, size_bytes: i64) {
        if let Ok(client) = self.pool.get().await {
            let res = client.execute(
                "INSERT INTO screenshots (app_id, shot_name, s3_key, size_bytes)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (app_id, shot_name) DO UPDATE SET
                    s3_key = EXCLUDED.s3_key,
                    size_bytes = EXCLUDED.size_bytes",
                &[&app_id, &shot_name, &s3_key, &size_bytes],
            ).await;
            if let Err(e) = res {
                error!("Failed to record screenshot in postgres: {}", e);
            }
        }
    }

    pub async fn increment_download(&self, filename: &str) {
        if let Ok(client) = self.pool.get().await {
            let _ = client.execute(
                "UPDATE files SET downloads = downloads + 1 WHERE filename = $1",
                &[&filename],
            ).await;
        }
    }

    pub async fn upsert_custom_app(&self, app: &CustomApp) -> Result<(), String> {
        let client = self.pool.get().await.map_err(|e| e.to_string())?;
        client.execute(
            "INSERT INTO custom_apps (id, name, tagline, repo, color, version, notes, mac_team, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                tagline = EXCLUDED.tagline,
                repo = EXCLUDED.repo,
                color = EXCLUDED.color,
                version = EXCLUDED.version,
                notes = EXCLUDED.notes,
                mac_team = EXCLUDED.mac_team,
                updated_at = NOW()",
            &[&app.id, &app.name, &app.tagline, &app.repo, &app.color, &app.version, &app.notes, &app.mac_team],
        ).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_custom_app(&self, id: &str) -> Result<(), String> {
        let client = self.pool.get().await.map_err(|e| e.to_string())?;
        client.execute("DELETE FROM custom_apps WHERE id = $1", &[&id])
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn list_custom_apps(&self) -> Vec<CustomApp> {
        let mut apps = Vec::new();
        if let Ok(client) = self.pool.get().await {
            if let Ok(rows) = client.query(
                "SELECT id, name, tagline, repo, color, version, notes, mac_team, created_at::text, updated_at::text
                 FROM custom_apps ORDER BY created_at DESC",
                &[],
            ).await {
                for r in rows {
                    let id: String = r.get(0);
                    let mut app = CustomApp {
                        id: id.clone(),
                        name: r.get(1),
                        tagline: r.get(2),
                        repo: r.get(3),
                        color: r.get(4),
                        version: r.get(5),
                        notes: r.get(6),
                        mac_team: r.get(7),
                        created_at: r.get(8),
                        updated_at: r.get(9),
                        assets: Vec::new(),
                        screenshots: Vec::new(),
                    };

                    // Load assets for this app
                    if let Ok(asset_rows) = client.query(
                        "SELECT id::text, app_id, filename, platform_os, platform_arch, package_type, size_bytes, sha256, download_url, s3_key, created_at::text
                         FROM custom_app_assets WHERE app_id = $1 ORDER BY created_at ASC",
                        &[&id],
                    ).await {
                        for ar in asset_rows {
                            app.assets.push(CustomAppAsset {
                                id: ar.get(0),
                                app_id: ar.get(1),
                                filename: ar.get(2),
                                platform_os: ar.get(3),
                                platform_arch: ar.get(4),
                                package_type: ar.get(5),
                                size_bytes: ar.get(6),
                                sha256: ar.get(7),
                                download_url: ar.get(8),
                                s3_key: ar.get(9),
                                created_at: ar.get(10),
                            });
                        }
                    }

                    // Load screenshots for this app
                    if let Ok(shot_rows) = client.query(
                        "SELECT shot_name FROM screenshots WHERE app_id = $1 ORDER BY shot_name ASC",
                        &[&id],
                    ).await {
                        for sr in shot_rows {
                            let shot: String = sr.get(0);
                            app.screenshots.push(shot);
                        }
                    }

                    apps.push(app);
                }
            }
        }
        apps
    }

    pub async fn get_custom_app(&self, id: &str) -> Option<CustomApp> {
        let apps = self.list_custom_apps().await;
        apps.into_iter().find(|a| a.id == id)
    }

    pub async fn upsert_custom_app_asset(&self, asset: &CustomAppAsset) -> Result<(), String> {
        let client = self.pool.get().await.map_err(|e| e.to_string())?;
        client.execute(
            "INSERT INTO custom_app_assets (app_id, filename, platform_os, platform_arch, package_type, size_bytes, sha256, download_url, s3_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            &[
                &asset.app_id,
                &asset.filename,
                &asset.platform_os,
                &asset.platform_arch,
                &asset.package_type,
                &asset.size_bytes,
                &asset.sha256,
                &asset.download_url,
                &asset.s3_key,
            ],
        ).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_custom_app_asset(&self, asset_id: &str) -> Result<(), String> {
        let client = self.pool.get().await.map_err(|e| e.to_string())?;
        client.execute(
            "DELETE FROM custom_app_assets WHERE id = $1::uuid",
            &[&uuid::Uuid::parse_str(asset_id).map_err(|e| e.to_string())?],
        ).await.map_err(|e| e.to_string())?;
        Ok(())
    }
}
