# ADR 0003: Default-Model 显式状态管理

> **Status**: 🟡 Draft | **Date**: 2026-06-16 | **Scope**: `src-tauri/src/nova_config.rs` + `src-tauri/src/providers/` + `src-tauri/src/commands/chat.rs` + `src-tauri/src/commands/settings.rs` + `src/components/AIChatPanel.tsx` + `src/pages/Settings.tsx`
>
> 关联：
> - [ADR 0001](0001-provider-system.md) — Provider 系统设计
> - [ADR 0002](0002-chat-ipc-streaming.md) — Chat IPC 流式架构
> - 提案代码：2026-06-16 修复 preset model 持久化时引入嘅 `preset_overrides` map 是临时过渡方案（[PLAN §11](../PLAN.md)），本 ADR 用显式 default 字段取代之。

## 1. 背景

Nova 当前嘅「默认模型」概念是**隐式嘅**，由 `ProviderEntry.models` vec 入面嘅 `is_default: true` 标记推断。四个具体痛点：

### 1.1 preset 路径 model 唔持久化（已 transient 修复）

`providers::update` 嘅 preset 分支只写 `provider_secrets`，`model` 只 set 喺 in-memory 变量。2026-06-16 加咗 `preset_overrides` map 临时救火，但呢个系**过渡方案**——继续叠加 schema 字段会失控。

### 1.2 user entry 嘅 `models: Vec<ModelEntry>` 永远空

`providers::add` 写入 user entry 时只 set `model: String`（单 model 字段），`models` vec 留空。`chat.rs` 嘅 `resolve_credentials` step 1 用 `models.iter().any(|m| m.is_default)` 搵 default，**user entry 永远唔命中**——只能靠 step 2/3 inline override 救，但要求 frontend 每次都传 `model`。

### 1.3 副官 `/switch` UX broken

`AIChatPanel.maybeHandleCommand` 入面 `/switch` 只 `setShowSwitcher(true)`，用户拣完 supplier 只 `setSelectedId(...)`，**冇落到 fetch model + set default**。等于「有 picker 冇效果」。

### 1.4 Settings UI 冇 set default 交互

`Settings.tsx` 列表只 render label / source / base_url / model，冇任何「设为默认」按钮或 row-level 交互。

### 1.5 Default model 失效冇 fallback

`chat_stream` 收到上游 404（model 不存在 / 已下线）时，error 直接透传给 frontend，用户睇到 error 后必须手动操作。换 default model 系高频操作，**应该自动化**。

### 1.6 冇显式 schema 字段

「默认模型」嘅事实状态散布于：`ProviderEntry.model` 字段、`ProviderEntry.models[].is_default`、`preset_overrides[id].model` 三处。冇单一 source of truth → 各种 race、ad-hoc 逻辑层出不穷。

### 1.7 持久化供应商 model 列表系反模式

设计初期考虑过「add provider 时拉一次 model list 缓存落 entry.models」。呢个系**反模式**：
- 供应商随时发布新 model / 下线旧 model / rename → 本地缓存 stale
- Stale 缓存会误导「副官默认模型仲有效」嘅判断
- 引入 cache invalidation 复杂度（同 DNS cache 同类问题）
- 唯一 fresh 来源系供应商 `list_models` API

正确做法：**`ProviderEntry.models` 改为运行时字段（`#[serde(skip)]`）**，需要时由调用方主动 fetch。Default 状态由 NovaConfig 顶层字段权威持有。**本 ADR 已采纳此原则（详见 §3.1.2）**。

## 2. 决策

**NovaConfig 加两个显式字段**：

```rust
pub struct NovaConfig {
    pub nova_port: u16,
    pub preview_port: u16,
    pub theme: String,
    pub providers: Vec<ProviderEntry>,
    pub provider_secrets: BTreeMap<String, String>,
    pub preset_overrides: BTreeMap<String, PresetOverride>,
    /// 全局默认链路嘅 provider id。`None` 即未初始化。
    #[serde(default)]
    pub default_provider_id: Option<String>,
    /// 全局默认链路嘅 model id。`None` 即未初始化。
    #[serde(default)]
    pub default_model_id: Option<String>,
}
```

