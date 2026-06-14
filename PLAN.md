# Nova — 星系式建站桌面应用

> **Status**: v1.0 | **Date**: 2026-06-13 | **Role**: Dev Lead

---

## 1. 背景与目标

Nova 是一款面向普通人与 AI Agent 的桌面创作/建站工具。用户先像管理 Markdown 笔记一样创建项目，之后可按需将项目点亮为 Astro 站点，无需接触底层实现。产品交互采用“星系建造游戏式”体验：项目是一颗星，笔记是星胚，站点是恒星，部署是信标发射。

**核心价值**：
- 普通人零代码建站（博客/作品集/企业官网/智能体主页）
- AI Agent 可通过技能市场自动发现并调用 Nova 能力
- 内容管理体验如同笔记应用
- 游戏化成长体验：创建、写作、升级、部署都有可见反馈和进度感

**应用场景**：
- 个人博客/作品集：普通人零代码搭建，智能体辅助生成内容
- 小微企业官网：自动同步商品信息、智能客服自动回复咨询
- 智能体专属主页：智能体自主搭建、更新自己的动态展示页
- 活动落地页：快速搭建，表单数据自动推送
- 知识库站点：团队/个人知识库，支持多智能体协作更新

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Nova (Tauri)                           │
│  ┌────────────────┐    ┌─────────────────────────┐        │
│  │  React SPA     │◄──►│  Rust Backend           │        │
│  │  (前端管理界面) │    │  (端口可配置，鉴权可选)   │        │
│  │  Port 3848     │    │  HTTP API + MCP Server  │        │
│  └────────────────┘    └──────────┬──────────────┘        │
│                                   │                        │
│  ┌────────────────┐              │                        │
│  │  Astro Preview │◄─────────────┘                        │
│  │  (iframe 嵌入) │                                       │
│  └────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐      ┌────────────────────────┐
│  文件系统       │      │  Astro Docs MCP       │
│  ~/.nova/       │      │  mcp.docs.astro.build │
│  - config.json  │      └────────────────────────┘
│  - nova.db      │
└─────────────────┘
```

### 2.2 技术栈

| 层次 | 技术 | 说明 |
|---|---|---|
| 桌面框架 | **Tauri** | Rust 后端 + Web 前端 |
| 站点引擎 | **Astro** | 核心，不可替换 |
| 应用管理界面 | **React** | 星图、编辑器、设置、模板市场 |
| 站点编辑/预览 | **Astro** | 复用引擎，所见即所得 |
| 本地预览 | Astro dev server + Vite HMR | iframe 嵌入，右侧可隐藏 |
| 应用数据 | SQLite（元数据）+ 文件系统 | SQLite 存元数据，文件存内容 |
| Agent 通信 | HTTP API + MCP Server | 内部 HTTP，外部 MCP |
| 技能格式 | YAML | 描述 API 端点、参数、示例 |

### 2.3 本地预览机制

- 单一 Astro dev server 进程
- 切换站点时自动切换当前项目
- 预览面板 iframe 嵌入，右侧可隐藏
- 支持 Vite HMR，保存即刷新

---

## 3. 目录结构

```
~/.nova/
├── config.json              # 统一配置（nova_port / preview_port / theme / providers[] / provider_secrets{}，不入 SQLite）
├── nova.db                  # SQLite 数据库（站点索引、部署记录）
├── skills/                  # 内置技能
│   ├── nova.yaml           # Nova 核心技能（站点管理）
│   ├── frontend-style.yaml  # 前端样式技能
│   ├── frontend-component.yaml
│   ├── backend-ssr.yaml
│   └── ...
└── projects/                # 项目目录（note 或 site）
    └── {project-id}/
        ├── notes/          # note 项目的 Markdown 内容
        ├── content/        # site 项目的 Markdown 内容（posts/pages）
        ├── src/            # Astro 源码（site 时存在）
        ├── public/         # 静态资源（site 时存在）
        ├── astro.config.mjs # Astro 配置（site 时存在）
        └── site.yaml       # 站点元数据（site 时存在，用户不可见）
