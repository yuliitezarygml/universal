mod admin;
mod db;
mod omniroute;

use std::{convert::Infallible, env, error::Error, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header},
    response::{
        IntoResponse, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, patch, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio::{net::TcpListener, sync::mpsc, time::timeout};
use tokio_stream::{StreamExt, wrappers::ReceiverStream};
use uuid::Uuid;

use db::ReserveError;
use omniroute::{OmniRoute, StreamResult, Usage};

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    omniroute: Option<Arc<OmniRoute>>,
    provider_limit: i32,
}

type ApiError = (StatusCode, Json<Value>);

fn error(status: StatusCode, code: &str) -> ApiError {
    (status, Json(json!({"error": {"code": code}})))
}

fn database_error(cause: sqlx::Error) -> ApiError {
    eprintln!("database operation failed: {cause}");
    error(StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
}

fn token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let unauthorized = || error(StatusCode::UNAUTHORIZED, "invalid_session");
    let header = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(unauthorized)?;
    let (scheme, token) = header.split_once(' ').ok_or_else(unauthorized)?;
    if !scheme.eq_ignore_ascii_case("bearer")
        || token.len() != 64
        || !token.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(unauthorized());
    }
    Ok(token)
}

async fn ready(State(state): State<AppState>) -> StatusCode {
    let check = sqlx::query("SELECT 1").execute(&state.pool);
    if matches!(timeout(Duration::from_secs(2), check).await, Ok(Ok(_))) {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn account_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let usage = db::account_usage(&state.pool, token(&headers)?)
        .await
        .map_err(database_error)?
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "invalid_session"))?;
    Ok(Json(usage))
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    db::revoke_session(&state.pool, token(&headers)?)
        .await
        .map_err(database_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    request_id: Uuid,
    text: String,
}

