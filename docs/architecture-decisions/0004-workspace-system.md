# ADR 0004：工作台系统与文件系统集成

**Status**: 📋 Draft | **Date**: 2026-06-17 | **Decision Maker**: Team  
**Related ADRs**: [0001-provider-system.md](0001-provider-system.md), [0003-default-model.md](0003-default-model.md)  
**Related Docs**: [`docs/game-design.md`](../game-design.md)

---

## 背景 · Context

在 v1.x 中，Nova 采用**应用优先模型**：
```
Nova App 启动
  ↓
用户填项目名字 + 选模板
  ↓
应用在 ~/.nova/projects/{id}/ 自动生成文件夹结构
```

**问题所在**：
- 普通人不理解"项目"、"模板"这些开发概念
- 用户已有现成的文件夹（笔记、照片、视频），不知道怎么导入
- 无法支持用户偏好的编辑方式（VS Code、Typora、Apple Notes 导出）
- "星系"隐喻没有落地（项目是星，但用户无法感受到多个"星系"的存在）

---

## 决策 · Decision

**采用工作台系统**，将 Nova 从"应用优先"重新架构为**"文件系统优先"**：

### 核心原则

1. **工作台 (Workspace) 是容器**
   - 一个工作台 = 一个文件夹（如 `~/MyWorks/`）
   - 用户可以随时切换工作台（对应不同"星系"）
   - 每个工作台内有多个项目（多个"星"）

2. **项目自动识别**
   - 用户将文件夹放入工作台 → Nova 自动扫描识别内容
   - 基于目录结构自动判断项目类型（博客/相册/vlog）
   - 无需显式"创建"或"导入"流程

3. **元数据最小化**
   - 每个项目文件夹根目录内 `.nova.yaml` 存储项目元数据
   - 内容完全由用户文件系统决定（Markdown、图片、视频）
   - 用户可用任何编辑器编辑，Nova 定期扫描同步

4. **随处分享**
   - 分享与工作台、项目解耦
   - 任何编辑状态的项目都可一键分享（生成链接、发布、导出）
   - 分享不要求项目"升级"为站点

---

## 方案 · Solution

### 数据模型变更

**当前 (v1.x)**：
```
~/.nova/
├── config.json
├── nova.db
└── projects/
    └── {project-id}/
        ├── notes/ | content/posts/
        └── (Astro 项目文件)
```

**新增 (v2.0)**：
```
~/.nova/
├── config.json              # 新增 workspace_path 字段
├── nova.db
├── workspaces.db            # NEW：工作台索引
└── [user workspaces] →
    ~/MyWorks/              # 工作台 1
    ├── .nova/
    │   └── workspaces.db
    ├── My Blog/             # 项目 1
    │   ├── posts/*.md
    │   ├── photos/
    │   └── .nova.yaml       # NEW：项目元数据
    ├── Photo Album/         # 项目 2
    │   ├── summer/*.jpg
    │   ├── winter/*.jpg
    │   └── .nova.yaml
    └── Notes/               # 项目 3
        ├── 2026-01.md
        ├── 2026-02.md
        └── .nova.yaml

    ~/TravelBlog/           # 工作台 2
    ├── Posts/
    └── .nova/
```

**关键文件：`.nova.yaml`** （项目元数据）
```yaml
# 例：My Blog/.nova.yaml
id: project-abc123
name: My Blog
kind: site
template: blog
created_at: 2026-06-17T10:30:00Z
last_modified: 2026-06-17T14:20:00Z
description: Personal tech blog
tags: [blog, technology]
```

### 项目类型自动识别

| 文件结构 | 检测结果 | 对应 kind | 对应 template |
|---|---|---|---|
| `posts/*.md` | 包含博客文章 | blog | blog |
| `photos/*` | 包含图片 | gallery | gallery |
| `videos/*.mp4` | 包含视频 | vlog | vlog |
| `posts/*.md` + `photos/*` | 混合 | blog-gallery | blog-gallery |
| `index.md` + 其他 | 单笔记 | note | - |
| 空文件夹 | 未识别 | note | - |

