use std::{io, time::Duration};

use axum::response::sse::Event;
use futures_util::{StreamExt, TryStreamExt};
use reqwest::{Client, RequestBuilder, Url, redirect};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_util::{
    codec::{FramedRead, LinesCodec},
    io::StreamReader,
};

const EVENT_LIMIT: usize = 1024 * 1024;

pub struct OmniRoute {
    client: Client,
    endpoint: Url,
    key: String,
    pub model: String,
}

#[derive(Default)]
pub struct Usage {
    pub upstream_status: Option<i32>,
    pub input: Option<i64>,
    pub output: Option<i64>,
}

pub enum StreamResult {
    Complete,
    Cancelled,
    Failed(&'static str),
}

impl OmniRoute {
    pub fn new(url: &str, key: String, model: String) -> Result<Self, Box<dyn std::error::Error>> {
        let mut base = Url::parse(url).map_err(|_| "invalid ISKRA_OMNIROUTE_URL")?;
        let loopback = matches!(base.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        if base.host_str().is_none()
            || !(base.scheme() == "https" || (loopback && base.scheme() == "http"))
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(
                "use an HTTPS OmniRoute base URL, or HTTP on localhost for development".into(),
            );
        }
        let path = format!("{}/chat/completions", base.path().trim_end_matches('/'));
        base.set_path(&path);
        let client = Client::builder()
            .redirect(redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(75))
            .build()?;
        Ok(Self {
            client,
            endpoint: base,
            key,
            model,
        })
    }

    pub fn request(&self, text: String) -> RequestBuilder {
        self.client
            .post(self.endpoint.clone())
            .bearer_auth(&self.key)
            .json(&json!({
                "model": self.model,
                "messages": [{"role": "user", "content": text}],
                "stream": true,
                "stream_options": {"include_usage": true},
                "max_tokens": 512
            }))
    }
}

pub async fn relay(
    request: RequestBuilder,
    sender: &mpsc::Sender<Event>,
    usage: &mut Usage,
) -> StreamResult {
    let response = tokio::select! {
        _ = sender.closed() => return StreamResult::Cancelled,
        result = request.send() => match result {
            Ok(response) => response,
            Err(_) => return StreamResult::Failed("upstream_unavailable"),
        },
    };
    usage.upstream_status = Some(i32::from(response.status().as_u16()));
    if !response.status().is_success() {
        return StreamResult::Failed("upstream_rejected");
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if !content_type.is_some_and(|value| value.starts_with("text/event-stream")) {
        return StreamResult::Failed("invalid_upstream_stream");
    }

    let reader = StreamReader::new(response.bytes_stream().map_err(io::Error::other));
    let mut lines = FramedRead::new(reader, LinesCodec::new_with_max_length(EVENT_LIMIT));
    let mut data = String::new();
    loop {
        let line = tokio::select! {
            _ = sender.closed() => return StreamResult::Cancelled,
            next = lines.next() => match next {
                Some(Ok(line)) => line,
                _ => return StreamResult::Failed("upstream_stream_interrupted"),
            },
        };
        if let Some(part) = line.strip_prefix("data:") {
            let part = part.strip_prefix(' ').unwrap_or(part);
            if data.len() + part.len() + 1 > EVENT_LIMIT {
                return StreamResult::Failed("invalid_upstream_stream");
            }
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(part);
            continue;
        }
        if !line.is_empty() || data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            return StreamResult::Complete;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(&data) else {
            return StreamResult::Failed("invalid_upstream_stream");
        };
        if chunk.get("error").is_some_and(|value| !value.is_null()) {
            return StreamResult::Failed("upstream_stream_error");
        }
        if let Some(stats) = chunk.get("usage") {
            usage.input = stats
                .get("prompt_tokens")
                .and_then(Value::as_i64)
                .filter(|count| *count >= 0)
                .or(usage.input);
            usage.output = stats
                .get("completion_tokens")
                .and_then(Value::as_i64)
                .filter(|count| *count >= 0)
                .or(usage.output);
        }
        let event = Event::default().data(std::mem::take(&mut data));
        if sender.send(event).await.is_err() {
            return StreamResult::Cancelled;
        }
    }
}
