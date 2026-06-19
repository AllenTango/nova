# ADR 0005：页面组合式模板系统

**Status**: 📋 Draft | **Date**: 2026-06-19 | **Decision Maker**: Team
**Related ADRs**: [0001-provider-system.md](0001-provider-system.md), [0004-workspace-system.md](0004-workspace-system.md)
**Related Docs**: [`docs/game-design.md`](../game-design.md)

---

## 1. 背景 · Context

### 1.1 v1.x 模板现状

Nova v1.x 内置 6 个模板选项：

| ID | 名称 | 实际实现 |
|---|---|---|
| `blog` | 博客 | ✅ 唯一真实模板 |
| `gallery` | 相册 | ❌ fall back → blog |
| `vlog` | 影像日志 | ❌ fall back → blog |
| `blog-gallery` | 博客 + 相册 | ❌ fall back → blog |
| `corporate` | 企业官网 | ❌ fall back → blog |
| `agent-home` | 智能体主页 | ❌ fall back → blog |

**问题**：
- 6 个模板 ID 全部映射到同一个 `blog` 模板，UX 不诚实
- 模板是"固定套餐"，用户无法自由组合页面类型
- 真实 `templates/blog/` 内部已经包含 blog、gallery、vlog、about 页面，只是没有暴露选择机制

### 1.2 ADR 0004 的要求

ADR 0004 引入"文件系统优先"模型，要求：
- 项目元数据存储在 `.nova.yaml`
- 内容类型由目录结构自动识别（`posts/` → blog，`photos/` → gallery，`videos/` → vlog）
- 类型不再是固定套餐，而是可组合的能力

### 1.3 波士的洞见

> 不同类型的网站实际上就是不同页面的组合。内置模板其实只需要实现不同类型页面即可满足不同站点的需求。

**观察**：所有网站需求可以拆解为原子页面的自由组合：

| 需要的页面 | 对应站点类型 |
|---|---|
| blog + about | 纯传统博客 |
| vlog + about | 纯视频博客 |
| gallery + about | 纯图片博客 |
| index + blog + vlog + about | blog + video 混合 |
| index + blog + gallery + about | blog + photo 混合 |
| index + vlog + gallery + about | video + photo 混合 |
| index + blog + vlog + gallery + about | blog + video + photo 混合 |
| about + （业务页面）| 企业官网 |
| about + （AI 展示）| 智能体主页 |

---

## 2. 决策 · Decision

### 2.1 核心原则

**模板 = 页面组合，而非固定套餐。**

- 所有页面类型作为原子能力存在于内置模板中
- 用户按需勾选需要的页面类型
- 构建系统只生成用户选中的页面
- 新增页面类型只需在内置模板中添加，触达所有站点

### 2.2 原子页面类型

| 页面类型 | 文件 | 说明 |
|---|---|---|
| `index` | `src/pages/index.astro` | 站点首页/封面 |
| `blog` | `src/pages/blog.astro` | 博客文章列表 |
| `vlog` | `src/pages/vlog.astro` | 影像日志列表 |
| `gallery` | `src/pages/gallery.astro` | 相册/图片展示列表 |
| `about` | `src/pages/about.astro` | 关于页面 |
| `posts/[slug]` | `src/pages/posts/[slug].astro` | 博客文章详情（blog 从属） |
| `videos/[slug]` | `src/pages/videos/[slug].astro` | 视频详情（vlog 从属） |
| `photos/[slug]` | `src/pages/photos/[slug].astro` | 相册详情（gallery 从属） |

### 2.3 页面依赖规则

```
index      → 无依赖（根页面）
blog       → posts/[slug]
vlog       → videos/[slug]
gallery    → photos/[slug]
about      → 无依赖
posts/[slug]   → 依赖 blog 类型
videos/[slug]  → 依赖 vlog 类型
photos/[slug]  → 依赖 gallery 类型
```

选择 `blog` 时必须同时包含 `posts/[slug]` 渲染逻辑。
选择 `vlog` 时必须同时包含 `videos/[slug]` 渲染逻辑。
选择 `gallery` 时必须同时包含 `photos/[slug]` 渲染逻辑。

### 2.4 组合示例

| 用户选择 | 生成页面 |
|---|---|
| blog + about | blog.astro + posts/[slug].astro + about.astro |
| blog + vlog + about | blog.astro + vlog.astro + posts/[slug].astro + videos/[slug].astro + about.astro |
| blog + gallery + about | blog.astro + gallery.astro + posts/[slug].astro + photos/[slug].astro + about.astro |
| vlog + gallery + about | vlog.astro + gallery.astro + videos/[slug].astro + photos/[slug].astro + about.astro |
| vlog + gallery | vlog.astro + gallery.astro + videos/[slug].astro + photos/[slug].astro |

### 2.5 site.yaml Schema

```yaml
# .nova.yaml（同 ADR 0004）
id: proj-abc123
name: My Blog
kind: site
created_at: 2026-06-19T10:00:00Z
last_modified: 2026-06-19T10:00:00Z

# 站点页面配置（ADR 0005 新增）
pages:
  - index      # 可选，默认包含
  - blog
  - vlog
  - gallery
  - about
```