**所有 chat 路径嘅 default 来源都改为读这两个字段**。`ProviderEntry.model` Stage 1 保留（向后兼容），Stage 2 移除；`ModelEntry.is_default` 字段 Stage 1 保留，Stage 2 移除——**两者皆非 default 嘅权威来源**。

新 Tauri command：`set_default_model(provider_id: String, model_id: String)`——单一权威入口更新 default。

## 3. 新架构

### 3.1 Schema 改动

#### 3.1.1 NovaConfig

新增字段（详见 §2）。`#[serde(default)]` 兜底旧 config.json 无呢两 key 嘅情况。

#### 3.1.2 ProviderEntry 行为统一：**model 列表不持久化**

**核心原则**：供应商嘅 model 列表系**动态**嘅（随时发布 / 下线），持久化会引入 stale data + sync 问题。**所有 model 列表都通过 `ProviderFactory::list_models` API 实时拉取**。

```rust
pub struct ProviderEntry {
    pub id: String,
    pub label: String,
    pub family: String,
    pub base_url_editable: bool,
    pub api_key_required: bool,
    pub kind: FamilyKind,
    pub base_url: String,
    /// 运行时字段：从 `ProviderFactory::list_models` 实时拉取。
    /// 不持久化（供应商 model 随时变动，本地缓存会 stale），
    /// 每次需要时由调用方主动 fetch 注入。
    #[serde(skip, default)]
    pub models: Vec<ModelEntry>,
    pub source: ProviderSource,
}

pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub label: String,
    // is_default 字段移除——models 不持久化，is_default 无意义；
    // default 嘅权威来源是 NovaConfig.default_provider_id / default_model_id
}
```

**字段清理清单**（按 stage 分阶段清理）：

| 字段 | Stage 1 | Stage 2 | 原因 |
|---|---|---|---|
| `ProviderEntry.model: String` | **保留**（向后兼容旧 config.json；migration 读取此字段填 default） | **移除** | 重复 default_model_id；Stage 2 之后不再需要 |
| `ProviderEntry.models: Vec<ModelEntry>` | **`#[serde(skip)]`**（不持久化） | 同左 | 运行时字段，`list_all` 不填充 |
| `ModelEntry.is_default` | **保留**（无害，向后兼容） | **移除** | models 不持久化，无赋值场景 |
| `NewProvider.model: String` | **保留**（不写入 entry） | 同左 | add 时用户选定 model，仅用作首次 set_default 输入 |
| `UpdateProvider.model: String` | **保留**（Stage 1 仍可接受但不再写入 entry） | **移除** | update 不做 set_default；改 default 走 `set_default_model` command |
| `PresetOverride.model` | **维持废弃** | 同左 | 2026-06-16 修复已声明，Stage 1 migration 时清空 |

**Stage 拆分原因**：
- Stage 1 不能立即移除 `ProviderEntry.model`，否则旧 config.json（你当前嘅 `MiniMax` entry）嘅 migration 路径失依归——需要读旧 `model: String` 字段填 `default_model_id`
- Stage 2 之后所有 entry 都已迁移，新字段权威建立，旧字段可安全清除
- `UpdateProvider.model` 保留 Stage 1 系因为 frontend add dialog 仍然传呢个字段（`pickerSelectedModel`），Stage 3 UI 改造后再清除

#### 3.1.3 PresetOverride 保留

`preset_overrides` map 保留作为 **base_url 持久化**。`model` 字段**废弃**（Stage 1 之后改用 `default_model_id`）。Stage 1 migration 时一次性将 `preset_overrides[family].model` 提到 `default_model_id`（如适用）。

### 3.2 `resolve_credentials` 重构

**当前**（chat.rs line 50-114）三步 ad-hoc 逻辑 → 改为**直读 default 字段**：