**识别逻辑**（Rust）：
```rust
// src-tauri/src/workspace/detector.rs
fn detect_project_type(folder_path: &Path) -> ProjectKind {
  let has_posts = folder_path.join("posts").exists();
  let has_photos = folder_path.join("photos").exists();
  let has_videos = folder_path.join("videos").exists();
  
  match (has_posts, has_photos, has_videos) {
    (true, true, _) => ProjectKind::BlogGallery,
    (_, _, true) => ProjectKind::Vlog,
    (_, true, _) => ProjectKind::Gallery,
    (true, _, _) => ProjectKind::Blog,
    _ => ProjectKind::Note,
  }
}
```

### 首次启动流程

```
[首次打开 Nova]
  ↓
[选择工作台位置]
  ┌────────────────────────────────┐
  │ 选择或创建一个文件夹          │
  │ 来存放你的作品                │
  │                                │
  │ [浏览...] [~/MyWorks] [取消] │
  └────────────────────────────────┘
  ↓
[Nova 扫描工作台]
  ├─ 发现 "My Blog" 文件夹
  ├─ 检测结构：posts/ + photos/ → blog-gallery
  ├─ 生成 .nova.yaml
  ├─ 发现 "Photo Album" 文件夹
  │  检测结构：photos/ → gallery
  │  生成 .nova.yaml
  └─ 创建 workspace 索引
  ↓
[Dashboard：发现新作品]
  ├─ ✦ My Blog (blog-gallery)
  │  [编辑] [分享] [发布]
  ├─ ✦ Photo Album (gallery)
  │  [编辑] [分享] [发布]
  └─ [+ 新建项目] [导入文件夹]
```

---

## 实现 · Implementation

### 阶段 1：核心基础（1 周）

**Rust 端**：
```rust
// 新文件
src-tauri/src/workspace/mod.rs      // 工作台管理
src-tauri/src/workspace/detector.rs // 项目自动识别
src-tauri/src/commands/workspace.rs // 工作台命令

// 修改
src-tauri/src/nova_config.rs
  ├─ 新增 workspace_path: PathBuf
  └─ 新增 scan_workspace() 函数

src-tauri/src/db/mod.rs
  ├─ 新表 workspaces (id, path, name, created_at)
  └─ 修改 projects 表，加 workspace_id 外键
```

**React 端**：
```tsx
// 新建
src/pages/WorkspaceSelector.tsx      // 首次启动：选择工作台
src/components/ProjectDetector.tsx   // 自动识别反馈

// 修改
src/App.tsx                           // 路由加工作台检查
src/pages/Dashboard.tsx               // 改成工作台视图
```

**新增命令**：
```rust
#[tauri::command]
async fn set_workspace(path: String) -> Result<Workspace, String>;

#[tauri::command]
async fn scan_workspace() -> Result<Vec<ProjectInfo>, String>;

#[tauri::command]
async fn switch_workspace(path: String) -> Result<Workspace, String>;

#[tauri::command]
async fn import_folder(folder_path: String) -> Result<ProjectInfo, String>;
```

### 阶段 2：分享集成（1 周）

**新增分享快捷方式**：
```rust
#[tauri::command]
async fn generate_share_link(project_id: String) -> Result<String, String>;

#[tauri::command]
async fn publish_to_web(
  project_id: String,
  target: PublishTarget, // Vercel | Netlify | Self
) -> Result<PublishResult, String>;

#[tauri::command]
async fn export_project(project_id: String, format: String) -> Result<String, String>;
```

**React 端**：
```tsx
// 新建
src/components/SharePanel.tsx         // 快速分享浮板
src/components/PublishDialog.tsx      // 发布对话框

// 改动
src/pages/ProjectEditor.tsx
  ├─ 顶部 bar 加 [分享] 按钮
  └─ 右键菜单加分享选项
```

