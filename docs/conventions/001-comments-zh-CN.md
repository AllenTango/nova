# 约定 001：代码注释统一简体中文

> 状态：✅ 已落地 | 范围：Nova 全项目（`src/` + `src-tauri/src/`）| 落地日期：2026-06-15

## 1. 背景

Nova 嘅代码库早期由英文 doc comment 主导（开源项目典型模式），但团队主要用粤语风格中文交流，文档、设计稿、commit message、issue 全部中文。新成员睇代码时经常要「译」英文注释才能跟上意图。

随着 Nova 进入**产品化阶段**（v1.x），需要让：

- **新成员 onboarding** 速度从「读懂英文 + 译成中文」→ 直接读中文
- **AI 协作者**（小芽 / opencode）嘅 patch 唔再产生「中英混排」嘅不一致
- **未来写中文 issue / 设计文档** 嘅术语与代码注释对得上

## 2. 约定

**所有代码注释（doc comment + inline comment）使用简体中文。**

### 2.1 保留英文嘅合法场景

以下**技术专名**保留英文系合理嘅，**唔需要翻译**：

| 类别 | 示例 |
|---|---|
| **Tauri / IPC / 框架专名** | `Tauri webview`、`invoke`、`Channel`、`__TAURI_INTERNALS__` |
| **Web / 浏览器 API** | `fetch`、`SSE`、`WebSocket`、`innerHTML` |
| **HTTP 协议** | `Authorization header`、`Content-Type`、`Bearer` |
| **协议 / 标准** | `OpenAI compatible API`、`MCP`（Model Context Protocol） |
| **项目内部命名** | `nova_intro`、`Starfield`、`star_mass` |
| **CSS / 设计 token 名** | `TYPE.body`、`T.dark.nova`、`sx={{}}` |
| **库 / crate 名** | `reqwest`、`serde`、`axum`、`tokio` |
| **标准库 / 类型** | `Result`、`String`、`Arc<Mutex<>>` |
| **公司 / 产品 / 品牌** | `Nova`、`AllenTango` |

### 2.2 应该翻译嘅

- 句子主干（「为什么这样设计」「何时用何时不用」）
- 动词、介词（「创建」「删除」「调用」「解析」）
- 普通概念（「用户」「项目」「文件」「密钥」）

### 2.3 翻译粒度参考

| 英文 | 简体中文 |
|---|---|
| `/// Detect whether the app is running inside a Tauri webview.` | `/// 检测 app 是否运行在 Tauri webview 里。` |
| `/// Manages the theme mode (dark/light) and persists it to the backend.` | `/// 管理主题模式（dark/light）并持久化到后端。` |
| `// 1. Verify session token` | `// 1. 校验 session token` |
| `// Wrap Database in Arc<Mutex<>> for thread-safe shared access` | `// 把 Database 包进 Arc<Mutex<>>，支持多线程共享访问` |

## 3. 不适用

以下情况**唔适用**呢条约定：

1. **第三方库**代码（`node_modules/`、`Cargo` dependencies 嘅 `.rs` 源码）——唔改
2. **公开 API 文档**（OpenAPI / JSON Schema）——遵循上游协议
3. **用户面向嘅英文文案**（UI 文案、邮件、README）——按产品决策
4. **git commit message** —— 已有独立约定（推荐中文，但不强求）

## 4. 落地执行

**2026-06-15** 一次性清理：

- `src-tauri/src/provider/*.rs`（4 个 impl + mod + config）—— 全重写
- `src-tauri/src/commands/*.rs`（5 个文件）—— 全部 doc 块
- `src-tauri/src/nova_config.rs` / `db/mod.rs` / `templates.rs` / `mcp/mod.rs` / `providers/mod.rs` / `lib.rs` / `main.rs` / `http_server/mod.rs`
- `src/theme/tokens.ts`（15 块全重写）
- `src/lib/words.ts`（5 块）
- `src/lib/starmap-layout.ts`（4 块）
- 其余 11 个 TS/TSX 文件嘅独立 doc 块

## 5. 工具与审核

- **PR / commit review**：发现遗漏嘅英文 doc 块应该 block，要求补翻
- **CI 兜底**（**未来**）：可以加一个 lint 规则扫 `///` / `/**` / `//` 后面嘅英文单词长度（启发式），但**避免 false positive**（技术专名难判）
- **AI 协作者约定**（小芽 / opencode）：落 `nova-config.md` 或 `AGENTS.md` 提醒

## 6. 反模式

❌ **机翻直出**（保留英文句法结构）：

```ts
/**
 * The word count is the *new* number the user can watch grow
 * — the primary way a writer feels progress in a notes app.
 */
```

✅ **意译 + 保留技术专名**：

```ts
/**
 * 字数是用户能看着增长嘅*新*数字——写手在笔记 app 里感受进度
 * 嘅主要方式。
 */
```

❌ **半中半英**（注释行中夹杂完整英文 sentence）：

```ts
// We mirror the opencode model: providers live outside SQLite
// so adding or removing one is a single file edit.
```

✅ **整段中文**：

```ts
// 镜像 opencode 模型：providers 放在 SQLite 之外，
// 增删一个 provider 改一个文件就够。
```

## 7. 关联

- `docs/game-design.md` —— 项目设计语言本身已系中文
- `docs/design-tokens.md` —— 设计 token 文档已系中文
- `AGENTS.md`（**未来**）—— AI 协作者约定
- `~/.hermes/agents/` —— 任何 AI 启动时都应该收到呢条约定