```rust
fn resolve_credentials(
    app: &tauri::AppHandle,
    overrides: Option<&ChatOverrides>,
) -> Result<ResolvedTarget, String> {
    // Stage 1+：default 字段系权威来源
    let config = nova_config::read_config(app);
    let (default_pid, default_mid) = match (
        config.default_provider_id.as_deref(),
        config.default_model_id.as_deref(),
    ) {
        (Some(p), Some(m)) => (p, m),
        _ => {
            return Err(
                "default model 未配置——open Settings 添加供应商时选定模型即自动设为默认".into(),
            );
        }
    };

    // Inline overrides 仅作 debug / test 用，生产路径用 default
    let pid = overrides
        .and_then(|o| o.provider_id.as_deref())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_pid);
    let mid = overrides
        .and_then(|o| o.model.as_deref())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_mid);

    // 搵 entry（preset 或 user）
    let list = providers::list_all(app)?;
    let entry = list
        .iter()
        .find(|p| p.id == pid)
        .ok_or_else(|| format!("default provider not found: {pid}"))?;

    // 不本地验证 model 是否在 entry.models —— models 不持久化，
    // 本地检查会因供应商 model 变动（发布/下线/重命名）出现 false negative。
    // 上游 chat 收到无效 model_id 时会返 4xx，由 Stage 4 fallback 处理。

    Ok(ResolvedTarget {
        provider: entry.family.clone(),
        api_key: config.provider_secrets.get(pid).cloned(),
        base_url: Some(entry.base_url.clone()),
        model: mid.to_string(),
    })
}
```

**ad-hoc step 1 (`models.iter().any(|m| m.is_default)`) 永久退役**。`is_default` 字段删除（不再有用例）。

### 3.3 `add` 路径初始化 default

`providers::add` 行为变更：

```rust
pub fn add(app: &tauri::AppHandle, new: NewProvider) -> Result<ProviderEntry, String> {
    // ... existing validation ...
    providers.push(entry.clone());
    nova_config::write_providers(app, &providers)?;
    if !new.api_key.is_empty() {
        nova_config::write_secret(app, &id, &new.api_key)?;
    }

    // Stage 2：若 default 未初始化，自动 set 新 entry 为 default
    let mut config = nova_config::read_config(app);
    if config.default_provider_id.is_none() {
        config.default_provider_id = Some(id.clone());
        config.default_model_id = Some(new.model.clone());
        nova_config::write_config(app, &config)?;
    }

    Ok(entry)
}
```

**再次添加**（`default_provider_id` 已存在）：**唔动 default**，仅落 entry 到 `providers` 数组 + 写 secret。User 用「再次添加其他供应商选定模型」做嘅系**服务连通性验证**，唔应该 silent override default。

### 3.4 `update` 路径：唔动 default

`providers::update` **唔修改** `default_provider_id` / `default_model_id`。set default 系用户显式操作，必须通过新 `set_default_model` 命令。

### 3.5 新 Tauri command `set_default_model`

```rust
#[tauri::command]
pub async fn set_default_model(
    app: tauri::AppHandle,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    let mut config = nova_config::read_config(&app);

    // Validate provider 存在（model 唔本地验证——见下）
    let list = providers::list_all(&app)?;
    list.iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("provider not found: {provider_id}"))?;

    // model_id 唔本地验证：models 不持久化，无法本地校验；
    // 上游错误由 Stage 4 fallback 兜底。
    // 这里只 set 字段。如果 model_id 已被供应商下线，下一次 chat 会
    // 触发 fallback 自动换 default。

    config.default_provider_id = Some(provider_id);
    config.default_model_id = Some(model_id);
    nova_config::write_config(&app, &config)?;
    Ok(())
}
```

`/switch` 同 Settings UI 共用呢个命令。**model 验证推迟到 chat 阶段**——避免「本地检查过咗但上游 404」嘅 stale-cache 问题。

### 3.6 副官 `/switch` 两段式

**当前**：`/switch` → showSwitcher → 用户拣 provider → setSelectedId → 完（**冇效果**）。

**新**：

```ts
type SwitcherStep =
  | { kind: "closed" }
  | { kind: "pick_provider" }
  | { kind: "pick_model"; providerId: string; models: string[]; loading: boolean }
  | { kind: "error"; message: string };
```

交互流：
1. 用户输入 `/switch`（或 `/providers`）→ `step = { kind: "pick_provider" }`
2. UI 渲染 `providers.list()` 结果作为 provider id 列表
3. 用户选 provider → `setStep({ kind: "pick_model", providerId, models: [], loading: true })` → **实时调 `api.providers.listModels(providerId)`** 拉候选（不读本地缓存）
4. UI 渲染 models 列表（loading / error / empty / items）
5. 用户选 model → 调 `api.ai.setDefault({ provider_id, model_id })` → 关 switcher → 提示「副官已切换到 XXX」

