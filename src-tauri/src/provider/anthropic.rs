use crate::provider::{ChatRequest, ChatResponse, LLMClient, StreamCallback, Usage};
use reqwest::blocking::Client;
use serde::Deserialize;

/// 从 Anthropic 的 `/v1/models` 端点拉取实时模型列表。
///
/// 为什么用运行时调用而不是写死常量：Anthropic 按自己的节奏发布新模型
/// （并下线旧模型）。编译期写死的列表发版次日就过时。端点要求
/// `x-api-key`，返回结构 `{ "data": [{ "id": "..." }, ...] }`——
/// 与 OpenAI 的 `/v1/models` 同形，下面的解析逻辑复用同一条路径。
pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    let url = if base.ends_with("/v1") {
        format!("{}/models", base)
    } else {
        format!("{}/v1/models", base)
    };

    let client = Client::new();
    let response = client
        .get(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Anthropic 模型列表请求失败：{} - {}",
            status, text
        ));
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Anthropic 模型列表返回了非法 JSON：{}", e))?;
    let models = json["data"]
        .as_array()
        .ok_or("Anthropic 模型列表响应缺少 data 数组")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    Ok(models)
}

pub struct AnthropicClient {
    api_key: String,
    base_url: String,
    http: Client,
}

impl AnthropicClient {
    pub fn new(api_key: &str, base_url: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            base_url: base_url.to_string(),
            http: Client::new(),
        }
    }

    /// 流式 chat：POST `/v1/messages` 时带 `stream: true`，按 SSE 逐块
    /// 把 `content_block_delta` 事件的 `delta.text` 推给 `on_delta`。
    /// 终止事件 `message_stop` 后再尝试取一次最终 message 以抓取
    /// `usage` 字段（Anthropic 把 usage 放在终止事件里）。
    fn chat_stream_inner(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        let url = format!("{}/v1/messages", self.base_url);

        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
            "stream": true,
        });

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .map_err(|e| format!("Anthropic 请求失败：{}", e))?;

        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            return Err(format!("Anthropic 返回 {}：{}", status, text));
        }

        let mut full_text = String::new();
        let mut usage: Option<Usage> = None;

        // Anthropic SSE 事件类型：
        //   message_start   - 含 message id/model/usage.input_tokens
        //   content_block_start
        //   content_block_delta - 含 delta.text（这是要流出去的内容）
        //   content_block_stop
        //   message_delta   - 含 usage.output_tokens
        //   message_stop    - 终止
        //   ping            - 心跳，忽略
        // 我们关心的是 content_block_delta 里的 text 与 message_delta 里的 usage。
        let mut event_name = String::new();
        let mut data_lines: Vec<String> = Vec::new();

        for line in response.text().map_err(|e| e.to_string())?.lines() {
            if let Some(rest) = line.strip_prefix("event: ") {
                event_name = rest.trim().to_string();
                continue;
            }
            if let Some(rest) = line.strip_prefix("data: ") {
                data_lines.push(rest.to_string());
                continue;
            }
            if line.is_empty() && !data_lines.is_empty() {
                let payload = data_lines.join("\n");
                data_lines.clear();
                let json: serde_json::Value = match serde_json::from_str(&payload) {
                    Ok(v) => v,
                    Err(_) => {
                        event_name.clear();
                        continue;
                    }
                };
                match event_name.as_str() {
                    "content_block_delta" => {
                        if let Some(text) = json["delta"]["text"].as_str() {
                            full_text.push_str(text);
                            on_delta(text)?;
                        }
                    }
                    "message_delta" => {
                        if let Some(u) = json["usage"].as_object() {
                            let input = u
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32;
                            let output = u
                                .get("output_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32;
                            usage = Some(Usage {
                                prompt_tokens: input,
                                completion_tokens: output,
                                total_tokens: input + output,
                            });
                        }
                    }
                    _ => {}
                }
                event_name.clear();
            }
        }

        Ok(ChatResponse {
            content: full_text,
            model: request.model,
            usage,
        })
    }

    /// 非流式 fallback：调 `/v1/messages` 不带 `stream`，一次性返回。
    /// 保留给 `chat()` 调用方（test_provider / list_models 等不走流式）。
    pub fn chat_blocking(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        #[derive(Deserialize)]
        struct AnthropicUsage {
            input_tokens: Option<u32>,
            output_tokens: Option<u32>,
        }

        let url = format!("{}/v1/messages", self.base_url);
        let body = serde_json::json!({
            "model": request.model,
            "messages": request.messages,
            "temperature": request.temperature.unwrap_or(0.7),
            "max_tokens": request.max_tokens.unwrap_or(2048),
        });

        let response = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = response.json().map_err(|e| e.to_string())?;
        let content = json["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let usage = json.get("usage").and_then(|u| serde_json::from_value::<AnthropicUsage>(u.clone()).ok()).map(|u| Usage {
            prompt_tokens: u.input_tokens.unwrap_or(0),
            completion_tokens: u.output_tokens.unwrap_or(0),
            total_tokens: u.input_tokens.unwrap_or(0) + u.output_tokens.unwrap_or(0),
        });

        Ok(ChatResponse {
            content,
            model: request.model,
            usage,
        })
    }
}

impl LLMClient for AnthropicClient {
    fn provider_name(&self) -> &str {
        "anthropic"
    }

    fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        self.chat_blocking(request)
    }

    fn chat_stream(
        &self,
        request: ChatRequest,
        on_delta: StreamCallback,
    ) -> Result<ChatResponse, String> {
        self.chat_stream_inner(request, on_delta)
    }
}
