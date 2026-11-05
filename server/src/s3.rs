use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::region::Region;
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub region: String,
    pub public_url: String,
}

impl S3Config {
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("S3_ENDPOINT").ok()?;
        let bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "artcraft-packages".into());
        let access_key = std::env::var("S3_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
        let secret_key = std::env::var("S3_SECRET_KEY").unwrap_or_else(|_| "minioadmin123".into());
        let region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());
        let public_url = std::env::var("S3_PUBLIC_URL").unwrap_or_else(|_| format!("{}/{}", endpoint, bucket));

        Some(Self {
            endpoint,
            bucket,
            access_key,
            secret_key,
            region,
            public_url,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct S3ObjectItem {
    pub key: String,
    pub size: u64,
    pub last_modified: String,
    pub e_tag: String,
}

#[derive(Clone)]
pub struct S3Storage {
    pub config: S3Config,
    bucket: Box<Bucket>,
}

impl S3Storage {
    pub fn new(config: S3Config) -> Result<Self, String> {
        let region = Region::Custom {
            region: config.region.clone(),
            endpoint: config.endpoint.clone(),
        };

        let credentials = Credentials::new(
            Some(&config.access_key),
            Some(&config.secret_key),
            None,
            None,
            None,
        )
        .map_err(|e| format!("Failed to create S3 credentials: {}", e))?;

        let bucket = Bucket::new(&config.bucket, region, credentials)
            .map_err(|e| format!("Failed to create S3 bucket reference: {}", e))?
            .with_path_style();

        info!("S3 / MinIO client initialized: endpoint={}, bucket={}", config.endpoint, config.bucket);

        Ok(Self { config, bucket })
    }

    /// Upload data to S3
    pub async fn put_object(&self, key: &str, data: &[u8], content_type: &str) -> Result<(), String> {
        let response = self
            .bucket
            .put_object_with_content_type(key, data, content_type)
            .await
            .map_err(|e| format!("S3 put_object failed for '{}': {}", key, e))?;

        if response.status_code() >= 200 && response.status_code() < 300 {
            info!("Uploaded to S3: {} ({} bytes)", key, data.len());
            Ok(())
        } else {
            Err(format!("S3 error HTTP {}: {}", response.status_code(), String::from_utf8_lossy(response.as_slice())))
        }
    }

    #[allow(dead_code)]
    pub async fn object_exists(&self, key: &str) -> bool {
        match self.bucket.head_object(key).await {
            Ok((_, code)) => code >= 200 && code < 300,
            Err(_) => false,
        }
    }

    /// Get object from S3
    #[allow(dead_code)]
    pub async fn get_object(&self, key: &str) -> Result<Vec<u8>, String> {
        let response = self
            .bucket
            .get_object(key)
            .await
            .map_err(|e| format!("S3 get_object failed for '{}': {}", key, e))?;

        if response.status_code() == 200 {
            Ok(response.into_bytes().to_vec())
        } else {
            Err(format!("S3 get_object HTTP {}", response.status_code()))
        }
    }

    /// Delete object from S3
    pub async fn delete_object(&self, key: &str) -> Result<(), String> {
        self.bucket
            .delete_object(key)
            .await
            .map_err(|e| format!("S3 delete_object failed for '{}': {}", key, e))?;
        info!("Deleted from S3: {}", key);
        Ok(())
    }

    /// List objects in S3 with optional prefix
    pub async fn list_objects(&self, prefix: &str) -> Result<Vec<S3ObjectItem>, String> {
        let results = self
            .bucket
            .list(prefix.to_string(), None)
            .await
            .map_err(|e| format!("S3 list failed for prefix '{}': {}", prefix, e))?;

        let mut items = Vec::new();
        for list in results {
            for obj in list.contents {
                items.push(S3ObjectItem {
                    key: obj.key,
                    size: obj.size,
                    last_modified: obj.last_modified,
                    e_tag: obj.e_tag.map(|t| t.trim_matches('"').to_string()).unwrap_or_default(),
                });
            }
        }

        Ok(items)
    }

    /// Public URL for an S3 object
    #[allow(dead_code)]
    pub fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.config.public_url.trim_end_matches('/'), key.trim_start_matches('/'))
    }
}
