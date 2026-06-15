use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::db::Database;
use crate::provider::{ChatMessage, ChatRequest, ProviderFactory};
use crate::providers;

// ─── AppState ────────────────────────────────────────────────────────────────

pub struct HttpServerState {
    pub db: Arc<Mutex<Database>>,
    /// Tauri AppHandle 用于解析 provider 凭据。包成 `Option` 是因为
    /// 单元测试也会构造 http server；生产代码总会设置它。
    pub app: Option<tauri::AppHandle>,
}

// ─── Auth ───────────────────────────────────────────────────────────────────

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn verify_token(db: &Database, token: &str) -> bool {
    db.get_setting("session_token")
        .ok()
        .flatten()
        .map(|stored| stored == token)
        .unwrap_or(false)
}

// ─── Resolved target (provider/model/api_key) ───────────────────────────────

#[derive(Default, Clone)]
struct ResolvedTarget {
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
}

/// 从 `~/.nova/config.json` 构造启动期默认 target，
/// 然后用请求 body 里的 `provider_id` 字段（可选）覆盖。
/// 未配置默认值时返回 Err——chat 端点把这个错误以 4xx/5xx 透出，
/// 告诉调用方先去配置默认值。
async fn resolve_target(
    app: Option<&tauri::AppHandle>,
    body_json: &serde_json::Value,
) -> Result<ResolvedTarget, String> {
    let mut out = ResolvedTarget::default();
    let Some(app) = app else {
        return Err("no default target configured (Tauri app handle unavailable)".into());
    };

    let list = providers::list_all(app)?;
    if let Some(entry) = list.iter().find(|p| {
        p.models.iter().any(|m| m.is_default)
    }) {
        out.provider = entry.family.clone();
        out.base_url = entry.base_url.clone();
        out.model = entry
            .models
            .iter()
            .find(|m| m.is_default)
            .map(|m| m.id.clone())
            .unwrap_or_default();
        if let Ok(Some(key)) = providers::resolve_api_key(app, &entry.id) {
            out.api_key = key;
        }
    }

    // 请求 body 里的 provider-id 覆盖——不改动启动期默认
    // 即可切到另一个已配置的 provider。
    if let Some(pid) = body_json
        .get("provider_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        if let Some(entry) = list.iter().find(|p| p.id == pid) {
            out.provider = entry.family.clone();
            out.base_url = entry.base_url.clone();
            if !entry.model.is_empty() {
                out.model = entry.model.clone();
            }
            if let Ok(Some(key)) = providers::resolve_api_key(app, &pid) {
                out.api_key = key;
            }
        }
    }

    if out.provider.is_empty() {
        return Err("no default provider configured — open Settings first".into());
    }
    if out.model.is_empty() {
        return Err("no default model configured — open Settings first".into());
    }
    Ok(out)
}

// ─── JSON helper ─────────────────────────────────────────────────────────────

fn json_response(status: StatusCode, value: serde_json::Value) -> Response {
    let body = serde_json::to_string(&value).unwrap_or_default();
    (status, body).into_response()
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async fn health_handler() -> impl IntoResponse {
    json_response(StatusCode::OK, serde_json::json!({ "status": "ok" }))
}

async fn chat_completions_handler(
    State(state): State<Arc<HttpServerState>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    // 1. 校验 session token
    let token = match extract_bearer_token(&headers) {
        Some(t) => t,
        None => {
            return json_response(
                StatusCode::UNAUTHORIZED,
                serde_json::json!({ "error": "Missing authorization" }),
            );
        }
    };

    let db_guard = state.db.lock().await;
    let is_valid = verify_token(&db_guard, &token);
    if !is_valid {
        return json_response(
            StatusCode::UNAUTHORIZED,
            serde_json::json!({ "error": "Invalid token" }),
        );
    }
    drop(db_guard);

    // 2. Parse request body
    let body_json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return json_response(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": format!("Invalid JSON: {}", e) }),
            );
        }
    };

    // 3. 解析 target——从 config.json 拿启动期默认，
    //    可选地被请求 body 里的 `provider_id` 覆盖。
    let target = match resolve_target(state.app.as_ref(), &body_json).await {
        Ok(t) => t,
        Err(e) => {
            return json_response(
                StatusCode::PRECONDITION_FAILED,
                serde_json::json!({ "error": e }),
            );
        }
    };

    // 4. 提取请求参数
    let model = body_json["model"].as_str().unwrap_or(&target.model);
    let messages: Vec<ChatMessage> = body_json["messages"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let role = m["role"].as_str().unwrap_or("user");
                    let content = m["content"].as_str()?;
                    Some(ChatMessage {
                        role: role.to_string(),
                        content: content.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let stream = body_json["stream"].as_bool().unwrap_or(false);

    let chat_req = ChatRequest {
        model: model.to_string(),
        messages,
        temperature: Some(0.7),
        max_tokens: Some(2048),
        stream,
    };

    let client = match ProviderFactory::create_client(
        &target.provider,
        if target.api_key.is_empty() {
            None
        } else {
            Some(&target.api_key)
        },
        if target.base_url.is_empty() {
            None
        } else {
            Some(&target.base_url)
        },
    ) {
        Ok(c) => c,
        Err(e) => {
            return json_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                serde_json::json!({ "error": e }),
            );
        }
    };

    // 5. Non-streaming
    if !stream {
        let result = client.chat(chat_req);
        match result {
            Ok(response) => {
                let body = serde_json::json!({
                    "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
                    "object": "chat.completion",
                    "choices": [{
                        "index": 0,
                        "message": { "role": "assistant", "content": response.content },
                        "finish_reason": "stop"
                    }],
                    "model": model,
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0
                    }
                });
                json_response(StatusCode::OK, body)
            }
            Err(e) => {
                json_response(StatusCode::INTERNAL_SERVER_ERROR, serde_json::json!({ "error": e }))
            }
        }
    } else {
        // 6. 流式 SSE
        let chat_id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
        let model_str = model.to_string();
        let provider = target.provider;
        let api_key = target.api_key;
        let base_url = target.base_url;
        let temperature = chat_req.temperature.unwrap_or(0.7);
        let max_tokens = chat_req.max_tokens.unwrap_or(2048);
        let messages = chat_req.messages;

        let stream = stream_chat(
            provider,
            api_key,
            base_url,
            chat_id,
            model_str,
            messages,
            temperature,
            max_tokens,
        );

        use axum::response::sse::{Event, Sse};
        let sse = Sse::new(stream.map(|s| Ok::<_, std::convert::Infallible>(Event::default().data(s))));

        let mut res = sse.into_response();
        res.headers_mut().insert(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        res
    }
}

// ─── Streaming ───────────────────────────────────────────────────────────────

fn stream_chat(
    provider: String,
    api_key: String,
    base_url: String,
    chat_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
) -> impl tokio_stream::Stream<Item = String> + Send + 'static {
    use tokio::sync::mpsc;
    use tokio_stream::wrappers::ReceiverStream;

    let (tx, rx) = mpsc::channel::<String>(100);

    tokio::spawn(async move {
        run_stream(tx, provider, api_key, base_url, chat_id, model, messages, temperature, max_tokens).await;
    });

    ReceiverStream::new(rx)
}