### 阶段 3：游戏化升级（3-4 天）

**更新 Starfield 事件**：
```typescript
// src/lib/events.ts
type NovaEvent = 
  | { type: "create"; ... }           // 已有
  | { type: "workspace_discovered"; x: number; y: number }  // NEW
  | { type: "project_imported"; x: number; y: number }     // NEW
  | { type: "share"; projectId: string; x: number; y: number }  // NEW
  | { type: "publish"; projectId: string; ... }            // NEW
  | ...
```

**Dashboard 仪式**：
- 首次发现工作台 → "星系降临"动画 + 2-3 秒过渡
- 导入文件夹 → "新星诞生"（沿用当前爆炸效果）
- 首次分享 → 流星雨 + 成就 badge
- 首次发布 → "信标发射"动画

---

## 影响范围 · Impact

### 数据库改动

**新增表**：
```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at INTEGER,
  is_active INTEGER DEFAULT 0
);
```

**修改 projects 表**：
```sql
ALTER TABLE projects ADD COLUMN workspace_id TEXT;
ALTER TABLE projects ADD FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
```

### API 变更

| 旧 API | 新 API | 说明 |
|---|---|---|
| `list_projects` | `list_projects(workspace_id?)` | 可指定工作台，默认当前 |
| `create_project` | 拆为 `import_folder` | 新增自动识别 |
| - | `set_workspace` | 新增工作台切换 |
| - | `scan_workspace` | 新增工作台扫描 |

### UX 变更

| 操作 | 前 (v1.x) | 后 (v2.0) | 游戏化变化 |
|---|---|---|---|
| 启动 | 直接进 Dashboard | 工作台选择 | 首次选择 = 星系降临 |
| 创建项目 | 对话框填信息 | 拖文件夹或新建 | 导入 = 新星诞生 |
| 分享 | 需升级到站点 | 任何状态可分享 | 分享 = 流星雨 |
| 发布 | 构建后手动部署 | 一键发布 | 发布成功 = 信标闪烁 |

---

## 注意事项 · Considerations

### 向后兼容性

- v1.x 的 `~/.nova/projects/` 数据需迁移
- 迁移脚本：检测旧项目 → 复制到新工作台 → 生成 `.nova.yaml`
- 首次启动时自动触发迁移（迁移对话框）

### 多工作台交互

- 工作台切换时，当前项目编辑状态需要清空（或提示保存）
- 草稿数据以 `workspace_id` 隔离存储

### 文件监控

- 生产环境：轮询（2 秒）检查工作台文件变化
- 开发环境：可考虑 `notify` crate + watchdog

---

## 验收标准 · Acceptance Criteria

- [ ] 用户首次启动能选择/创建工作台
- [ ] Nova 能自动扫描识别现有文件夹中的项目
- [ ] 支持切换到不同工作台（对应不同星系）
- [ ] 任何项目都能一键分享（生成链接）
- [ ] 导入现有文件夹时触发"新星诞生"动画
- [ ] 首次发现工作台时触发"星系降临"动画
- [ ] v1.x 项目自动迁移到新工作台（无数据丢失）

---

## 附录 · Appendix

### 配置文件更新

**~/.nova/config.json**（v2.0 新增字段）：
```json
{
  "active_workspace": "/Users/user/MyWorks",
  "workspaces": [
    "/Users/user/MyWorks",
    "/Users/user/TravelBlog"
  ],
  "nova_port": 3847,
  "preview_port": 4321,
  ...
}
```

### 项目元数据示例

**My Blog/.nova.yaml**：
```yaml
id: proj-abc123
name: My Blog
kind: site
template: blog
description: Personal tech blog
created_at: 2026-06-17T10:30:00Z
last_modified: 2026-06-17T14:20:00Z
tags: [blog, technology, personal]
icon: 📝
color: "#6B5BFF"  # 可选：项目自定义颜色
published_at: null
published_url: null
```