```

---

## 4. 功能设计

### 4.1 星系式项目管理

- **星图概览**：所有项目以星体展示，而非传统 SaaS 卡片列表
- **项目双形态**：项目可为 `note`（纯 Markdown 笔记）或 `site`（Astro 站点）
- **先笔记后建站**：新建时只需输入项目名称，是否成为站点可进入项目后再决定
- **站点配置**：`site.yaml` 存在站点目录内，用户不可见
- **星等反馈**：项目越活跃、内容越成熟，星体越明亮；站点比笔记拥有更强的光环/信标状态

完整的游戏化视觉规范（色彩宇宙、字体、星体阶段、动效边界、文案语气）见 [`docs/game-design.md`](docs/game-design.md)。

### 4.1.1 游戏化交互模型

Nova 的游戏感来自“行动 → 反馈 → 成长 → 奖励”的闭环，而不是持续动效。

| 产品动作 | 游戏化表达 | 反馈 |
|---|---|---|
| 创建项目 | 种下一颗星 | 星点从暗到亮 |
| 创建纯笔记 | 星胚诞生 | 微弱星光 |
| 升级为站点 | 点亮为恒星 | 光环扩散 |
| 保存内容 | 星等提升 | 轻微脉冲 |
| 部署站点 | 发射信标 | 星体向外发射光束 |
| 删除项目 | 星体退场 | 星点塌缩/消散 |
| 达成里程碑 | 流星划过 | 一次性彩蛋 |

详细规则（星体阶段、天文台统计、动效边界、文案语气）见 [`docs/game-design.md`](docs/game-design.md)。

### 4.2 模板体系

**内置 10+ 模板**：

| 模板 | 内容类型 | 说明 |
|---|---|---|
| 博客1 | blog + about | 经典博客布局 |
| 博客2| vlog + about | 视频为主 |
| 博客3 | gallery + about | 图片展示为主 |
| 博客4 | blog + vlog + about | 混合 |
| 博客5 | blog + gallery + about | 混合 |
| 博客6 | vblog + gallery + about | 混合 |
| 博客7 | blog + vblog + gallery + about | 混合 |
| 企业官网 | page + about | 企业介绍 |
| 智能体主页 | page + about | 智能体动态展示 |
| 活动落地页 | page + form | 表单收集 |
| 知识库 | page + about | 文档为主 |
| 作品集 | page + about | 个人作品展示 |

**模板设计**：
- 迁移自 memoria 主题系统（template.html → Astro layout）
- 4 套配色主题：dracula（暗）、mint、nord、peach（亮）
- 应用默认暗色 Dracula，应用默认亮色 Peach

### 4.3 内容模型

所有内容统一存在 `content/posts/`，用 `type` 字段区分：

```yaml
# blog
---
type: blog
title: 标题
date: 2026-01-01
tags: [tag1, tag2]
cover: /images/cover.jpg
---

# vlog
---
type: vlog
title: 标题
date: 2026-01-01
video: https://youtube.com/...
cover: /images/thumb.jpg
tags: [tag1, tag2]
---

# gallery
---
type: gallery
title: 相册名
date: 2026-01-01
photos:
  - url: /images/1.jpg
    caption: 说明