**最小配置**：
```yaml
# 最简单的博客
pages: [blog, about]   # index 自动降级为 blog.astro 的重定向
```

---

## 3. 技术方案 · Technical Solution

### 3.1 模板系统合并

**现状**：
```
templates/
  blog/              ← 唯一真实模板
    src/pages/
      index.astro
      blog.astro
      gallery.astro
      vlog.astro
      about.astro
      posts/[slug].astro
      ...
```

**ADR 0005 后**：
```
templates/
  universal/          ← 唯一内置模板（所有页面都在）
    src/pages/
      index.astro
      blog.astro
      gallery.astro
      vlog.astro
      about.astro
      posts/[slug].astro
      videos/[slug].astro
      photos/[slug].astro
    site.yaml         ← 页面组合声明
    build.ts          ← 根据 site.yaml 生成/删除页面
```

### 3.2 页面过滤：交由 AI Agent 处理

**决定**：页面生成/过滤不硬编码，交给 nova 内置 AI Agent 决策。

用户选择页面组合后，Agent 根据 `site.yaml` 上下文智能决定：
- 哪些页面需要生成/激活
- 页面内容的结构和变体
- 是否需要添加自定义页面

Agent 通过 `nova-content` / `frontend-component` 技能操作（见 ADR 0004 §5 内置技能清单），而非模板系统的硬编码逻辑。

### 3.3 note → site 迁移（基于 ADR 0004）

笔记项目升级到站点时，按照 ADR 0004 的文件系统优先模型实现：

```
1. 扫描 notes/ 目录
2. 读取每个 .md 的 frontmatter → 提取 type 字段
3. 生成 .nova.yaml（含 pages 字段，根据检测到的内容类型推断）
4. 生成 site.yaml（含 pages 字段）
5. notes/ 内容保留，site 可独立使用
```

**检测规则**（ADR 0004 detector.rs）：
```rust
match (has_posts, has_photos, has_videos) {
  (true, true, true)   => pages: [index, blog, vlog, gallery, about]
  (true, true, false)  => pages: [index, blog, gallery, about]
  (true, false, true)   => pages: [index, blog, vlog, about]
  (false, true, true)   => pages: [index, vlog, gallery, about]
  (true, false, false)  => pages: [blog, about]   // 降级：无 index
  (false, true, false)  => pages: [gallery, about]
  (false, false, true)   => pages: [vlog, about]
  _                     => pages: [about]          // 最简站点
}
```

**用户可选**：迁移完成后，用户可在 ProjectEditor 中修改 pages 组合（勾选 UI），Agent 执行变更。

**旧 UI（模板套餐）**：
```
新建站点
模板：○ 博客  ○ 相册  ○ 影像日志  ○ 博客+相册 ...
```

**新 UI（页面组合勾选）**：
```
新建站点
项目名称：[____________]

选择需要的页面（可多选）：
  ☑ 博客（blog）
  ☐ 影像（vlog）
  ☐ 相册（gallery）
  ☑ 关于（about）

  → 预览组合效果
  [blog] + [about] = 纯博客站点
  [blog] + [vlog] + [about] = 博客+影像混合
```

**默认值**：新建站点默认勾选 `blog + about`（最简单博客）。

### 3.4 Rust 端变更

**`templates.rs`**：
```rust
// 旧：按 template ID 解析
fn resolve_template(template: &str) -> &str {
    match template {
        "blog" => "blog",
        "gallery" => "blog",  // 全部 fall back
        ...
    }
}

// 新：统一指向 universal
fn resolve_template(template: &str) -> &str {
    // 全部映射到 universal
    match template {
        "blog" | "gallery" | "vlog" | "blog-gallery" | "corporate" | "agent-home" => "universal",
        _ => "universal",
    }
}
```

**`upgrade_to_site()` 变更**：
```rust
// 新增：根据用户选择的页面集合写入 site.yaml
#[tauri::command]
pub async fn upgrade_to_site(
    id: String,
    pages: Vec<String>,  // ["blog", "about"]
    db: State<'_, SharedDatabase>,
) -> Result<ProjectInfo, String> {
    // 1. 复制 universal 模板
    apply_template("universal", &path)?;
    // 2. 生成 .nova.yaml（含 pages 字段）
    // 3. 生成 site.yaml（含 pages 字段）
    // 4. db.upgrade_to_site(&id, "universal")
}
```

**`create_project()` 签名变更**：
```rust
// 旧
pub async fn create_project(name, kind, template: String, ...)

// 新
pub async fn create_project(name, kind, pages: Vec<String>, ...)
```

---

## 4. 实现计划 · Implementation

### 阶段 1：模板合并（P0）

**目标**：合并所有模板到 `universal/`，保持行为不变

1. `templates/blog/` → `templates/universal/`
2. `resolve_template()` 全部映射到 `"universal"`
3. 添加 `templates/universal/site.yaml`（初始含所有页面）
4. 验证：所有 6 个模板 ID 仍然可用

### 阶段 2：页面过滤逻辑（P0）

**目标**：实现 site.yaml 驱动的页面条件渲染