async fn run_stream(
    tx: tokio::sync::mpsc::Sender<String>,
    provider: String,
    api_key: String,
    base_url: String,
    chat_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
) {
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": true,
    });

    let (url, auth_value, auth_header) = resolve_stream_endpoint(&provider, &base_url, &api_key);

    let client = reqwest::Client::new();
    let mut req = client.post(&url).header("Content-Type", "application/json");
    if auth_header == "Bearer" {
        req = req.header("Authorization", auth_value);
    } else if auth_header == "x-api-key" {
        req = req.header("x-api-key", auth_value);
    }

    let resp = match req.json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[HTTP stream] connection error: {}", e);
            return;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        eprintln!("[HTTP stream] HTTP {}: {}", status, text);
        return;
    }

    let mut stream = resp.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                for line in text.lines() {
                    let line = line.trim();
                    if line.starts_with("data:") {
                        let json_str = line.strip_prefix("data:").unwrap().trim();
                        if json_str.is_empty() || json_str == "[DONE]" {
                            continue;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                            let content = json["choices"][0]["delta"]["content"]
                                .as_str()
                                .unwrap_or("");
                            if !content.is_empty() {
                                let event_json = serde_json::json!({
                                    "id": chat_id,
                                    "object": "chat.completion.chunk",
                                    "choices": [{
                                        "index": 0,
                                        "delta": { "content": content },
                                        "finish_reason": null
                                    }],
                                    "model": model,
                                });
                                if let Ok(s) = serde_json::to_string(&event_json) {
                                    if tx.send(s).await.is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[HTTP stream] read error: {}", e);
                return;
            }
        }
    }

    // 发送终止 chunk
    let final_json = serde_json::json!({
        "id": chat_id,
        "object": "chat.completion.chunk",
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": "stop"
        }],
        "model": model,
    });
    if let Ok(s) = serde_json::to_string(&final_json) {
        let _ = tx.send(s).await;
    }
}

fn resolve_stream_endpoint<'a>(provider: &str, base_url: &str, api_key: &str) -> (String, String, &'static str) {
    let trimmed = base_url.trim_end_matches('/');
    match provider {
        "openai" => {
            let url = if trimmed.ends_with("/chat/completions") {
                trimmed.to_string()
            } else if trimmed.ends_with("/v1") {
                format!("{}/chat/completions", trimmed)
            } else {
                format!("{}/v1/chat/completions", trimmed)
            };
            (url, format!("Bearer {}", api_key), "Bearer")
        }
        "anthropic" => {
            let url = format!("{}/v1/messages", trimmed);
            (url, api_key.to_string(), "x-api-key")
        }
        "ollama" => {
            let url = if trimmed.ends_with("/chat/completions") {
                trimmed.to_string()
            } else {
                format!("{}/api/chat", trimmed)
            };
            (url, String::new(), "none")
        }
        "google" => (
            format!("{}/models/{}:generateContent?key={}", trimmed, "", api_key),
            String::new(),
            "none",
        ),
        _ => {
            let url = if trimmed.ends_with("/chat/completions") {
                trimmed.to_string()
            } else if trimmed.ends_with("/v1") {
                format!("{}/chat/completions", trimmed)
            } else {
                format!("{}/v1/chat/completions", trimmed)
            };
            (url, format!("Bearer {}", api_key), "Bearer")
        }
    }
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

pub async fn start_http_server(
    db: Arc<Mutex<Database>>,
    port: u16,
    app: Option<tauri::AppHandle>,
) {
    let state = Arc::new(HttpServerState { db, app });
    let app_router = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/chat/completions", post(chat_completions_handler))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("[HTTP server] Listening on http://{}", addr);
    axum::serve(listener, app_router).await.unwrap();
}