### 3.7 Settings UI 列表同步

`Settings.tsx` 列表交互升级：

| 元素 | 当前 | 新 |
|---|---|---|
| Row 渲染 | label / source / base_url | 同左 + `default` 角标（如果 `p.id === default_provider_id`）；**不显示 model**（model 需 fetch 才有，加载成本不值） |
| 行操作 | 删除按钮 | 同左 + 「设为默认」按钮（仅当 `p.id !== default_provider_id`） |
| 「设为默认」行为 | — | 调 `set_default_model` 命令，写 default 字段 + UI 重渲染 |
| 当前 default row | — | 「副官默认」chip + 「切换」按钮（开 `/switch` 同一交互）；hover 显示 `default_model_id` |
| 「添加供应商」对话框 | 选 model 后保存 | 选 model 后：① add provider entry；② 若 default 未初始化，调 `set_default_model` 初始化 default |

Settings UI 同 `/switch` **共享** set_default 路径（同 Tauri command），保证两端行为一致。

**Model 列表获取策略**：
- Settings 页 / `/switch` 打开时**实时**调 `list_models(provider_id)`，不缓存
- Row 唔预先 fetch（避免 N providers × N 模型嘅 cold start 成本）
- 「设为默认」对话框先 fetch 再 set，保证 user 拣嘅 model 实时有效

## 4. 状态机

```
                       ┌──────────────────────────────┐
                       │                              │
                       │                              ▼
   [启动] ──migrate──> uninitialized ──add first provider──> initialized
                          │                                  │
                          │                                  ├── /switch pick ─> initialized
                          │                                  ├── chat 404 fallback ─> initialized
                          │                                  │
                          │                                  └── provider deleted ─> uninitialized
                          │
                          └── 启动迁移：detect 到 user/preset 有 valid model 但无 default ─> initialized
```

**`uninitialized`**：`default_provider_id` 或 `default_model_id` 为 None → chat 命令返 `Err("default model 未配置")`，UI 提示引导添加供应商。

**`initialized`**：两个字段都存在 → chat 正常走 default 路径。**注**：模型是否仍 valid 系上游问题，本地无 cache → 错误由 Stage 4 fallback 兜底。

**`stale`（内部状态，唔持久化）**：default 嘅 provider 或 model 已失效（provider entry 删除 / 上游 404） → 触发 fallback（Stage 4）或 error。

## 5. 迁移策略

### 5.1 启动期 migration

新增 `nova_config::migrate_default_state` 函数，启动期调用一次：

```rust
pub fn migrate_default_state(config: &mut NovaConfig) {
    if config.default_provider_id.is_some() {
        return; // 已迁移
    }

    // 优先级 1：user providers 入面有 model 嘅第一个
    if let Some(p) = config.providers.iter().find(|p| !p.model.is_empty()) {
        config.default_provider_id = Some(p.id.clone());
        config.default_model_id = Some(p.model.clone());
        return;
    }

    // 优先级 2：preset_overrides 入面有 model 嘅第一个
    if let Some((id, mid)) = config.preset_overrides.iter()
        .find_map(|(id, ov)| ov.model.clone().map(|m| (id.clone(), m)))
    {
        config.default_provider_id = Some(id);
        config.default_model_id = Some(mid);
        // 注意：Stage 1 之后 preset_overrides.model 字段废弃，
        // 之后 migration 唔再睇呢度。
    }
}
```

调用位置：`lib.rs::run` 嘅 setup 阶段，或每次 `read_config` 后立即 migrate。**幂等**——重复调用安全。

### 5.2 用户当前 config.json（user case）

```json
{
  "providers": [{
    "id": "MiniMax",
    "model": "MiniMax-M2.7",
    "models": [],
    "source": "user",
    ...
  }],
  "provider_secrets": { "MiniMax": "APIKEY" },
  "preset_overrides": {}
}
```

迁移后：

```json
{
  "providers": [{
    "id": "MiniMax",
    "model": "MiniMax-M2.7",
    "models": [{ "id": "MiniMax-M2.7", "is_default": true }],
    "source": "user",
    ...
  }],
  "provider_secrets": { "MiniMax": "APIKEY" },
  "preset_overrides": {},
  "default_provider_id": "MiniMax",
  "default_model_id": "MiniMax-M2.7"
}
```

