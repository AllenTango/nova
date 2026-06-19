# Nova — 星系式建站桌面应用

> **Status**: v1.x（命题 A 已落地：chat 改 Tauri 2 IPC + `tauri::ipc::Channel<ChatEvent>` 流式）| **v2.0 草案**（文件系统优先工作台系统，见 ADR 0004） | **Date**: 2026-06-17 | **Role**: Dev Lead
>
> 关联文档：
> - [`docs/game-design.md`](docs/game-design.md) — 游戏化视觉与交互规范
> - [`docs/design-tokens.md`](docs/design-tokens.md) — 设计 token 文档
> - [`docs/conventions/001-comments-zh-CN.md`](docs/conventions/001-comments-zh-CN.md) — 代码注释简体中文约定
> - [`docs/architecture-decisions/0001-provider-system.md`](docs/architecture-decisions/0001-provider-system.md) — Provider 系统设计
> - [`docs/architecture-decisions/0002-chat-ipc-streaming.md`](docs/architecture-decisions/0002-chat-ipc-streaming.md) — Chat IPC 流式架构（取代 v1.0 HTTP fetch）
> - [`docs/architecture-decisions/0003-default-model.md`](docs/architecture-decisions/0003-default-model.md) — Default-Model 显式状态管理
> - [`docs/architecture-decisions/0004-workspace-system.md`](docs/architecture-decisions/0004-workspace-system.md) — 🔴 **v2.0 工作台系统与文件集成**（2026-06-17 新决策，Draft）

---

## 1. 背景与目标

Nova 是一款面向普通人与 AI Agent 的桌面创作/建站工具。**v2.0 方向**：采用**文件系统优先模型**，用户可直接打开现有文件夹（笔记、照片、视频），Nova 自动识别并"点亮"为项目；支持多工作台切换（对应不同"星系"）；任意状态的项目都能一键分享或发布。无需接触底层实现，内容管理体验如同文件浏览器。产品交互采用"星系建造游戏式"体验：工作台是星系，项目是一颗星，笔记是星胚，站点是恒星，分享与部署是信标发射。

**核心价值**：
- 普通人零代码建站（博客/作品集/企业官网/智能体主页）
- 文件夹自动识别 → 一键发布（无需项目创建流程）
- 支持多工作台切换（个人博客、旅游日志、企业官网分离）
- 随处分享（任何编辑状态的项目都可分享）
- AI Agent 可通过技能市场自动发现并调用 Nova 能力
- 游戏化成长体验：发现新作品、导入项目、分享、发布都有可见反馈和进度感

**应用场景**：
- 个人博客/作品集：普通人零代码搭建，智能体辅助生成内容
- 小微企业官网：自动同步商品信息、智能客服自动回复咨询
- 智能体专属主页：智能体自主搭建、更新自己的动态展示页
- 活动落地页：快速搭建，表单数据自动推送
- 知识库站点：团队/个人知识库，支持多智能体协作更新

---

## 2. 技术架构

### 2.1 整体架构

#### 2.1.1 v1.x（当前）— 应用优先

```
┌─────────────────────────────────────────────────────────────┐
│                      Nova (Tauri)                           │
│  ┌────────────────┐    ┌─────────────────────────┐        │
│  │  React SPA     │◄──►│  Rust Backend           │        │
│  │  (前端管理界面) │    │  (Tauri commands + IPC) │        │
│  │  Tauri webview │    │  Channel<ChatEvent> 流式 │        │
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
│  文件系统       │      │  外部 AI 客户端入口     │
│  ~/.nova/       │      │  (OpenAI 兼容 HTTP)     │
│  - config.json  │      │  /v1/chat/completions  │
│  - nova.db      │      │  /mcp (未来 MCP)        │
└─────────────────┘      └────────────────────────┘
```

#### 2.1.2 v2.0（草案）— 工作台视图

```
┌─────────────────────────────────────────────────────────────┐
│                      Nova (Tauri)                           │
│  ┌────────────────┐    ┌─────────────────────────┐        │
│  │  React SPA     │◄──►│  Rust Backend           │        │
│  │  工作台切换器  │    │  workspace_manager.rs   │        │
│  │  星图 / 编辑器 │    │  project_scanner.rs     │        │
│  │  Tauri webview │    │  Channel<ChatEvent> 流式 │        │
│  └────────────────┘    └──────────┬──────────────┘        │
│                                   │                        │
│  ┌────────────────┐              │                        │
│  │  Astro Preview │◄─────────────┘                        │
│  │  (iframe 嵌入) │                                       │
│  └────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
         │                │                    │
         ▼                ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌────────────────┐
│ ~/.nova/     │  │ ~/MyWorks/   │  │ D:/WorkSite/   │
│ (应用配置)   │  │ (工作台 1)   │  │ (工作台 2)     │
│ config.json  │  │ .nova/db     │  │ .nova/db       │
│ nova.db      │  │ projects/    │  │ projects/      │
│ skills/      │  │ MyBlog/      │  │ CompanySite/   │
│              │  │ PhotoAlbum/  │  │                │
└──────────────┘  └──────────────┘  └────────────────┘
                       │                    │
                       ▼                    ▼
              ┌──────────────┐     ┌──────────────┐
              │ 外部 AI 入口 │     │ 站点发布目标 │
              │ /v1/chat     │     │ Vercel/Netlfy│
              │ /mcp (未来)  │     │ CloudFlare   │
              └──────────────┘     └──────────────┘
```

