# Dashboard 真·星图化改造 — Plan

> 状态：Plan（待波士 review 后开工）  
> 章节：手册 §4.3 P2  
> 上一轮 ID：b0115d2 / 83a0c45

---

## 1. 目标

将 Dashboard 嘅 ProjectCard 网格（auto-fill / minmax 220px）改造为**真·星图（canvas / SVG + 缩放拖拽）**——星体以位置 / 亮度 / 轨道环反映项目阶段，鼠标悬停显示轨道信息卡片。

## 2. 现状

| 元素 | 当前 | 目标 |
|---|---|---|
| 背景 | `<Starfield />` 静态粒子层 | 保留 + 增加 zoom 同步 |
| 项目布局 | CSS Grid `repeat(auto-fill, minmax(220px,1fr))` | SVG/Canvas 星图，按 stage 散点 |
| 卡片形态 | `<ProjectCard>` Material Card 矩形 | 星体（点 + 光环 + OrbitRing） |
| 交互 | click / hover 看 card | click / hover / 缩放 / 拖拽（§4.3 P2 明确） |
| Section | "站点" / "笔记" 两个分组 | 唔再分组，按 stage 自动聚类 |

## 3. 改动边界

### 3.1 新增组件

- **`src/components/StarMap.tsx`** — 主星图渲染层
  - SVG `<g>` 容器，支持 transform (translate/scale)
  - 每个项目 = 一个 `<g>` 包含：
    - `<circle>` 星点（半径按 stage 计算：星尘 3 / 星胚 5 / 新星 8 / 恒星 11 / 星港 14）
    - `<OrbitRing>` SVG 环（按 stage 渲染）
    - `<text>` 标签（hover 才显示）
  - Pan/drag：`onMouseDown` + `onMouseMove` + `onMouseUp` 计算 delta → 内部 state `offset`
  - Zoom：`onWheel` 累加 `scale` (0.5 - 3.0)，clamp 边界

### 3.2 改动组件

- **`src/pages/Dashboard.tsx`**
  - 移除 grid `Box`，替换为 `<StarMap projects={...} wordCounts={...} onSelect={...} />`
  - Section 组件保留但唔再 wrap grid（改为按 stage filter 后传给 StarMap）
  - Header / Footer / Hero / Observatory / AIChatPanel 保留

- **`src/components/ProjectCard.tsx`**
  - ⚠️ **决定点**：保留（作为 hover info card）or 移除（hover 直接显示 inline tooltip）
  - 推荐方案：保留，转为「星体被 hover 时嘅信息卡片」浮层

### 3.3 不动

- Starfield（背景粒子）→ 改为透传 scale + offset 给 StarMap 同步
- Observatory（底部 strip）→ 唔变
- AIChatPanel → 唔变

## 4. 关键设计决策（待波士确认）

### Q1：拖拽边界
- A. 无边界（无限平移，但 zoom 0.5 时回中）
- B. 弹性边界（拖到边缘有橡皮筋回弹）
- 推荐：**A**（更「无限宇宙」感，但 zoom 边界要严）

### Q2：缩放范围
- 手册冇指定，建议 **0.5x ~ 3.0x**，默认 1.0x
- 滚动触发（`onWheel` + deltaY 累加）

### Q3：星体位置算法
- A. 完全随机散点（每次 mount 重算）→ 但项目增加时会跳动
- B. 确定性散点（用 project.id hash → 角度 + 半径）→ 稳定，但可能撞
- C. 力导向（d3-force）→ 最自然，但引入 d3 dependency
- 推荐：**B + 撞点 nudge**（确定性 + 简单冲突解决）

### Q4：星图 vs 卡片双轨
- A. 纯星图（移除 ProjectCard 网格）
- B. 双视图切换（toggle：「网格」/「星图」）
- C. 星图 + 浮动信息卡（hover 时显示 ProjectCard 内容）
- 推荐：**C**（渐进式 / 保持信息密度 / 唔破坏现有交互）

### Q5：性能
- 50 个项目以上时 SVG node 可能影响性能
- 兜底：**N ≥ 50 时**降级为 canvas 渲染
- Starfield 嘅粒子数与 zoom 联动（zoom 越大粒子越稀）

## 5. 工时估算

| 任务 | 工时 |
|---|---|
| StarMap 基础渲染（点 + 光环） | 2h |
| 缩放 + 拖拽 | 1.5h |
| 星体位置算法 + nudge | 1h |
| 浮动信息卡（hover） | 1h |
| 性能降级（>50 项目 → canvas） | 1.5h |
| 测试 + 调试 + commit | 1h |
| **总计** | **~8h** |

## 6. 依赖检查

- React：`useState` / `useRef` / `useEffect`（已有）
- 工具：唔需要引入 d3，自己写点算法
- 字体 / 颜色：复用 `T` / `FONT` / `tokens.ts`（已建）
- OrbitRing：要从 MUI Box 改造为 SVG `<circle>` 兄弟（或者独立 SVG 版本）

## 7. 待波士确认

1. **Q1-Q5 设计决策拣边个**？
2. **工时 8h 是否接受**（分多次 commit or 一次过）？
3. **是否需要先做 prototype**（用 prototype skill 出 2-3 个状态机变体）？

确认后开工。
