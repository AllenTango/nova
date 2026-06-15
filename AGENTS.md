# AGENTS.md — Nova 项目 AI 协作者约定

> **目标读者**：小芽（默认 profile）、opencode、任何接入 Nova 项目的 AI 协作者。
> **生效时机**：每次会话开始时自动加载（与 `CLAUDE.md` / `AGENTS.md` 注入同等优先级）。
> **更新规则**：本文件改动需配套更新 `PLAN.md` §12 文档结构。

---

## 1. 你是谁

你是 Nova 项目嘅 AI 协作者。Nova 是一款**面向普通人与 AI Agent 嘅桌面建站工具**——用户用管理 Markdown 笔记嘅方式创建项目，之后按需点亮为 Astro 站点。交互采用"星系建造游戏"隐喻：项目是星，笔记是星胚，站点是恒星，部署是信标发射。

---

## 2. 项目速览

| 项 | 值 |
|---|---|
| **核心** | Tauri 2 桌面应用（Rust backend + React frontend） |
| **站点引擎** | Astro（核心，不可替换） |
| **数据** | SQLite 元数据 + 文件系统内容（统一配置 `~/.nova/config.json`） |
| **内部通讯** | Tauri 2 IPC + `tauri::ipc::Channel<T>` 流式（v1.x） |
| **外部通讯** | OpenAI 兼容 HTTP `/v1/chat/completions`（v1.x）+ MCP `/mcp`（v2.x） |
| **AI 凭据** | `~/.nova/config.json::provider_secrets` 唯一来源，**不读环境变量** |
| **Provider** | 4 个：OpenAI / Anthropic / Google Gemini / Ollama，全部走 `list_models` API |

详细架构见 [`PLAN.md`](PLAN.md)，游戏化规范见 [`docs/game-design.md`](docs/game-design.md)，设计 token 见 [`docs/design-tokens.md`](docs/design-tokens.md)。

---

## 3. 必读文档（按优先级）

1. **本文件** `AGENTS.md` —— 总入口
2. **[`PLAN.md`](PLAN.md)** —— 整体方案 + 现状
3. **[`docs/conventions/001-comments-zh-CN.md`](docs/conventions/001-comments-zh-CN.md)** —— **代码注释统一简体中文**（必读）
4. **[`docs/architecture-decisions/0002-chat-ipc-streaming.md`](docs/architecture-decisions/0002-chat-ipc-streaming.md)** —— Chat IPC 流式架构
5. **[`docs/architecture-decisions/0001-provider-system.md`](docs/architecture-decisions/0001-provider-system.md)** —— Provider 系统设计
6. **[`docs/game-design.md`](docs/game-design.md)** —— 游戏化视觉与交互（涉及 UI 改动必读）

---

## 4. 核心约束（不可违反）

### 4.1 Nova webview **只在 Tauri 内运行**

- 30+ 个 `#[tauri::command]` 是 webview ↔ Rust 唯一通道
- `NovaOutOfBoundsGate` 生产期顶层拦截外部浏览器
- 任何新功能**默认走 Tauri IPC**，不要走 HTTP / WebSocket / 其它跨进程通道（除非有明确外部需求）

### 4.2 凭据**只从 `~/.nova/config.json` 读**

- `ProviderFactory::create_client(provider, explicit_api_key, explicit_base_url)` 只接受显式参数
- **不读环境变量**（`OPENAI_API_KEY` 等），即使 shell 设了 Nova 也忽略
- Settings UI 是凭据唯一入口

### 4.3 代码注释**统一简体中文**

详见 [`docs/conventions/001-comments-zh-CN.md`](docs/conventions/001-comments-zh-CN.md)：

- doc comment (`///` Rust / `/** */` TS) + inline comment (`//`) **全部简体中文**
- 保留英文嘅合法场景：Tauri / Web / HTTP API / 协议 / 项目内部命名 / CSS token / crate 名 / 类型 / 品牌
- 反模式：机翻直出（保留英文句法）、半中半英（夹杂完整英文 sentence）

### 4.4 游戏化不能牺牲工具效率

- 日常启动不播放完整开场，直接进星图
- 首次启动开场仪式 ≤ 1.2 秒
- 编辑打字期间禁止持续 canvas 动效干扰
- 星图低帧率、低密度、tab 隐藏暂停
- 成就/彩蛋只在关键里程碑触发

### 4.5 模板 fallback 行为

- 6 个 template id（`blog` / `gallery` / `vlog` / `blog-gallery` / `corporate` / `agent-home`）**全部 fall back 到 blog**
- 行业常态但 UX 应清楚（Settings/创建向导要让用户知道）

---

## 5. 推荐工作流

### 5.1 改代码前

1. 读相关 ADR（如改 chat → 读 0002；改 provider → 读 0001）
2. 读涉及文件嘅 doc comment 顶部（已系简体中文，会话内直接吸收）
3. 跑 `cargo check` + `npx tsc --noEmit` 确认基线干净

### 5.2 改代码时

1. **先看死代码范围**——接到「删除/移走 X」任务时，先 `search_files` 判定依赖再 patch
2. **保留技术专名英文**——Tauri / Channel / invoke / SSE / MCP / reqwest 等不要翻译
3. **新增/改动时同步注释**——doc comment 一齐改成简中
4. **验证编译**——`cargo check`（Rust 端）+ `npx tsc --noEmit`（TS 端）

### 5.3 改完后

1. `cargo check` + `npx tsc --noEmit` 必须干净
2. 如果涉及 ADR 范围 → 考虑更新对应 ADR
3. 关键改动 → `git commit`（commit message 推荐中文，**不强求**）

### 5.4 处理用户反馈

- 用户风格：粤语风格中文，技术深度派，要代码实证
- 决策风格：助手给 ABCD 选项 + 强烈推荐，用户拣选项驱动
- 不要问"应否做"——直接做

---

## 6. 文档维护

| 改动类型 | 更新啥 |
|---|---|
| 架构决策（如 chat 改 IPC） | 新建 `docs/architecture-decisions/NNNN-{slug}.md` + PLAN.md §11 changelog |
| 新增约定（如注释规则） | `docs/conventions/NNN-{slug}.md` + AGENTS.md §3 索引 |
| UI 交互改动 | 检查 `docs/game-design.md` 同步 |
| 删/移走代码块 | 先 `search_files` 判定死代码，再 `git rm` + 更新 PLAN.md §10 关键文件清单 |
| README/PLAN 章节更新 | PLAN.md §12 文档结构 + README.md 文档表格 |

---

## 7. 拣选项驱动决策

Nova 习惯用 ABCD 选项 + 推荐意见引导决策：

- **A**：维持现状（最小改动）
- **B**：激进重写（最高 ROI）
- **C**：写 ADR 文档化
- **D/E...**：其它具体选项

**用户拣** → 落手。**不拣** → 维持现状。

---

## 8. 不适用

- 第三方库代码（`node_modules/`、`Cargo` 依赖源码）—— 不改
- 公开 API 文档（OpenAPI / JSON Schema）—— 遵循上游协议
- 用户面向嘅英文文案（UI 文案、邮件、README）—— 按产品决策
- 模板内容（`templates/blog/src/content/posts/*.md`）—— 用户可改

---

## 9. 快速验证命令

```bash
# Rust 端编译
cd src-tauri && cargo check

# TS 端类型
cd .. && npx tsc --noEmit

# 当前 working tree 状态
git status

# 注释残留英文扫描（启发式）
# 不存在的 lint rule——手动用 search_files 复查
```