**用户无需手动操作**，启动 Nova 时自动迁移。

### 5.3 向后兼容

- 旧 `config.json` 缺 `default_provider_id` / `default_model_id` 字段 → `#[serde(default)]` 兜底为 None，migration 自动填充
- 旧 `preset_overrides[id].model` 字段 → Stage 1 期间仍可用（提供迁移路径），Stage 2 之后 read 路径忽略，仅 base_url 用途保留
- 已存在 user entry 嘅 `models: []` / `model: "MiniMax-M2.7"` → **Stage 1 期间保留 `model: String` 字段**用于向后兼容（migration 读取填 `default_model_id`）；Stage 2 时彻底移除 `model` 字段（届时所有 entry 都已迁移，新 entry 嘅 model 信息住喺 NovaConfig 顶层）
- 已存在 user entry 嘅 `models: []`（空 vec）→ 不再被任何代码路径写入 `is_default` 标记（§3.1.2 清理）；保留 vec 字段供 runtime 注入

## 6. 与现有 ADR 关系

### 6.1 ADR 0001（Provider System）

- **`ProviderFactory::create_client` 不变**——仍然只收 `(provider, api_key, base_url)`
- **`LLMClient` trait 不变**——chat_stream 默认实现保留
- **`PROVIDER_REGISTRY` 不变**——preset 元数据静态保留
- 改动仅限 `providers::list_all` / `add` / `update` / `make_preset_entry` 内部行为

### 6.2 ADR 0002（Chat IPC Streaming）

- **Tauri IPC + Channel 流式不变**
- `ai_chat` 命令签名不变
- **唯一改动**：`ai_chat` 内部 `resolve_target` → `resolve_credentials` 重写（不再 ad-hoc 3-step）
- Channel event 形状不变

### 6.3 现有修复（`preset_overrides` map）

2026-06-16 加嘅 `preset_overrides` map 系**临时救火**。本 ADR Stage 1 之后：
- `preset_overrides[family].model` 字段废弃（迁移数据用）
- `preset_overrides[family].base_url` 字段保留（forward-compat）
- 实现层面：`make_preset_entry` 不再读 `preset_overrides.model`，改读 `default_model_id`（如果 family == default_provider_id）

## 7. 不适用

- **MCP server 嘅 default model**：独立概念（per-task routing），未讨论
- **多 default model**（每个 task / thread 用唔同 model）：未来扩展，本 ADR 唔处理
- **跨设备同步 default**（同步到云端 / 其他设备）：未讨论
- **Per-project default model**（唔同项目用唔同 default）：未来扩展，本 ADR 全局 default 即可
- **Provider 优先级排序**（default 失效后自动选下一个）：Q3 留作开放问题

## 8. 实施计划

按依赖顺序分 4 个 stage commit，每个独立可回退：

| Stage | 内容 | 预估改动 | Commit |
|---|---|---|---|
| **1** | NovaConfig 加 default 字段 + `PresetOverride.model` 废弃 + 启动期 migration + `set_default_model` Tauri command | `nova_config.rs` / `commands/settings.rs` | `feat(adr-0003): default-provider schema + migration` |
| **2** | `resolve_credentials` 重构（直读 default）+ `add` 路径初始化 default + `update` 路径移除 default 设置 + `make_preset_entry` model 注入逻辑调整 | `commands/chat.rs` / `providers/mod.rs` | `feat(adr-0003): resolve-credentials via default` |
| **3** | `/switch` 两段式（pick provider → fetch models → pick → set_default）+ Settings UI 列表 row 加 default chip / 切换按钮 + 共享 set_default 路径 | `AIChatPanel.tsx` / `Settings.tsx` / `api/client.ts` | `feat(adr-0003): pick-then-fetch-then-set UX` |
| **4** | Default 失效 fallback（chat 404 auto-retry + list-models 拉新 default） | `chat.rs` / `provider/mod.rs` | `feat(adr-0003): default-fallback on model 404` |

## 9. 回退策略

每个 stage commit 独立可回退（`git revert <commit>`）：

