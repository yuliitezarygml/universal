use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

pub enum ReserveError {
    Unauthorized,
    Duplicate,
    AccountLimit,
    ProviderLimit,
    Busy,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for ReserveError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

pub fn token_digest(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

#[derive(serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsage {
    requests_used: i32,
    requests_limit: i32,
    attachments_used: i32,
    attachments_limit: i32,
    reset_at: String,
}

pub async fn account_usage(pool: &PgPool, token: &str) -> sqlx::Result<Option<AccountUsage>> {
    sqlx::query_as(
        "SELECT coalesce(u.requests, 0) AS requests_used, l.daily_requests AS requests_limit,
         coalesce(u.requests_with_attachment, 0) AS attachments_used,
         l.daily_attachments AS attachments_limit,
         to_char((now() AT TIME ZONE 'UTC')::date + 1, 'YYYY-MM-DD') || 'T00:00:00Z' AS reset_at
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         JOIN account_limits l ON l.account_id = a.id
         LEFT JOIN account_usage_daily u ON u.account_id = a.id AND u.day_utc = (now() AT TIME ZONE 'UTC')::date
         WHERE s.access_token_hash = $1 AND s.access_expires_at > now()
           AND s.revoked_at IS NULL AND a.status = 'active'",
    )
    .bind(token_digest(token))
    .fetch_optional(pool)
    .await
}

pub async fn revoke_session(pool: &PgPool, token: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE sessions SET revoked_at = now() WHERE access_token_hash = $1 AND revoked_at IS NULL")
        .bind(token_digest(token))
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reserve(
    pool: &PgPool,
    token: &str,
    request_id: Uuid,
    model: &str,
    provider_limit: i32,
) -> Result<Uuid, ReserveError> {
    let mut transaction = pool.begin().await?;
    let (account_id, daily_limit, active_limit) = sqlx::query_as::<_, (Uuid, i32, i32)>(
        "SELECT a.id, l.daily_requests, l.active_requests
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         JOIN account_limits l ON l.account_id = a.id
         WHERE s.access_token_hash = $1 AND s.access_expires_at > now()
           AND s.revoked_at IS NULL AND a.status = 'active'
         FOR UPDATE OF a, l, s",
    )
    .bind(token_digest(token))
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(ReserveError::Unauthorized)?;

    let duplicate = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM provider_attempts WHERE account_id = $1 AND request_id = $2)",
    )
    .bind(account_id)
    .bind(request_id)
    .fetch_one(&mut *transaction)
    .await?;
    if duplicate {
        return Err(ReserveError::Duplicate);
    }

    sqlx::query(
        "UPDATE provider_attempts SET status = 'failed', finished_at = now()
         WHERE account_id = $1 AND status = 'started' AND started_at < now() - interval '2 minutes'",
    )
    .bind(account_id)
    .execute(&mut *transaction)
    .await?;
    let active = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM provider_attempts WHERE account_id = $1 AND status = 'started'",
    )
    .bind(account_id)
    .fetch_one(&mut *transaction)
    .await?;
    if active >= i64::from(active_limit) {
        return Err(ReserveError::Busy);
    }

    if daily_limit == 0 {
        return Err(ReserveError::AccountLimit);
    }
    sqlx::query_scalar::<_, i32>(
        "INSERT INTO account_usage_daily (account_id, day_utc, requests)
         VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 1)
         ON CONFLICT (account_id, day_utc) DO UPDATE SET requests = account_usage_daily.requests + 1
         WHERE account_usage_daily.requests < $2 RETURNING requests",
    )
    .bind(account_id)
    .bind(daily_limit)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(ReserveError::AccountLimit)?;

    sqlx::query_scalar::<_, i32>(
        "INSERT INTO provider_usage_daily (provider, day_utc, attempts)
         VALUES ('omniroute', (now() AT TIME ZONE 'UTC')::date, 1)
         ON CONFLICT (provider, day_utc) DO UPDATE SET attempts = provider_usage_daily.attempts + 1
         WHERE provider_usage_daily.attempts < $1 RETURNING attempts",
    )
    .bind(provider_limit)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(ReserveError::ProviderLimit)?;

    let attempt_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO provider_attempts (account_id, request_id, model) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(account_id)
    .bind(request_id)
    .bind(model)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(attempt_id)
}

pub async fn finish(
    pool: &PgPool,
    id: Uuid,
    status: &str,
    upstream_status: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE provider_attempts SET status = $2, upstream_status = $3, input_tokens = $4,
         output_tokens = $5, finished_at = now() WHERE id = $1 AND status = 'started'",
    )
    .bind(id)
    .bind(status)
    .bind(upstream_status)
    .bind(input_tokens)
    .bind(output_tokens)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_dev_session(
    pool: &PgPool,
    email: &str,
    role: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let email = email.trim().to_lowercase();
    if email.len() > 254
        || !email.ends_with(".test")
        || !email.contains('@')
        || email.chars().any(char::is_whitespace)
    {
        return Err("use a test email address ending in .test".into());
    }

    let mut entropy = [0_u8; 32];
    getrandom::fill(&mut entropy).map_err(|_| "cannot generate a session token")?;
    let token = hex::encode(entropy);
    let mut transaction = pool.begin().await?;
    let (account_id, status, current_role) = sqlx::query_as::<_, (Uuid, String, String)>(
        "INSERT INTO accounts (email, role) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = excluded.email RETURNING id, status, role",
    )
    .bind(email)
    .bind(role)
    .fetch_one(&mut *transaction)
    .await?;
    if status != "active" {
        return Err("account is not active".into());
    }
    if current_role != role {
        return Err("existing account has a different role".into());
    }
    sqlx::query(
        "INSERT INTO sessions (account_id, access_token_hash, access_expires_at)
         VALUES ($1, $2, now() + interval '24 hours')",
    )
    .bind(account_id)
    .bind(token_digest(&token))
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(token)
}