**关键变化**（v1.x → v2.0）：
- 数据所有权转移：`~/.nova/projects/` → 用户文件系统任意位置
- 多工作台支持：每个工作台一份 `workspaces.db`，互不干扰
- 项目发现方式：`.nova.yaml` 元数据 + 文件类型嗅探（不是 SQLite 主键）
- 任何状态都能分享/发布（无需先"创建项目"流程）

详细数据模型与迁移计划见 [ADR 0004](docs/architecture-decisions/0004-workspace-system.md)。

**v1.x 变更**：chat 通讯从 v1.0 嘅 HTTP fetch + SSE wire 解析改为 Tauri 2 IPC + `tauri::ipc::Channel<ChatEvent>` 流式（命题 A）。HTTP server 收紧到只剩 `/health` + `/v1/chat/completions`（外部 OpenAI 兼容客户端用），见 ADR 0002。

### 2.2 技术栈

| 层次 | 技术 | 说明 |
|---|---|---|
| 桌面框架 | **Tauri** | Rust 后端 + Web 前端 |
| 站点引擎 | **Astro** | 核心，不可替换 |
| 应用管理界面 | **React** | 星图、编辑器、设置、模板市场 |
| 站点编辑/预览 | **Astro** | 复用引擎，所见即所得 |
| 本地预览 | Astro dev server + Vite HMR | iframe 嵌入，右侧可隐藏 |
| 应用数据 | SQLite（元数据）+ 文件系统 | SQLite 存元数据，文件存内容 |
| **内部 chat 通讯** | **Tauri 2 IPC + `Channel<ChatEvent>` 流式** | **v1.x（命题 A）** |
| **外部 Agent 通讯** | **OpenAI 兼容 HTTP + MCP Streamable HTTP** | v1.x 起 |
| 技能格式 | YAML | 描述 API 端点、参数、示例 |

### 2.3 本地预览机制

- 单一 Astro dev server 进程
- 切换站点时自动切换当前项目
- 预览面板 iframe 嵌入，右侧可隐藏
- 支持 Vite HMR，保存即刷新

---

## 3. 目录结构

```
~/.nova/                        # Nova 应用目录
├── config.json              # 配置（nova_port / theme / active_workspace / workspaces[] / providers[]）
├── nova.db                  # SQLite 数据库（全局设置、部署记录）
├── workspaces.db            # 工作台索引 (NEW)
├── skills/                  # 内置技能
│   ├── nova.yaml           # Nova 核心技能（站点管理）
│   ├── frontend-style.yaml  # 前端样式技能
│   ├── ...
└── [已废弃] projects/       # v1.x 项目目录（迁移到工作台）

~/MyWorks/                      # 工作台 1（用户文件系统）
├── .nova/
│   ├── workspaces.db        # 工作台索引
│   └── sync-history.json
├── My Blog/                 # 项目 1
│   ├── posts/               # 博客文章
│   │   ├── hello.md
│   │   └── tech.md
│   ├── photos/              # 相册
│   ├── .nova.yaml           # 项目元数据 (NEW)
│   └── [用户其他文件]
├── Photo Album/             # 项目 2
│   ├── summer/
│   ├── winter/
│   └── .nova.yaml
└── [用户其他任意内容]        # 未来 6 个模板会写入对应结构

D:/WorkSite/                   # 工作台 2（用户文件系统，D 盘）
├── CompanySite/             # 企业站点
│   ├── products/
│   ├── team/
│   └── .nova.yaml
└── ...
```

> **关键不变量**：用户的工作台和项目都是普通文件夹；Nova 看到 `.nova.yaml` 才认定是项目，否则就是普通文件。

---

## 4. 功能设计

### 4.1 星系式项目管理

#### 4.1.0 工作台（v2.0 草案）

- **工作台 = 用户的任意文件夹**：选择 `~/MyWorks/` 或 `D:/WorkSite/` 即可成为工作台，Nova 在其根目录创建 `.nova/` 目录
- **多工作台切换**：顶栏左侧展示"当前星系"，下拉切换到其他工作台；每个工作台拥有独立项目集合
- **项目 = 文件夹 + `.nova.yaml`**：Nova 通过文件类型嗅探（Markdown / 图片 / 视频）和 `.nova.yaml` 元数据识别项目
- **零创建流程**：用户直接打开文件夹即可；Nova 看到 `.nova.yaml` 才认定是项目
- **双形态**：`note`（纯 Markdown 笔记）或 `site`（Astro 站点），可在项目内随时切换

#### 4.1.1 星图与游戏化

- **星图概览**：所有项目以星体展示，而非传统 SaaS 卡片列表
- **星系视角**：每个工作台是一个"星系"，星图展示当前工作台的所有项目
- **项目双形态**：项目可为 `note`（纯 Markdown 笔记）或 `site`（Astro 站点）
- **先笔记后建站**：新建时只需输入项目名称，是否成为站点可进入项目后再决定
- **站点配置**：`site.yaml` 存在站点目录内，用户不可见
- **星等反馈**：项目越活跃、内容越成熟，星体越明亮；站点比笔记拥有更强的光环/信标状态