async fn chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let token = token(&headers)?;
    if body.text.trim().is_empty() || body.text.len() > 16_000 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_text"));
    }
    let upstream = state
        .omniroute
        .ok_or_else(|| error(StatusCode::SERVICE_UNAVAILABLE, "omniroute_not_configured"))?;
    let id = db::reserve(
        &state.pool,
        token,
        body.request_id,
        &upstream.model,
        state.provider_limit,
    )
    .await
    .map_err(|cause| match cause {
        ReserveError::Unauthorized => error(StatusCode::UNAUTHORIZED, "invalid_session"),
        ReserveError::Duplicate => error(StatusCode::CONFLICT, "duplicate_request"),
        ReserveError::AccountLimit => error(StatusCode::TOO_MANY_REQUESTS, "limit_reached"),
        ReserveError::ProviderLimit => {
            error(StatusCode::TOO_MANY_REQUESTS, "provider_limit_reached")
        }
        ReserveError::Busy => error(StatusCode::TOO_MANY_REQUESTS, "account_busy"),
        ReserveError::Database(cause) => database_error(cause),
    })?;

    let request = upstream.request(body.text);
    let (sender, receiver) = mpsc::channel(8);
    tokio::spawn(async move {
        let mut usage = Usage::default();
        let result = timeout(
            Duration::from_secs(85),
            omniroute::relay(request, &sender, &mut usage),
        )
        .await
        .unwrap_or(StreamResult::Failed("stream_timeout"));
        let status = match result {
            StreamResult::Complete => "succeeded",
            StreamResult::Cancelled => "cancelled",
            StreamResult::Failed(_) => "failed",
        };
        let saved = db::finish(
            &state.pool,
            id,
            status,
            usage.upstream_status,
            usage.input,
            usage.output,
        )
        .await;
        let terminal = match (saved, result) {
            (_, StreamResult::Cancelled) => return,
            (Ok(()), StreamResult::Complete) => Event::default().data("[DONE]"),
            (Ok(()), StreamResult::Failed(code)) => Event::default()
                .event("error")
                .data(json!({"code": code}).to_string()),
            (Err(cause), _) => {
                eprintln!("cannot finalize attempt {id}: {cause}");
                Event::default()
                    .event("error")
                    .data("{\"code\":\"usage_write_failed\"}")
            }
        };
        let _ = timeout(Duration::from_secs(2), sender.send(terminal)).await;
    });

    let events = ReceiverStream::new(receiver).map(Ok::<_, Infallible>);
    Ok(Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

fn omniroute_from_env() -> Result<Option<Arc<OmniRoute>>, Box<dyn Error>> {
    let url = env::var("ISKRA_OMNIROUTE_URL")
        .ok()
        .filter(|value| !value.is_empty());
    let key = env::var("ISKRA_OMNIROUTE_KEY")
        .ok()
        .filter(|value| !value.is_empty());
    match (url, key) {
        (None, None) => Ok(None),
        (Some(url), Some(key)) => {
            let model = env::var("ISKRA_OMNIROUTE_MODEL")
                .unwrap_or_else(|_| "openrouter/recursive/flint-v1.0:free".into());
            Ok(Some(Arc::new(OmniRoute::new(&url, key, model)?)))
        }
        _ => Err("set both ISKRA_OMNIROUTE_URL and ISKRA_OMNIROUTE_KEY".into()),
    }
}

fn database_options() -> Result<PgConnectOptions, Box<dyn Error>> {
    if let Ok(url) = env::var("DATABASE_URL") {
        return url.parse().map_err(|_| "invalid DATABASE_URL".into());
    }
    Ok(PgConnectOptions::new()
        .host(&env::var("ISKRA_DB_HOST").map_err(|_| "set DATABASE_URL or ISKRA_DB_HOST")?)
        .username("iskra")
        .password(&env::var("ISKRA_DB_PASSWORD").map_err(|_| "set ISKRA_DB_PASSWORD")?)
        .database("iskra"))
}

async fn shutdown() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! {
            _ = terminate.recv() => (),
            _ = tokio::signal::ctrl_c() => (),
        }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    match dotenvy::dotenv() {
        Ok(_) => (),
        Err(dotenvy::Error::Io(cause)) if cause.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("cannot load .env".into()),
    }
    let args: Vec<_> = env::args().skip(1).collect();
    if args.as_slice() == ["healthcheck"] {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()?
            .get("http://127.0.0.1:8080/health/ready")
            .send()
            .await?
            .error_for_status()?;
        return Ok(());
    }
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(database_options()?)
        .await?;
    sqlx::migrate!().run(&pool).await?;

    if let [command, email] = args.as_slice() {
        let role = match command.as_str() {
            "create-dev-session" => Some("user"),
            "create-dev-admin-session" => Some("admin"),
            _ => None,
        };
        if let Some(role) =
            role.filter(|_| env::var("ISKRA_ENABLE_DEV_SESSIONS").as_deref() == Ok("1"))
        {
            println!("{}", db::create_dev_session(&pool, email, role).await?);
            return Ok(());
        }
    }
    if !args.is_empty() {
        return Err("use iskra-server or enable ISKRA_ENABLE_DEV_SESSIONS=1 for create-dev-session / create-dev-admin-session <email.test>".into());
    }

    let provider_limit: i32 = env::var("ISKRA_PROVIDER_DAILY_LIMIT")
        .unwrap_or_else(|_| "30".into())
        .parse()?;
    if provider_limit < 1 {
        return Err("ISKRA_PROVIDER_DAILY_LIMIT must be positive".into());
    }
    let state = AppState {
        pool,
        omniroute: omniroute_from_env()?,
        provider_limit,
    };
    let app = Router::new()
        .route("/health/live", get(|| async { StatusCode::OK }))
        .route("/health/ready", get(ready))
        .route("/v1/me/usage", get(account_usage))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/admin/overview", get(admin::overview))
        .route(
            "/v1/admin/accounts/{id}/limits",
            patch(admin::update_limits).layer(DefaultBodyLimit::max(2048)),
        )
        .route(
            "/v1/chat/stream",
            post(chat).layer(DefaultBodyLimit::max(24_000)),
        )
        .with_state(state);
    let address = env::var("ISKRA_BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = TcpListener::bind(&address).await?;
    eprintln!("Iskra API listening on {}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