tags: [tag1, tag2]
---
```

### 4.4 编辑体验

| 状态 | 左侧 | 右侧 |
|---|---|---|
| 未进入具体页面 + 预览开启 | 文件树/内容列表 | 站点主页预览 |
| 进入具体页面 + 预览开启 | Markdown 编辑器 | 当前页面实时预览 |
| 预览关闭 | Markdown 编辑器（全宽） | 隐藏 |

### 4.5 部署目标

插件化架构，按需安装：

| 平台 | 状态 |
|---|---|
| Vercel | P1 内置 |
| Netlify | P1 内置 |
| Cloudflare Pages | P1 内置 |
| 自定义服务器（SSH rsync） | P2 |
| 其他平台 | P2 插件市场 |

### 4.6 对象存储

| 用途 | 实现 |
|---|---|
| 图片托管 | S3/MinIO/Cloudflare R2 |
| 站点备份 | 完整站点压缩包上传 |

### 4.7 版本控制

- **自动快照**：每小时/每天自动备份站点内容
- **可选 Git**：用户可连接 Git 仓库，获得完整版本控制

### 4.8 后端能力

支持 SSR 模式，按需激活：

| 配置项 | 说明 |
|---|---|
| SSR 运行时 | Node.js / Deno / Cloudflare Workers |
| 数据库连接 | PostgreSQL / MySQL / SQLite / Supabase |
| 认证服务 | Clerk / Auth.js / 自建 |
| 支付服务 | Stripe / 微信支付 / 支付宝 |

### 4.9 AI 能力

| 能力 | 说明 |
|---|---|
| 内容生成 | 根据描述生成文章/页面 Markdown |
| 模板/样式调整 | 修改 Astro 组件、调整 CSS |
| 部署配置 | 帮用户配置部署目标、域名 |
| 后端配置 | SSR 模式、数据库、认证、支付 |

**AI 服务商配置**：
- 预设供应商：OpenAI、Anthropic、Google (Gemini) — 仅当 `~/.nova/config.json::provider_secrets` 存在对应 key 时才在列表中显示（未配置 = 不出现）
- 用户可添加：Ollama（本地）、OpenAI 兼容、Anthropic 兼容
- 所有配置统一存储在 `~/.nova/config.json`（供应商条目 + API 密钥 + 端口 + 主题），**不入 SQLite**
- 环境变量 (`OPENAI_API_KEY` 等) **不再读取**——Settings UI 是唯一入口，凭证来源 100% config.json

### 4.10 AI 对话入口

- **固定在应用底部**
- 用户可配置 AI 服务商

---

## 5. Agent 集成

### 5.1 通信方式

| 方式 | 用途 |
|---|---|
| **本地 HTTP API** | 内部 Agent 调用（如 Hermes Agent） |
| **MCP Server** | 外部 AI 工具（Claude Desktop、Cursor、Opencode AI 等） |

### 5.2 Nova MCP Server

Nova 自身作为 MCP Server 暴露能力：

```json
{
  "mcpServers": {
    "nova": {
      "type": "http",
      "url": "http://localhost:{port}/mcp"
    }
  }
}
```

### 5.3 Astro Docs MCP

内置 Astro Docs MCP，确保 AI 操作 Astro 时参考最新文档：

```json
{
  "mcpServers": {
    "astro-docs": {
      "type": "http",
      "url": "https://mcp.docs.astro.build/mcp"
    }
  }
}
```

### 5.4 技能系统

#### 内置技能清单

| 分类 | 技能 | 说明 |
|---|---|---|
| **Nova 核心** | `nova-site` | 站点管理（创建/删除/配置） |
| | `nova-content` | 内容管理（文章/vlog/gallery CRUD） |
| | `nova-deploy` | 部署推送 |
| | `nova-template` | 模板克隆/切换 |
| **前端设计** | `frontend-style` | 调整样式/配色/字体 |
| | `frontend-component` | 创建/修改 Astro 组件 |
| | `frontend-layout` | 调整页面布局结构 |
| **内容创作** | `content-writer` | 生成博客/页面文案 |
| | `content-seo` | SEO 优化（meta/描述/关键词） |
| | `image-alt` | 批量生成图片 alt 文字 |
| **后端能力** | `backend-ssr` | 开启/配置 Astro SSR 模式 |
| | `backend-api` | 创建 Astro API endpoints |
| | `backend-db` | 配置数据库连接、生成数据模型 |
| | `backend-auth` | 集成认证服务进站点 |
| | `backend-payment` | 集成支付服务进站点 |
| **运营集成** | `analytics` | 接入统计（Umami/GA） |
| | `form-handler` | 表单数据推送 |
| | `social-sync` | 同步内容到社交平台 |
| **业务组件** | `auth-integration` | 将认证体系集成进站点 |
| | `payment-integration` | 将支付体系集成进站点 |

#### P0 内置技能

MVP 阶段只需以下技能：

| 技能 | 说明 |
|---|---|
| `nova-project` | 项目管理（note/site/升级） |
| `nova-content` | 笔记与站点内容管理 |
| `nova-deploy` | 部署推送 |
| `frontend-style` | 样式调整 |
| `frontend-component` | 组件修改 |

其他技能 → P2 技能市场。

#### 技能文件格式（YAML）

```yaml
name: nova-content
description: 管理 Nova 项目内容（笔记、博客、影像、相册）
api:
  - endpoint: POST /api/projects/{projectId}/notes
    parameters:
      - name: title
        type: string
      - name: content
        type: markdown
      - name: tags
        type: array
  - endpoint: POST /api/projects/{projectId}/posts
    parameters:
      - name: title
        type: string
      - name: content
        type: markdown
      - name: type
        type: enum
        values: [blog, vlog, gallery]
      - name: tags
        type: array