完整的游戏化视觉规范（色彩宇宙、字体、星体阶段、动效边界、文案语气）见 [`docs/game-design.md`](docs/game-design.md)。

### 4.1.2 游戏化交互模型

Nova 的游戏感来自"行动 → 反馈 → 成长 → 奖励"的闭环，而不是持续动效。

| 产品动作 | 游戏化表达 | 反馈 |
|---|---|---|
| **v2.0 新增：打开工作台** | **星系降临** | 工作台首次打开时全屏星云展开动画 1.2s |
| **v2.0 新增：发现项目** | **捕获新星** | 文件夹被识别为项目时流星划过一次性彩蛋 |
| **v2.0 新增：导入项目** | **新星诞生** | 现有文件夹升级为项目时的入场动效 |
| 创建项目 | 种下一颗星 | 星点从暗到亮 |
| 创建纯笔记 | 星胚诞生 | 微弱星光 |
| 升级为站点 | 点亮为恒星 | 光环扩散 |
| 保存内容 | 星等提升 | 轻微脉冲 |
| **v2.0 新增：一键分享** | **流星雨** | 任何状态项目都可分享；分享链接生成时流星划过头顶 |
| 部署站点 | 发射信标 | **定向光束**从星体向上发射（0.8s）+ 冲击波；阶段升为**星港** |
| **v2.0 新增：发布到公网** | **信标闪烁** | 部署完成时恒星闪烁 + 一次性光束 |
| 删除项目 | 星体退场 | 星点塌缩/消散 |
| 达成里程碑 | 流星划过 | 一次性彩蛋 |
| 连续 7 天 streak | 轨道稳定 | OrbitRing 金色闪烁 + toast "轨道已稳定" |
| 连续 30 天 streak | 引力锁定 | 全屏流星雨 1.5s + AI 副官祝贺 |

**v2.0 关键变化**：
- **发现代替创建**：用户不再需要"创建项目"流程；打开文件夹即发现
- **分享随时随地**：任何状态的项目（含未保存的草稿、纯笔记）都能分享
- **多工作台隔离**：每个工作台的项目状态、星图进度、成就独立计算
- **星港阶段修正**：由 `deploy_history` 记录触发，而非 word count >= 1000

详细规则（星体阶段、天文台统计、动效边界、文案语气）见 [`docs/game-design.md`](docs/game-design.md)。

### 4.2 模板体系

**v1.0 现状**：内置 **1 套 blog 模板**（`templates/site/`）。代码里保留 6 个 template id 兜底：`blog` / `gallery` / `vlog` / `blog-gallery` / `corporate` / `agent-home`，**全部 fall back 到 blog**——这是行业常态但 UX 应清楚。

**v2.x 计划**：拆 `template` trait + 双路径（builtin / user_root），引入 `template.yaml` manifest schema + 远端 registry.json（静态托管 S3/R2/GitHub Releases）。详见 [ADR 0001 §2.2 备注](docs/architecture-decisions/0001-provider-system.md) 嘅「模板」章节（v2.x 计划）。

**配色主题**：4 套——dracula（暗）、mint、nord、peach（亮）。应用默认暗色 Dracula + 亮色 Peach。

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

### 4.4 编辑体验（Bear 风格）

Nova 编辑器追求 Bear App 的流畅感：打开即写、写完即存、最少干扰。

**创建流程**：
- 点击 `+` 或 `Cmd+N` → 立即在文件系统创建空记录（无对话框、无表单）
- 新条目出现在侧栏列表顶部，编辑器自动聚焦
- 创建耗时 < 100ms（纯本地操作，无网络阻塞）

**编辑模型**：
- 无独立标题字段：第一行 `# Title` 或第一段文本 → 自动提取为 title
- 无独立标签字段：正文 `#tag` → 保存时解析写入 frontmatter `tags: []`
- 正文区全宽（预览默认隐藏）

**保存模型**：
- 800ms debounce 自动保存（真正 persist 到文件系统，替代 localStorage 草稿）
- "同步" 按钮保留 = force-flush + "已同步至星图" 脉冲反馈
- 需后端 incremental save 命令支持

**预览**：
- 默认隐藏；toggle 键/快捷键展开（50% 侧滑）
- note 项目：Markdown 渲染
- site 项目：iframe Astro dev server

**状态行**：
- 左：`已同步 {timestamp}` 或 `正在同步…`
- 右：OrbitRing(阶段色) + 星尘质量 `{字数}` + 阶段标签 chip

完整 Bear 风格规范见 [`docs/game-design.md`](docs/game-design.md) §4.4。

### 4.4.1 响应式设计策略

Nova 窗口支持 768px 最小宽度优雅降级（桌面分屏 / 小窗口场景）。

| 页面/组件 | narrow (< 768px) | medium (768–1024px) | wide (> 1024px) |
|---|---|---|---|
| Dashboard 星图 | 列表视图替代 SVG | StarMap clamp(300px,50vh,600px) | StarMap 完整交互 |
| 侧栏 | 抽屉/icon rail 40px | 200px permanent 紧凑 | 260px permanent |
| 编辑器预览 | tab/overlay | 默认隐藏 | 可切换 50% |
| Observatory | 单行折叠 | 3 指标紧凑 | 完整 4 指标 + milestone |
| AI 副官 | 全宽 overlay | 底部固定 | 底部固定 |

