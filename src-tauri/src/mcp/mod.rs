// MCP Server module
// This will implement the Model Context Protocol server for Nova
// allowing external AI tools to interact with Nova

pub mod handler {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    pub struct McpRequest {
        pub method: String,
        pub params: serde_json::Value,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct McpResponse {
        pub result: serde_json::Value,
    }

    pub fn handle_mcp_request(request: McpRequest) -> Result<McpResponse, String> {
        match request.method.as_str() {
            "sites.list" => {
                Ok(McpResponse {
                    result: serde_json::json!({"sites": []}),
                })
            }
            _ => Err(format!("Unknown method: {}", request.method)),
        }
    }
}
