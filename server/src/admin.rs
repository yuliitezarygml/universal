use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{ApiError, AppState, database_error, db::token_digest, error, token};

const ADMIN_SESSION: &str = "SELECT a.id FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.access_token_hash = $1 AND s.access_expires_at > now()
      AND s.revoked_at IS NULL AND a.status = 'active' AND a.role = 'admin'";

fn forbidden() -> ApiError {
    error(StatusCode::FORBIDDEN, "admin_required")
}

async fn authorize(pool: &PgPool, headers: &HeaderMap) -> Result<(), ApiError> {
    sqlx::query_scalar::<_, Uuid>(ADMIN_SESSION)
        .bind(token_digest(token(headers)?))
        .fetch_optional(pool)
        .await
        .map_err(database_error)?
        .ok_or_else(forbidden)?;
    Ok(())
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Totals {
    accounts: i64,
    attempts_today: i64,
    failed_today: i64,
    input_tokens_today: i64,
    output_tokens_today: i64,
    missing_usage_today: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: Uuid,
    email: String,
    role: String,
    status: String,
    daily_requests: i32,
    daily_attachments: i32,
    requests_today: i32,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Attempt {
    id: Uuid,
    email: String,
    model: String,
    status: String,
    upstream_status: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    started_at: String,
}

#[derive(Serialize)]
struct Overview {
    totals: Totals,
    accounts: Vec<Account>,
    attempts: Vec<Attempt>,
}

pub async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = &state.pool;
    authorize(pool, &headers).await?;
    let (totals, accounts, attempts) = tokio::try_join!(
        sqlx::query_as::<_, Totals>(
            "SELECT (SELECT count(*) FROM accounts) AS accounts, count(*) AS attempts_today,
             count(*) FILTER (WHERE status = 'failed') AS failed_today,
             coalesce(sum(input_tokens), 0)::bigint AS input_tokens_today,
             coalesce(sum(output_tokens), 0)::bigint AS output_tokens_today,
             count(*) FILTER (WHERE status <> 'started' AND (input_tokens IS NULL OR output_tokens IS NULL)) AS missing_usage_today
             FROM provider_attempts WHERE started_at >= date_trunc('day', now(), 'UTC')"
        ).fetch_one(pool),
        sqlx::query_as::<_, Account>(
            "SELECT a.id, a.email, a.role, a.status, l.daily_requests, l.daily_attachments,
             coalesce(u.requests, 0) AS requests_today
             FROM accounts a JOIN account_limits l ON l.account_id = a.id
             LEFT JOIN account_usage_daily u ON u.account_id = a.id AND u.day_utc = (now() AT TIME ZONE 'UTC')::date
             ORDER BY a.created_at DESC, a.id LIMIT 100"
        ).fetch_all(pool),
        sqlx::query_as::<_, Attempt>(
            "SELECT p.id, a.email, p.model, p.status, p.upstream_status, p.input_tokens, p.output_tokens,
             to_char(p.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS started_at
             FROM provider_attempts p JOIN accounts a ON a.id = p.account_id
             ORDER BY p.started_at DESC, p.id LIMIT 50"
        ).fetch_all(pool),
    ).map_err(database_error)?;
    Ok(Json(Overview {
        totals,
        accounts,
        attempts,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    daily_requests: i32,
    daily_attachments: i32,
}

async fn lock_admin(
    transaction: &mut Transaction<'_, Postgres>,
    token: &str,
) -> Result<Uuid, ApiError> {
    let statement = format!("{ADMIN_SESSION} FOR SHARE OF a, s");
    sqlx::query_scalar(&statement)
        .bind(token_digest(token))
        .fetch_optional(&mut **transaction)
        .await
        .map_err(database_error)?
        .ok_or_else(forbidden)
}

pub async fn update_limits(
    State(state): State<AppState>,
    Path(account_id): Path<Uuid>,
    headers: HeaderMap,
    Json(limits): Json<Limits>,
) -> Result<StatusCode, ApiError> {
    let token = token(&headers)?;
    if !(0..=100_000).contains(&limits.daily_requests)
        || !(0..=limits.daily_requests).contains(&limits.daily_attachments)
    {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_limits"));
    }
    let mut transaction = state.pool.begin().await.map_err(database_error)?;
    let admin_id = lock_admin(&mut transaction, token).await?;
    let (old_requests, old_attachments) = sqlx::query_as::<_, (i32, i32)>(
        "SELECT daily_requests, daily_attachments FROM account_limits WHERE account_id = $1 FOR UPDATE",
    )
    .bind(account_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(database_error)?
    .ok_or_else(|| error(StatusCode::NOT_FOUND, "account_not_found"))?;

    sqlx::query("UPDATE account_limits SET daily_requests = $2, daily_attachments = $3 WHERE account_id = $1")
        .bind(account_id).bind(limits.daily_requests).bind(limits.daily_attachments)
        .execute(&mut *transaction).await.map_err(database_error)?;
    sqlx::query(
        "INSERT INTO admin_limit_changes (admin_id, account_id, previous_daily_requests, previous_daily_attachments,
         daily_requests, daily_attachments) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(admin_id).bind(account_id).bind(old_requests).bind(old_attachments)
    .bind(limits.daily_requests).bind(limits.daily_attachments)
    .execute(&mut *transaction).await.map_err(database_error)?;
    transaction.commit().await.map_err(database_error)?;
    Ok(StatusCode::NO_CONTENT)
}