**实现优先级**：P1 medium（分屏常见）→ P2 narrow（极端小窗）。

断点 token 见 [`docs/design-tokens.md`](docs/design-tokens.md) §4.2；完整响应式约束见 [`docs/game-design.md`](docs/game-design.md) §9。

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
- 预设供应商：OpenAI、Anthropic、Ollama — 仅当 `~/.nova/config.json::provider_secrets` 存在对应 key 时才在列表中显示（未配置 = 不出现）
- 用户可添加：Custom — OpenAI 兼容 或 Anthropic 兼容（按 `kind=openai_compat / anthropic_compat` 区分协议，user 自填 base_url）
- 所有配置统一存储在 `~/.nova/config.json`（供应商条目 + API 密钥 + 端口 + 主题），**不入 SQLite**
- 环境变量 (`OPENAI_API_KEY` 等) **不再读取**——Settings UI 是唯一入口，凭证来源 100% config.json

### 4.10 AI 对话入口

- **固定在应用底部**
- 用户可配置 AI 服务商

---

## 5. Agent 集成

### 5.1 通讯分层

Nova webview ↔ Rust backend 全走 **Tauri IPC**（`#[tauri::command]` + `tauri::ipc::Channel<T>` 流式）。Nova ↔ **外部** AI 客户端（Hermes、Claude Desktop、Cursor、OpenCode 等）走 **HTTP**（OpenAI 兼容 + 未来 MCP Streamable HTTP）。

| 方向 | 协议 | 用途 |
|---|---|---|
| **内部**：Nova webview ↔ Rust | Tauri 2 IPC + `Channel<ChatEvent>` | AIChatPanel 流式对话（v1.x 命题 A） |
| **外部**：Rust ↔ 外部 AI 客户端 | HTTP `/v1/chat/completions` | OpenAI 兼容入口，Hermes 等可直连 |
| **外部**：Rust ↔ 外部 AI 客户端 | HTTP `/mcp` | MCP Streamable HTTP（v2.x 命题 B） |
| **内部**：Rust ↔ 外部 provider | HTTPS | OpenAI / Anthropic / Ollama（+ Custom 走 OpenAI 或 Anthropic 协议） |

详细架构决策见 [ADR 0002](docs/architecture-decisions/0002-chat-ipc-streaming.md)。

### 5.2 Nova HTTP Server（外部 OpenAI 兼容 + MCP 入口）

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