```

---

## 6. 应用主题

| 模式 | 配色主题 | 来源 |
|---|---|---|
| 暗色模式 | Dracula | memoria/dracula |
| 亮色模式 | Peach | memoria/peach |

主题跟随系统偏好自动切换，设置页已移除主题开关。

### 6.1 交互性能原则

游戏化交互不能牺牲工具效率。Nova 的性能约束：

| 场景 | 目标 |
|---|---|
| 日常启动 | 不播放完整开场，直接进入星图 |
| 首次启动 | 开场仪式不超过 1.2 秒 |
| 编辑打字 | 禁止持续 canvas 动效干扰；预览可 debounce |
| 星图动效 | 低帧率、低密度、tab 隐藏暂停 |
| 成就/彩蛋 | 只在关键里程碑触发，不常驻打扰 |

---

## 7. MVP 范围

### P0（第一个可运行版本）

| 功能 | 说明 |
|---|---|
| 星图 Dashboard | 创建/删除项目，以星体展示 note/site |
| 纯笔记项目 | 只输入项目名称即可创建，支持 Markdown 编辑与预览 |
| 升级为站点 | 在项目内选择模板，将 note 点亮为 site |
| 模板克隆 | 从内置博客模板创建或升级为站点 |
| Markdown 编辑 | 笔记/内容列表 + 编辑器 + Markdown 预览 |
| 本地预览 | site 项目启用 Astro dev server + iframe，右侧可隐藏 |
| 轻量游戏反馈 | 创建点亮、保存脉冲、星等状态、天文台统计 |
| AI 对话面板 | 底部固定，可配置 AI 服务商 |

### P1（完整闭环）

| 功能 | 说明 |
|---|---|
| 部署推送 | 至少一个平台（Vercel/Netlify/Cloudflare） |
| 全部内置模板 | 10+ 模板可用 |
| AI 副官提示 | 根据上下文给出内容、SEO、模板、部署建议 |
| 成就/任务 | 第一颗星、千字星尘、初次发布、连续轨道等 |
| 技能市场浏览 | 人类用户浏览/安装技能 |

### P2（插件生态）

| 功能 | 说明 |
|---|---|
| 技能市场 | 线上浏览/安装技能 |
| 对象存储 | 图片托管 + 站点备份 |
| Git 集成 | 版本控制 |
| 业务组件 | 认证体系、支付体系 |
| 更多部署平台 | 插件化 |
| 可拖拽星图 | 缩放、拖拽、星座连线、标签星云 |

---

## 8. 数据库 Schema

### SQLite 表

```sql
-- 项目索引：note 或 site
CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'note', -- 'note' | 'site'
    template    TEXT NOT NULL DEFAULT '',     -- site 时有效
    path        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- 用户设置
CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