1. `templates/universal/build.ts`：读取 site.yaml，写入临时 `pages-config.ts`
2. 各页面文件 import 该 config，条件决定渲染行为
3. `site.yaml.pages` 为空时默认 `[blog, about]`

### 阶段 3：Dashboard UI（P0）

**目标**：模板套餐 → 页面勾选

1. `TEMPLATES` 常量 → `PAGE_OPTIONS` 勾选框列表
2. `create_project` 调用传入 `pages: string[]`
3. 降级提示：旧模板 ID 仍接受，映射到对应页面组合

### 阶段 4：ADR 0004 集成（P1）

**目标**：结合 ADR 0004 的 .nova.yaml 系统

1. `.nova.yaml` 新增 `pages` 字段
2. 模板初始化时写入 `site.yaml` + `.nova.yaml`
3. 迁移脚本：旧项目添加默认 `pages: [blog, about]`

---

## 5. 影响范围 · Impact

### 5.1 数据库变更

| 字段 | 旧 | 新 |
|---|---|---|
| `projects.template` | `"blog"` / `"gallery"` 等 | `"universal"` 统一值 |
| `projects.pages` | 不存在 | 新增 `Vec<String>`（页面列表） |

**迁移**：
- 已有项目的 `template` 字段值不再代表真实模板
- 所有 site 项目添加 `pages` 字段，初始值根据原 template 映射：
  ```
  blog        → [blog, about]
  gallery      → [gallery, about]
  vlog        → [vlog, about]
  blog-gallery → [blog, gallery, about]
  corporate   → [about] + 业务页面
  agent-home  → [about] + AI 展示页
  ```

### 5.2 API 变更

| 旧 API | 新 API |
|---|---|
| `create_project(name, kind, template: String)` | `create_project(name, kind, pages: Vec<String>)` |
| `upgrade_to_site(id, template: String)` | `upgrade_to_site(id, pages: Vec<String>)` |

### 5.3 模板文件变更

- `templates/blog/` → `templates/universal/`
- `templates/gallery/` → 删除（合并）
- `templates/vlog/` → 删除（合并）
- `templates/corporate/` → 删除（合并）
- `templates/agent-home/` → 删除（合并）

### 5.4 向后兼容性

- 旧 `template` ID（`"blog"`、`"gallery"` 等）仍然接受
- 内部映射到对应页面组合，行为不变
- `site.yaml` 缺失时默认 `[blog, about]`

---

## 6. 验收标准 · Acceptance Criteria

- [ ] 6 个模板 ID（blog/gallery/vlog/blog-gallery/corporate/agent-home）新建站点均正常
- [ ] `templates/universal/` 包含所有原子页面（index/blog/vlog/gallery/about + slug 路由）
- [ ] `site.yaml` 存在且 `pages` 字段正确
- [ ] Dashboard UI 显示页面勾选而非模板套餐
- [ ] 只勾选 blog + about 时，不生成 vlog/gallery 相关页面
- [ ] 笔记项目升级到站点时，可选择页面组合
- [ ] 旧项目升级后 `pages` 字段正确初始化

---

## 7. 附录 · Appendix

### 7.1 site.yaml 完整 Schema

```yaml
# 站点元数据（ADR 0004 .nova.yaml 同源）
id: proj-abc123
name: My Blog
kind: site
created_at: 2026-06-19T10:00:00Z
last_modified: 2026-06-19T10:00:00Z

# 站点配置
pages:
  - index      # 可选，默认包含
  - blog       # 博客文章
  - vlog       # 影像日志
  - gallery    # 相册
  - about      # 关于页面

# 可选：自定义页面（用户后续添加）
# custom_pages:
#   - src/pages/contact.astro

# 主题配置
theme:
  name: dracula  # dracula | mint | nord | peach
  mode: dark     # dark | light | system
```

### 7.2 Dashboard PAGE_OPTIONS 示例

```typescript
const PAGE_OPTIONS = [
  { id: 'blog',     label: '博客',     desc: '文字文章',      icon: '📝', requires: ['posts/[slug]'] },
  { id: 'vlog',     label: '影像',     desc: '视频日志',      icon: '🎬', requires: ['videos/[slug]'] },
  { id: 'gallery', label: '相册',     desc: '图片展示',      icon: '🖼️', requires: ['photos/[slug]'] },
  { id: 'about',   label: '关于',     desc: '个人/团队介绍', icon: '👤', requires: [] },
];

const DEFAULT_PAGES = ['blog', 'about'];
```

### 7.3 迁移检查清单

- [ ] `templates/blog/` 重命名为 `templates/universal/`
- [ ] `resolve_template()` 全部返回 `"universal"`
- [ ] 添加 `templates/universal/site.yaml`
- [ ] 6 个旧模板目录标记为废弃（.deprecated 标记文件）
- [ ] `create_project` signature 更新
- [ ] `upgrade_to_site` signature 更新
- [ ] Dashboard UI 改页面勾选
- [ ] 数据库迁移：projects 表添加 `pages` 列
- [ ] 旧项目读取时默认 `pages = [blog, about]`