v2.x 加入 MCP Streamable HTTP 端点 `/mcp`（命题 B）。

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
│   │   ├── content.rs      # 站点内容 CRUD
│   │   ├── chat.rs         # AI 对话 + 模型列表（v1.x：Channel<ChatEvent> 流式）
│   │   ├── providers.rs    # 供应商 CRUD 命令
│   │   ├── settings.rs     # 端口设置命令
│   │   └── deploy.rs
│   ├── provider/           # AI 供应商传输层
│   │   ├── config.rs       # 供应商注册表（openai/anthropic/ollama + Custom 动态组装）
│   │   ├── openai.rs / anthropic.rs / ollama.rs
│   │   └── mod.rs          # ProviderFactory + LLMClient trait + chat_stream 4 family override
│   ├── providers/
│   │   └── mod.rs          # 供应商列表组装（preset + user，preset 仅当 config.json 有 secret 才显示）
│   ├── db/
│   │   └── mod.rs          # SQLite 数据库
│   ├── http_server/
│   │   └── mod.rs          # HTTP API 服务器（/health + /v1/chat/completions，未来 + /mcp）
│   └── mcp/
│       └── mod.rs          # MCP 协议 stub（计划中）
├── skills/                # 内置技能 YAML
│   ├── nova-site.yaml
│   ├── nova-content.yaml
│   └── ...
├── templates/             # 内置 Astro 模板（v1.0 实际 1 套 blog，6 个 template id 全部兜底）
│   └── site/              # 当前实际模板目录
│       └── blog/          # 兜底 blog
├── nova.db                 # SQLite 数据库
└── config.json            # 统一配置文件
```

---

## 11. Changelog

### 2026-06-19：文档更新 — Bear 风格编辑器 + 暗色对比度修复 + 响应式设计

- **docs/game-design.md**：§2.1 色彩对比度修正（starDim/starFaint/dust/surface 提亮）; §3.1 新增 deploy/streak 事件; §3.2 星港条件修正为 deploy_history; 新增 §4.4 Bear 风格编辑器; §5 响应式动效; 新增 §9 响应式约束
- **docs/design-tokens.md**：§2 色值更新 + 对比度标注; §3.2 响应式字号缩放; 新增 §4.2 断点 token (BREAK/SIDEBAR/STARMAP); §5.2 响应式动效规则
- **PLAN.md**：§4.1.2 事件表修正（deploy 光束 + streak 里程碑）; §4.4 编辑体验重写为 Bear 风格; 新增 §4.4.1 响应式策略
- **AGENTS.md**：§3 必读索引更新; §4.4 编辑器约束; 新增 §4.6 响应式设计约束
- **代码未同步**：本次仅更新文档规范；代码实现为后续 P1 任务

### 2026-06-17：ADR 0004 v2.0 工作台系统（Draft 决策）

- **方向调整**：v2.0 从"应用优先"转向"**文件系统优先**"——用户可直接打开任意文件夹作为工作台，Nova 自动识别并"点亮"为项目
- **新决策**：[`docs/architecture-decisions/0004-workspace-system.md`](docs/architecture-decisions/0004-workspace-system.md)（Draft）
- **关键变化**：
  - 数据所有权从 `~/.nova/projects/` 转移到用户文件系统任意位置（`~/MyWorks/` / `D:/WorkSite/`）
  - 多工作台切换（每个工作台是一份独立的 `workspaces.db` + 项目集合，对应不同"星系"）
  - 项目元数据从 SQLite 迁出为每个项目的 `.nova.yaml` 文件
  - 任何状态的项目都能一键分享或发布（无需"创建项目"流程）
  - 项目发现方式：`.nova.yaml` 存在 + 文件类型嗅探（Markdown / 图片 / 视频）
- **本文件已同步**：§1 背景目标 / §2.1 整体架构（v1.x + v2.0 双图）/ §3 目录结构 / §4.1 项目管理 / §4.1.2 游戏化交互模型（新增 4 个 v2.0 事件）
- **AGENTS.md 索引同步**：§3 必读文档加入 ADR 0004
- **状态**：Draft（待 3 阶段实现落地：Stage 1 数据模型 → Stage 2 前端工作台切换器 → Stage 3 文件监听与即时发现）

### 2026-06-16：ADR 0003 Stage 4 fix（Settings picker + IPC 根因 + State batching）

- **streaming panic 根因找到了**：`OpenAIClient` 用 `reqwest::blocking::Client::send()`，阻塞 client 内部起独立 tokio runtime，在 Tauri 的 multi-thread tokio runtime 的 `spawn_blocking` thread 里调 `response.bytes()` 等 blocking Read API 时，body drop 触发了 "Cannot drop a runtime in a context where blocking is not allowed" panic。修复：完全切到 async `reqwest::Client` + `Handle::block_on`，SSE 解析改用 `bytes_stream()` + 手动跨 chunk 行缓冲（`leftover`），全部在已有 tokio runtime 里跑——彻底避开 blocking runtime 冲突。
- **副官无法对话的根因找到了**：capabilities 里有无效 permission 标识符（`core:allow-invoke` / `core:allow-send-event` / `core:allow-listen`），导致整个 capabilities 加载失败，所有 IPC invoke 被 deny。Tauri IPC 桥 fallback 到 HTTP (`http://ipc.localhost/ai_chat`)，后者 404 → 前端 `invoke()` 抛错 → 副官没响应。修复：capabilities 只保留有效 permission（`core:default` + `core:event:default`）。
- **模型懒验证移出 startup**：之前在 `migrate_default_state` 里用 `Handle::current().block_on()` 做网络验证，在 Tauri setup 同步 context 里 panic（no reactor running）。修复：懒验证移到 `ai_chat` 首次调用时做；但由于架构过于复杂（nested runtime + blocking），最终方案是直接去掉懒验证——`migrate_default_state` 只做 field 迁移。
- **React State batching 导致 `handleSubmit` 收到空字符串**：`handleSend` 里先 `setInput("")` 清空状态，然后调 `handleSubmit(e)`，但 `handleSubmit` 里的 `input` 闭包还是旧值。修复：`handleSubmit(text: string, e?)` 改为接受显式文本参数，`handleSend` 直接把 `input` 传入。
- **Settings「扫描频段」不走 `api.ai.listModels` 了**（之前这个路径的 `api_key`/`base_url` override 被 Rust `resolve_credentials` 完全忽略）。修复：`fetchPickerModels` 先 `add`/`update` provider（persist api_key），然后用 `api.providers.listModels(providerId)` 正确拉模型列表。
- **`submitPicker` 在扫描后不再重复 add**：用户扫完点保存，`api.providers.add` 会因为 ID 已存在报错。修复：扫描后 `submitPicker` 识别 `pickerScanTempId` 状态，改走 `api.providers.update`。
- **「设为默认」按钮现在对所有 provider 显示**（包括当前默认的）：之前对默认 provider 隐藏按钮，用户无法在 Settings 里改默认 provider 的模型。修复：所有 provider 行都显示按钮，点击弹出模型选择器。
- **`migrate_default_state` 幂等清理**：每次启动都无条件清理 `entry.model` 字段，防止旧 migration 残留导致不一致。
- **加了 `[DEBUG ai_chat]` stderr logs**：下次聊天失败时 stderr 会显示 `provider=`、`base_url=`、`model=`、`api_key_set=` 等关键信息。

### 2026-06-16：ADR 0003 Stage 3 fix v2（get_default_model snake_case + Stage 2 字段清理）

- **Bug**：用户报告 (1) 设置默认模型后副官 top bar 仍显示「未设置供应商与模型」；(2) `/switch` 与 Settings UI 设默认都失效；(3) config.json 仍有 `model` / `models` / `preset_overrides.model` 冗余字段。
- **Root cause**：
  - **(1) 致命 Bug A**：`get_default_model` Rust struct `DefaultModelState { provider_id, model_id }` 默认 serialize **snake_case**（Tauri 2 invoke return value 唔会自动 camelCase 转换，只 args 转换），但 `client.ts` 接口期望 `providerId` / `modelId`（camelCase）。wire shape mismatch → JS 端 `d.providerId` 永远 undefined → `setDefaultProviderId(null)` → UI 永远「未设置」。
  - **(2) ADR Stage 2 漏做**：Stage 1+2 之前落地时只改咗 `resolve_credentials` 同 `add` 路径初始化 default，但**冇实际移除冗余字段**——`ProviderEntry.model` / `ModelEntry.is_default` / `UpdateProvider.model` / `PresetOverride.model` 仍写入 config.json。