| Stage | 回退影响 |
|---|---|
| 1 | Schema 改动保留，但行为兼容（旧的 `resolve_credentials` 仍 fallback 到 ad-hoc 3-step） |
| 2 | 核心行为变更。回退后 fallback 到 stage 1 嘅 boot-time migration + step 1 `models.iter().any(m.is_default)` |
| 3 | 纯 UI 回退。`/switch` 回到 broken UX，但 chat 仍 work（Stage 2 已修） |
| 4 | 错误处理变更。fallback 机制消失，chat 404 error 直接透传 |

**任何 Stage 完成后 Nova 都可以独立 ship**——Stage 1+2 已修复核心痛点，Stage 3-4 系增量 UX 改善。

## 10. 开放问题

- **Q1**：`/switch` 切到新 model 后，UI 是否要「清空」之前嘅 chat history？
  - 倾向：保留 history（model 切换唔影响 display），但 assistant bubble 顶部加 chip 显示当时用嘅 model
  - 决定：Stage 3 实施时确认
- **Q2**：Default 失效 fallback 嘅 retry 范围？
  - 倾向：仅 `model_not_found` 类（model 失效），唔重试 network / auth
  - 决定：Stage 4 实施时确认 error 分类规则
- **Q3**：User 删咗 default provider 之后，是否自动 set 下一个 available entry 为 default？
  - 倾向：保持 `uninitialized` 状态显式提示，避免 silent default 切换
  - 决定：Stage 2 实施时确认（涉及状态机转移规则）
- **Q4**：Ollama 嘅 `baseUrlEditable: true` 场景，user 改 base_url 后 default 模型仲 work 唔？
  - 倾向：work（base_url 改动后下次 chat 用新 URL），但若 model 本身从 Ollama 端消失则触发 fallback
  - 决定：Stage 4 fallback 机制 handle
- **Q5**：Preset 嘅 `mode = "preset"` 路径 add 时，`add` 函数唔会调用（preset 用 update 路径）。Stage 2 嘅 default 初始化逻辑对 preset 路径仲 work 唔？
  - 倾向：work——`update` 路径入面如果 `default_provider_id` 未初始化，触发初始化逻辑（add 路径以外嘅另一个 entry point）
  - 决定：Stage 2 实施时确认 update 路径行为
- **Q6**：`ProviderEntry.model: String` vs `models: Vec<ModelEntry>` 双字段冗余？
  - 倾向：Stage 1 保留向后兼容（migration 需要读 `model`），Stage 2 完全移除
  - 决定：本 ADR §3.1.2 已规定（Stage 拆分）
- **Q7**：UI 渲染 default model 时（Settings row hover / 副官「当前模型」chip），model label 实时拉 vs 缓存？
  - 倾向：**实时拉**——不缓存避免 stale，但每次进入 UI 都 fetch 一次（成本可接受，list_models 通常 < 500ms）
  - 决定：Stage 3 实施时确认。如发现 fetch 成本过高可改为「进入页面时 prefetch + 缓存 5 分钟」
- **Q8**：Settings UI 添加 provider 时，选定 model 后是否自动 `set_default`（无论是否首次）？
  - 倾向：仅在 default 未初始化时自动（首次添加）；再次添加时只 save provider，唔动 default——但**需 UI 明确提示「未设为默认」状态**避免误解
  - 决定：Stage 3 实施时确认
- **Q9**：Fallback 触发后，用户如何得知「自动切换咗」？
  - 倾向：assistant bubble 顶部加一条 ephemeral chip「⚠ 原 default 模型失效，已自动切换到 XXX」+ 持续 1 轮对话后消失
  - 决定：Stage 4 实施时确认 UI 形态

---

## 附：与本 ADR 同步更新嘅文件

- `docs/architecture-decisions/0003-default-model.md`（本文件）
- `PLAN.md` §11 changelog（每个 Stage commit 加条目）
- `AGENTS.md` §3 必读文档索引（加入本 ADR）
- `src/components/AIChatPanel.tsx`（Stage 3）
- `src/pages/Settings.tsx`（Stage 3）
- `src-tauri/src/nova_config.rs`（Stage 1-2）
- `src-tauri/src/providers/mod.rs`（Stage 1-2）
- `src-tauri/src/commands/chat.rs`（Stage 2、Stage 4）
- `src-tauri/src/commands/settings.rs`（Stage 1：新 `set_default_model` command）
- `src/api/client.ts`（Stage 3：暴露 `setDefault`）