-- 部署历史
CREATE TABLE deploy_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL,
    platform    TEXT NOT NULL,
    status      TEXT NOT NULL,
    deployed_at INTEGER NOT NULL
);
```

---

## 9. API 端点

### 项目管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/projects` | 列出所有项目（note/site） |
| `POST` | `/api/projects` | 创建项目，可为纯笔记或站点 |
| `GET` | `/api/projects/:id` | 项目详情 |
| `PUT` | `/api/projects/:id` | 更新项目配置 |
| `POST` | `/api/projects/:id/upgrade-to-site` | 将 note 升级为 site |
| `DELETE` | `/api/projects/:id` | 删除项目 |

### 笔记管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/projects/:id/notes` | 列出纯笔记项目的 Markdown 笔记 |
| `POST` | `/api/projects/:id/notes` | 创建笔记 |
| `PUT` | `/api/projects/:id/notes/:noteId` | 更新笔记 |
| `DELETE` | `/api/projects/:id/notes/:noteId` | 删除笔记 |

### 内容管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/projects/:id/posts` | 列出 site 项目的站点内容 |
| `POST` | `/api/projects/:id/posts` | 创建站点内容 |
| `GET` | `/api/projects/:id/posts/:postId` | 内容详情 |
| `PUT` | `/api/projects/:id/posts/:postId` | 更新内容 |
| `DELETE` | `/api/projects/:id/posts/:postId` | 删除内容 |

### 部署

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/projects/:id/deploy` | 部署 site 项目 |
| `GET` | `/api/projects/:id/deploy/history` | 部署历史 |

### 设置

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/settings` | 获取端口设置（从 config.json） |
| `PUT` | `/api/settings` | 更新端口设置（写入 config.json） |

### MCP

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/mcp` | MCP 协议端点 |

---

## 10. 关键文件

```
nova/
├── src/                    # Tauri 前端（React）
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx    # 星图 Dashboard
│   │   ├── ProjectEditor.tsx # 项目编辑器（note/site）
│   │   └── Settings.tsx    # 设置页面
│   ├── components/
│   │   ├── ProjectCard.tsx
│   │   ├── MarkdownPreview.tsx
│   │   ├── Observatory.tsx
│   │   ├── Starfield.tsx
│   │   └── AIChatPanel.tsx
│   └── api/
│       └── client.ts

├── src-tauri/             # Rust 后端
│   ├── main.rs
│   ├── nova_config.rs     # 统一配置读写（~/.nova/config.json：ports / theme / providers / provider_secrets）
│   ├── commands/
│   │   ├── sites.rs        # 项目管理命令
│   │   ├── notes.rs        # 纯笔记 CRUD
│   │   ├── content.rs
│   │   ├── chat.rs         # AI 对话 + 模型列表
│   │   ├── providers.rs    # 供应商 CRUD 命令
│   │   ├── settings.rs     # 端口设置命令
│   │   └── deploy.rs
│   ├── provider/           # AI 供应商传输层
│   │   ├── config.rs       # 供应商注册表（openai/anthropic/google/ollama）
│   │   ├── openai.rs / anthropic.rs / google.rs / ollama.rs
│   │   └── mod.rs          # ProviderFactory（凭证仅接受显式参数，不再读 env）
│   ├── providers/
│   │   └── mod.rs          # 供应商列表组装（preset + user，preset 仅当 config.json 有 secret 才显示）
│   ├── db/
│   │   └── mod.rs          # SQLite 数据库
│   ├── http_server/
│   │   └── mod.rs          # HTTP API 服务器（流式对话等）
│   └── mcp/
│       └── server.rs       # MCP 协议端点
├── skills/                # 内置技能 YAML
│   ├── nova-site.yaml
│   ├── nova-content.yaml
│   └── ...
├── templates/             # 内置 Astro 模板
│   ├── blog/
│   ├── gallery/
│   └── ...
├── nova.db                 # SQLite 数据库
└── config.json            # 统一配置文件
```