- **修复**：
  - **client.ts + Settings.tsx + AIChatPanel.tsx**：wire format 改 snake_case（`provider_id` / `model_id`），同 codebase 一致
  - **`ModelEntry.is_default` 字段移除**——models 不持久化，无赋值场景
  - **`PresetOverride.model` 字段移除**——被 `NovaConfig.default_model_id` 取代（ADR 0003 §6.3）
  - **`ProviderEntry.model` 加 `#[serde(default, skip_serializing_if = "String::is_empty")]`**——空字符串时唔写入 JSON；`add` 路径不再写入
  - **`ProviderEntry.models` 加 `#[serde(default, skip_serializing_if = "Vec::is_empty")]`**——空 vec 时唔写入 JSON（models 不持久化）
  - **`UpdateProvider.model` 字段移除**——update 不做 set_default（避免 silent override 当前 default）
  - **`make_preset_entry` 移除 preset_overrides.model 注入逻辑**——只读 base_url
  - **`providers::update` 移除 patch.model 处理**——base_url / api_key / label 仍可更新
  - **`migrate_default_state` 启动期清空旧 entry.model 字段**——一次性迁移，旧 config 嘅 `model: "MiniMax-M2.7"` 写到 default_*_id 后清空 entry.model
  - **`commands::settings::get_default_target` 重写**——直接读 `NovaConfig.default_*_id`，唔再依赖 entry.models[].is_default
  - **`http_server::resolve_target` 重写**——同上 + body_json.provider_id inline override 保留向后兼容
  - **Settings UI 新增 `maybeInitDefaultFromPreset` 辅助函数**——preset 路径保存后若 default 未初始化，自动 set_default（与 `add` 路径初始化语义对齐）

- **效果**：
  - `setDefault` 写入后 UI 立即同步（snake_case wire format 修复）
  - 新 config.json 不再写 `model` / `models` / `preset_overrides.model` 冗余字段；旧 config 启动期 migration 自动清空
  - 用户体验：副官默认模型设置后立刻生效，top bar 正确显示

### 2026-06-16：ADR 0003 Stage 3 fix（AIChatPanel default 同步 + 移除 inline override）

- **Bug**：用户报告副官 top bar 显示 provider 嘅 model（唔系 default 嘅 model），且对话无响应。
- **Root cause**：(1) `AIChatPanel` 嘅 `selectedId` 从未同 `NovaConfig.default_provider_id` 同步——`activeOption` 来自用户在 UI 拣嘅 supplier（独立 state），top bar 渲染用 `activeOption.{id,model}`，同 default 字段完全脱钩。(2) `useLocalAI` 传入 `overrides: { model: activeOption.model, ... }`，`chat.rs::resolve_credentials` 入面 `.unwrap_or(default_pid/mid)` 会被 inline 覆盖——用户喺 `/switch` 切咗新 model 之后 default 已更新，但 `activeOption.model` 仲系旧 entry 嘅 model 字段，inline override 把新 default 覆盖返去旧值，导致 chat 用旧 model 调上游可能 404 或 silent override 默认。
- **修复**：
  - `AIChatPanel` 新增 `defaultProviderId` / `defaultModelId` state + `refreshDefault` 回调（hydration 时 + `/switch` pick_model 后调用）
  - `useLocalAI` **不传 overrides**——让 Rust 完全走 default 路径
  - Top bar 渲染 `defaultProviderId / defaultModelId`，未设置时显示「未设置默认模型（输入 /switch 选取或去 Settings）」提示
  - 删除 `activeOption` useMemo（top bar 已不依赖，仅 `/switch` pick_provider 用 `options` map）
- **效果**：default 字段真正成为 chat 嘅唯一权威来源；top bar 显示同 chat 实际行为一致；`/switch` 切换后 UI 立即同步。

### 2026-06-16：ADR 0003 Stage 3 落地（pick-then-fetch-then-set UX）

- **ADR**：[`docs/architecture-decisions/0003-default-model.md`](docs/architecture-decisions/0003-default-model.md) §3.6 + §3.7
- **改动**：
  - `client.ts`：暴露 `api.ai.setDefault(providerId, modelId)` + `api.ai.getDefault()` API
  - 新增 `get_default_model` Tauri command（settings.rs） + `DefaultModelState` wire type
  - `AIChatPanel.tsx`：`/switch` 命令升级为两段式状态机（`closed` → `pick_provider` → `pick_model` → 关闭），pick_model 阶段实时调 `api.providers.listModels(providerId)` 拉候选，用户选 model 后调 `setDefault` 写入 default
  - `Settings.tsx`：provider row 渲染 default chip（如果 `p.id === default_provider_id`）+ 「设为默认」按钮（仅当非 default 时显示）；新增「设副官默认」Dialog——点 row 按钮触发 fetch list_models + 选 model + 调 `setDefault`；删除 default provider 时清 default state（保持 uninitialized 显式状态——Q3 决定避免 silent 切换）
  - `Settings.tsx`：导入 MUI `List` / `ListItemButton` / `ListItemText`
