# Nova - AI 驱动的桌面建站工具

Nova 是一款面向普通人与 AI Agent 的桌面建站工具。管理站点内容如同管理 Markdown 笔记那样简单，无需接触底层实现。

## 功能特点

- **多站点管理** - 仪表盘卡片式概览，轻松管理多个站点
- **Markdown 编辑** - 所见即所得的编辑体验，支持实时预览
- **Astro 驱动** - 内部调用 Astro 框架，生成高性能静态/SSR 站点
- **AI 辅助** - 内置 AI 对话面板，可配置 OpenAI/Anthropic/Google/Ollama 等服务商
- **模板系统** - 内置多种模板（博客/相册/企业官网等），一键克隆使用
- **Agent 集成** - 支持 MCP 协议，外部 AI 工具可直接调用 Nova 能力

## 技术栈

| 层次 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 |
| 前端 | React 19 + MUI 9 + TanStack Query |
| 后端 | Rust + SQLite |
| 站点引擎 | Astro |

## 开发环境

### 前置依赖

- Node.js 18+
- Rust 1.70+
- npm

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 启动前端开发服务器
npm run dev

# 或启动完整 Tauri 开发模式
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

## 应用界面

### 仪表盘

站点卡片式概览，支持创建、删除、打开站点。

### 编辑器

- 左侧：内容列表
- 中间：Markdown 编辑器
- 右侧：实时预览（可隐藏）

### 设置

配置 AI 服务商（API Key、Base URL、模型）与应用端口，自动保存。

- **供应商列表**：只显示已配置的供应商（preset 仅当 `~/.nova/config.json::provider_secrets` 存在对应 key 才出现）。列表展示，按行呈现 label / 来源 / id / base_url / model；`user` 来源右侧带删除按钮。
- **添加供应商**：点击「添加」打开 picker dialog — 选 family → 填 ID + Base URL + API Key → 获取模型列表 → 选定 → 保存。
- **应用端口**：Nova API 端口 + 预览端口，输入即自动保存（400ms debounce）。
- **主题**：**不在设置页**。Dashboard 顶栏的日/月图标一键切换（瞬时切换，不动画）。

## 目录结构

```
nova/
├── src/                    # React 前端
│   ├── pages/
│   │   ├── Dashboard.tsx    # 星图仪表盘 + 主题切换
│   │   ├── ProjectEditor.tsx # 项目编辑器
│   │   └── Settings.tsx      # 设置页面（供应商 + 端口，无主题）
│   └── api/
│       └── client.ts        # Tauri API 客户端
├── src-tauri/              # Rust 后端
│   ├── nova_config.rs      # 统一配置读写 (~/.nova/config.json)
│   ├── commands/
│   │   ├── sites.rs        # 项目管理
│   │   ├── notes.rs        # 纯笔记 CRUD
│   │   ├── content.rs      # 站点内容 CRUD
│   │   ├── chat.rs         # AI 对话 + 模型列表（v1.x：Tauri IPC + Channel<ChatEvent> 流式）
│   │   ├── providers.rs    # 供应商 CRUD
│   │   ├── settings.rs     # 端口设置
│   │   └── deploy.rs
│   ├── provider/           # AI 供应商传输层（openai/anthropic/google/ollama，4 provider 真 SSE override）
│   ├── providers/          # 供应商列表组装（preset + user）
│   ├── db/                 # SQLite 数据库
│   ├── http_server/        # HTTP API 服务器（/health + /v1/chat/completions，未来 + /mcp）
│   └── mcp/                # MCP 协议（计划中）
├── templates/             # 内置 Astro 模板
├── skills/                # 内置技能
└── PLAN.md                # 完整方案文档
```

## 数据存储

- `~/.nova/` - 应用主目录
  - `config.json` - 统一配置文件（`nova_port` / `preview_port` / `theme` / `providers[]` / `provider_secrets{}`，不入 SQLite）。所有 AI 凭证来源唯一于此，**环境变量不再读取**。
  - `nova.db` - SQLite 数据库（项目索引、部署记录）
  - `projects/` - 项目目录（note/site）

## Agent 集成

Nova webview ↔ Rust backend 全走 **Tauri 2 IPC**（`#[tauri::command]` + `tauri::ipc::Channel<T>` 流式）。Nova ↔ **外部** AI 客户端走 **OpenAI 兼容 HTTP**（未来加 MCP Streamable HTTP）。

```json
{
  "mcpServers": {
    "nova": {
      "type": "http",
      "url": "http://localhost:18999/v1/chat/completions"
    }
  }
}
```

详见 [`docs/architecture-decisions/0002-chat-ipc-streaming.md`](docs/architecture-decisions/0002-chat-ipc-streaming.md) 和 [`PLAN.md`](PLAN.md)。

## 文档

| 文档 | 说明 |
|---|---|
| [`PLAN.md`](PLAN.md) | 项目方案总览（v1.x 状态） |
| [`docs/game-design.md`](docs/game-design.md) | 游戏化视觉与交互规范 |
| [`docs/design-tokens.md`](docs/design-tokens.md) | 设计 token 文档 |
| [`docs/conventions/001-comments-zh-CN.md`](docs/conventions/001-comments-zh-CN.md) | 代码注释简体中文约定 |
| [`docs/architecture-decisions/`](docs/architecture-decisions/) | ADR 索引（Provider、Chat IPC 等） |
| [`AGENTS.md`](AGENTS.md) | **AI 协作者必读** |

## 许可证

MIT