- **效果**：副官 `/switch` UX 完整（pick provider → fetch → pick model → set default）；Settings UI 列表显示 default chip + 提供 set default 入口。两端共享 `set_default_model` Tauri command，行为一致。
- **回退**：纯 UI 回退（Stage 3）。`/switch` 回到 broken UX（pick_provider 后冇效果），但 chat 仍 work（Stage 2 已修）。

### 2026-06-16：ADR 0003 Stage 1+2 落地（default-provider schema + resolve-credentials via default）

- **ADR**：[`docs/architecture-decisions/0003-default-model.md`](docs/architecture-decisions/0003-default-model.md)
- **改动**：
  - `NovaConfig` 加 `default_provider_id: Option<String>` + `default_model_id: Option<String>` 字段（`#[serde(default)]` 兜底旧 config.json）
  - 新增 `nova_config::migrate_default_state` 函数：启动期幂等迁移旧 `ProviderEntry.model` / `preset_overrides[family].model` 到新字段
  - 新增 `set_default_model` Tauri command（ADR 0003 §3.5）：只验证 provider 存在，model 验证推迟到 chat fallback
  - `chat.rs::resolve_credentials` 重写（ADR 0003 §3.2）：直读 default 字段，不再 ad-hoc 3-step；不再本地验证 model 是否在 entry.models（models 不持久化，避免 false negative）
  - `providers::add` 路径：default 未初始化时自动用新 entry 嘅 model 初始化；default 已存在时唔动（再次添加只验证服务，不 silent override）
  - `lib.rs`：启动期调用 `migrate_default_state`（失败 eprintln 不阻塞 app）；`set_default_model` 注册到 `invoke_handler!`
- **效果**：副官 chat 现在直读 `NovaConfig.default_*_id` 字段，不再依赖 entry 嘅 stale `model` / `models[].is_default`。Stage 3 (`/switch` UX 升级) + Stage 4 (fallback) 系增量 UX，唔阻塞 ship。
- **回退**：Stage 1 仅 schema 改动，旧 `resolve_credentials` 仍 fallback 到 ad-hoc 逻辑（但功能等价）。Stage 2 核心行为变更，回退后 fallback 到 Stage 1 嘅 boot-time migration。

### 2026-06-16：ADR 0003 Default-Model 显式状态管理（草稿）

- **ADR 草案**：[`docs/architecture-decisions/0003-default-model.md`](docs/architecture-decisions/0003-default-model.md)
- **背景**：当前「默认模型」系隐式概念，由 `ProviderEntry.models[].is_default` 推断，事实状态散布于三个字段，造成 preset model 唔持久化、user entry `models: []` 永远空、`/switch` UX broken、Settings UI 冇 set default 交互、default 失效冇 fallback 等一系列问题。**修订（2026-06-16 v2）**：持久化 supplier 嘅 model 列表本身系反模式——供应商随时变动 model，本地缓存会 stale。改为 `ProviderEntry.models` 运行时字段（`#[serde(skip)]`），每次需要时实时调 `list_models` API 拉取。
- **决策**：NovaConfig 加 `default_provider_id` + `default_model_id` 显式字段；`resolve_credentials` 改为直读呢两个字段（不做 model 本地验证，404 由 fallback 兜底）；`set_default_model` 作为单一权威入口；三段式状态机 `uninitialized` → `initialized` → `stale`；启动期 migration 兜底旧 config.json。
- **字段清理**：Stage 1 保留 `ProviderEntry.model` + `ModelEntry.is_default` 向后兼容（旧 config.json migration 需要）；Stage 2 彻底移除。`UpdateProvider.model` Stage 1 保留（frontend picker 仍传），Stage 3 移除。
- **实施计划**：4 个独立 stage commit（schema/migration → resolve 重构 → UX 升级 → fallback），按依赖顺序，每个 stage 独立 ship + 可回退。
- **状态**：🟡 Draft，已采纳「model 列表不持久化」原则（v2），待拣实施范围。当前 2026-06-16 加嘅 `preset_overrides.model` 字段系临时过渡，Stage 1 之后废弃。

### 2026-06-16：副官 chat 真正未处理文本消息（preset model 未持久化）

- **Bug**：用 OpenAI / Anthropic preset（`mode=preset`）配置嘅副官链路，发送消息时无反应；OpenAI 兼容 / Anthropic 兼容 / Ollama user path 正常。
- **Root cause**：`providers::update` 嘅 preset 分支**只写 secret 去 `~/.nova/config.json::provider_secrets`，`model` 字段只 set 喺 in-memory 变量，完全冇落盘**。下次 `list_all` 调 `make_preset_entry("openai")` 构造 entry，`model = ""`、`models = Vec::new()`。链路：`AIChatPanel` 拎到 `activeOption.model = ""` → 传 `overrides: { model: "" }` 畀 Rust → `resolve_credentials` step 2 `!entry.model.is_empty()` fail + step 3 inline override model 被 filter 掉 → `target.model.trim().is_empty()` → `Err("no default model configured — open Settings and mark a model as default")` → invoke reject。错误文案讲「未配默认 model」误导 user（实际配咗但冇 persist）。
- **修复**：`NovaConfig` 加 `preset_overrides: BTreeMap<String, PresetOverride>` 字段（preset id → `{model, base_url}`）。`update` 嘅 preset 路径写入 `preset_overrides`；`make_preset_entry` 读呢个 map 把 model 注入到 `entry.models`（`is_default=true` 形式）—— `resolve_credentials` step 1 嘅 `models.iter().any(|m| m.is_default)` 搵默认路径直接生效。User path（`add_provider` 走 `providers` 数组）行为不变。Base URL 也 persist，forward-compat Ollama 嘅 `baseUrlEditable: true` preset 场景。

### 2026-06-16：http_server 启动 panic 修复

- **Bug**：Windows 启动 Nova 时后台日志 panic：`tokio-rt-worker panicked at src\http_server\mod.rs:465:63: called Result::unwrap() on an Err value: Os { code: 10013, kind: PermissionDenied }`。
- **Root cause**：(1) `tokio::net::TcpListener::bind("0.0.0.0:{port}")` 喺 Windows 上触发 `WSAEACCES` (10013)——`0.0.0.0` 意味着 listen 所有 interface，Windows Defender Firewall 喺 bind 阶段就可能拒绝。但 ADR 0002 §4 已经明文讲 server 用途系「外部客户端走 `localhost`」，根本唔需要 0.0.0.0。(2) `unwrap()` 让任何 socket 错误（端口占用、Hyper-V 动态端口保留）直接 panic tokio worker，外部根本睇唔到真正原因。
- **修复**：`0.0.0.0` → `127.0.0.1`（loopback only，符合设计意图）；`bind`/`serve` 嘅 `unwrap()` 改为 eprintln + 优雅 return，唔再 panic tokio worker。Bind 失败时控制台打印 `kind()` 方便诊断（`PermissionDenied` vs `AddrInUse` 等）。

### 2026-06-16：副官输入 state 同步修复

- **Bug**：AIChatPanel 给「副官」发送消息时无反应，文本内容从未送至 Rust 端。
- **Root cause**：`AIChatPanel` 与 `useLocalAI` hook 各持一份 `input` state。`TextField` `onChange` 只 set panel 自己嘅 state；hook 嘅 `handleSubmit` 只读 hook 自己嘅 input（永远空字符串），`sendMessage` guard `if (!text.trim()) return;` 直接 return，invoke 从未触发。系 ADR 0002 改造 IPC 流式时遗留嘅 state 同步问题——之前 hook 可能直接收 `text`，改造后接管 input 但 UI 端冇人 sync。
- **修复**：`useLocalAI` 暴露 `setInput`；`AIChatPanel` `onChange` 同时设两份 state；`handleSend` 提交后清空两份 state。最小改动，未引入新抽象。

### 2026-06-15：命题 A 落地（chat IPC 流式）

- **架构**：Nova webview ↔ Rust chat 通讯从 HTTP fetch + SSE wire 解析改为 **Tauri 2 IPC + `tauri::ipc::Channel<ChatEvent>` 流式**。详见 [ADR 0002](docs/architecture-decisions/0002-chat-ipc-streaming.md)。
- **Provider 抽象**：`LLMClient` trait 加 `chat_stream` 默认实现 + 4 family 各自 override 真 SSE 转发（OpenAI 标准 SSE / Anthropic event-based SSE / Ollama NDJSON / Custom 路由到对应 client）。
- **http_server 收紧**：内部 `/v1/chat/completions` 路由**保留**作外部 OpenAI 兼容客户端入口（`/health` 同样保留）。`nova_port` 配置保留作 MCP 未来用。
- **删除**：`test_ai_provider` Tauri command（冗余，list_models 已隐式验证）。
- **硬编码清理**：`ANTHROPIC_MODELS` 11 条硬编码删除，改为 `GET /v1/models` 实时拉取。**所有 4 provider 嘅 list_models 都走 API**。
- **代码注释统一简体中文**：全项目 19 个 Rust 文件 + 14 个 TS/TSX 文件嘅 doc comment 翻译为简体中文，技术专名保留英文。详见 [约定 001](docs/conventions/001-comments-zh-CN.md)。
- **NovaOutOfBoundsGate dev 旁路**：加 `?preview-gate` URL 参数强制渲染拦截页，方便 vite preview 调试。

### 2026-06-13：v1.0 初版

- Nova webview 初版：星图 Dashboard + 项目编辑 + AI 对话（HTTP fetch）+ Settings
- Provider 注册表（4 provider + preset/user 双层）
- 6 个 template id 全部 fall back 到 blog 兜底
- NovaOutOfBoundsGate 生产期顶层拦截

---

## 12. 文档结构

```
docs/
├── game-design.md          # 游戏化视觉与交互规范
├── design-tokens.md        # 设计 token 文档
├── conventions/
│   └── 001-comments-zh-CN.md    # 代码注释简体中文约定
└── architecture-decisions/
    ├── 0001-provider-system.md        # Provider 系统设计（Accepted）
    ├── 0002-chat-ipc-streaming.md      # Chat IPC 流式架构（Accepted）
    ├── 0003-default-model.md          # Default-Model 显式状态管理（Draft，Stage 1+2+3+4 落地）
    └── 0004-workspace-system.md       # v2.0 工作台系统与文件集成（Draft，2026-06-17）
```

AI 协作者必读 [`AGENTS.md`](AGENTS.md)。
