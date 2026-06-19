# Nova Design Tokens

> 版本：v1.1 | 状态：与 `src/theme/tokens.ts` 同步 | 适用范围：全站视觉决策

本文档是 Nova 视觉系统的「唯一真相源」。任何字号、间距、动效时长都应从 `src/theme/tokens.ts` 引用，而不是在组件里 hardcode。

---

## 1. 设计哲学

Nova 不是「带皮肤的笔记工具」，而是一座个人天文台。每个 token 都应让人联想到：星图、望远镜控制台、轨道数据、光信号、深空探测。

设计原则：
- **语义命名**：`TYPE.body` 而不是 `TYPE.font14`。读 token 名就知用途。
- **配套组件**：`variant="body2"` 已经继承 token，能继承就继承。
- **避免 magic number**：`fontSize: "0.85rem"` 出现 30+ 次 = 出事。
- **对比度优先**：暗色模式文本必须达到 WCAG AA 标准（正文 >= 4.5:1，大字 >= 3:1）。

---

## 2. 色彩宇宙（COLOR）

详见 `docs/game-design.md` §2.1。代码层使用 `t.star` / `t.nova` / `t.border` 等变量名。

### 2.1 暗色模式（Deep Space）

| 概念名 | 代码变量 | 色值 | 角色 |
|---|---|---|---|
| Void | `t.ink` | `#0B0B14` | 深空主背景 |
| Dust | `t.dust` | `#1E1A2E` | 浮层 / 面板背景 |
| Surface | `t.surface` | `#2E2940` | 二级浮层 / 嵌套面板 |
| Orbit | `t.border` | `rgba(232, 228, 255, 0.08)` | 分割线 / 边框 |
| Orbit-strong | `t.borderStrong` | `rgba(232, 228, 255, 0.16)` | 强调边框 |
| Starlight | `t.star` | `#E8E4FF` | 正文主文字 |
| Star-dim | `t.starDim` | `#B0AAD0` | 次要文字 |
| Star-faint | `t.starFaint` | `#7A7399` | 辅助 / 禁用态 |
| Nova | `t.nova` | `#FF6B6B` | 暖调主强调（按钮 / 重要反馈） |
| Nova-glow | `t.novaGlow` | `rgba(255, 107, 107, 0.15)` | 主强调辉光 |
| Nebula | `t.nebula` | `#6B5BFF` | 紫调次强调 |
| Nebula-glow | `t.nebulaGlow` | `rgba(107, 91, 255, 0.18)` | 次强调辉光 |

### 2.2 亮色模式（Peach Daybreak）

| 概念名 | 代码变量 | 色值 | 角色 |
|---|---|---|---|
| Atmosphere | `t.ink` | `#FBF3E8` | 暖奶油主背景 |
| Cloud | `t.dust` | `#FFF8EE` | 面板背景 |
| Horizon | `t.surface` | `#F5E6D3` | 二级面板 |
| Orbit | `t.border` | `rgba(101, 70, 50, 0.10)` | 分割线 |
| Starlight | `t.star` | `#3A2A20` | 正文主文字 |
| Star-dim | `t.starDim` | `#7A5A4A` | 次要文字 |
| Star-faint | `t.starFaint` | `#A88870` | 辅助 / 禁用 |
| Nova | `t.nova` | `#E85A4F` | 主强调 |
| Nebula | `t.nebula` | `#7A6AE8` | 次强调 |

### 2.3 对比度标注

暗色模式文本对比度（背景 = Void `#0B0B14`）：

| 色彩角色 | 对比度 | WCAG 等级 | 用途限制 |
|---|---|---|---|
| Starlight `#E8E4FF` | ~15.5:1 | AAA | 无限制 |
| Star-dim `#B0AAD0` | ~6.2:1 | AA (enhanced) | 正文、caption 均可 |
| Star-faint `#7A7399` | ~4.5:1 | AA (minimum) | 仅用于辅助说明；禁止 < 0.75rem |
| Nova `#FF6B6B` | ~5.8:1 | AA | 按钮文字、强调文本 |
| Nebula `#6B5BFF` | ~3.5:1 | AA large only | 仅大字/图标/装饰；禁止做正文色 |

层级分离目标（暗色模式）：
- Void → Dust：亮度差 ΔL >= 6%（实际 ~7%）
- Dust → Surface：亮度差 ΔL >= 6%（实际 ~7%）
- 目的：面板浮层在普通显示器上可明确区分，不融为一体

---

## 3. 字体系统（TYPOGRAPHY）

### 3.1 字体家族

| 角色 | 字体 | 何时用 |
|---|---|---|
| Display | Fraunces | 大标题 / 启动仪式 / 星图标签（带 italic + variable font） |
| Body | IBM Plex Sans | 列表 / 说明 / 对话内容 |
| Mono | JetBrains Mono | 端口 / ID / 模型名 / Base URL / 时间戳 |

> 手册 §2.2 推荐 Space Grotesk / Inter。Nova 已使用 Fraunces + IBM Plex Sans — 都是同一类「航天器仪表」气质嘅变体，且支持 variable font，不更换。

### 3.2 字号 token

| Token | size | weight | letter-spacing | 用途 | 对应 MUI variant | 响应式(narrow) |
|---|---|---|---|---|---|---|
| `TYPE.display` | 2.6rem | 400 | -0.04em | 启动仪式 / 星图大标签 | h1 (大) | → 2.0rem |
| `TYPE.hero` | 2.2rem | 400 | -0.03em | 页面级 hero text | h1 | → 1.6rem |
| `TYPE.title` | 1.4rem | 500 | -0.02em | 卡片 / 面板标题 | h2 | → 1.2rem |
| `TYPE.subtitle` | 1.05rem | 500 | -0.01em | 次级标题 / 对话框标题 | h3 | 不变 |
| `TYPE.body` | 0.95rem | 400 | — | 标准正文 | body1 | 不变 |
| `TYPE.bodySm` | 0.85rem | 400 | — | 紧凑正文 | body2 | 不变 |
| `TYPE.mono` | 0.8rem | 400 | — | 端口 / ID / 模型名 | — | 不变 |
| `TYPE.monoSm` | 0.7rem | 400 | 0.06em | 芯片 / 标签 | caption | 不变 |
| `TYPE.caption` | 0.72rem | 400 | 0.06em | 时间戳 / 提示 | caption | 不变 |
| `TYPE.micro` | 0.65rem | 400 | 0.08em | 极限小字 / 徽章 | — | → 0.7rem |

> 响应式缩放通过 CSS `clamp()` 或 MUI `theme.breakpoints` 实现，token 定义的是 wide（默认）值。narrow 列标注该断点下的降级值，"不变" 表示已为可读最小值。

### 3.3 使用规则

```tsx
// ✅ 优先：用 MUI variant 继承
<Typography variant="body2">这是紧凑正文</Typography>

// ✅ 必要时：用 sx 引用 token
<Box sx={{ fontSize: TYPE.bodySm.size, fontFamily: TYPE.mono.family }}>
  端口：{novaPort}
</Box>

// ❌ 禁止：hardcode magic number
<Box sx={{ fontSize: "0.85rem" }}>...</Box>
```

---

## 4. 间距系统（SPACE）

Nova 用 4px 基础栅格。所有 spacing 都应引用 token：

| Token | 数值 | 用途 |
|---|---|---|
| `SPACE.xs` | 0.5 (4px) | 紧凑内联间距 |
| `SPACE.sm` | 1 (8px) | 组件内部 |
| `SPACE.md` | 2 (16px) | 兄弟元素间 |
| `SPACE.lg` | 3 (24px) | 区域分隔 |
| `SPACE.xl` | 4 (32px) | 页面级分隔 |
| `SPACE.xxl` | 6 (48px) | hero 间距 |

```tsx
// ✅ 推荐
<Box sx={{ p: SPACE.md, gap: SPACE.sm }}>...</Box>

// ❌ 避免（除非有特殊原因）
<Box sx={{ p: 2, gap: 1.5 }}>...</Box>
```

### 4.2 断点 tokens（BREAKPOINT）

Nova 是 Tauri 桌面应用，"断点" 对应的是用户缩小窗口或分屏的场景，而非移动端。

| Token | 数值 | 触发条件 | 核心变化 |
|---|---|---|---|
| `BREAK.narrow` | 768px | 窗口宽度 < 768px | 侧栏折叠、星图切列表视图 |
| `BREAK.medium` | 1024px | 窗口宽度 768–1024px | 预览自动隐藏、侧栏紧凑 |
| `BREAK.wide` | 1280px | 窗口宽度 >= 1024px | 完整布局 |

映射到 MUI breakpoints：
```tsx
createTheme({
  breakpoints: { values: { xs: 0, sm: 768, md: 1024, lg: 1280, xl: 1536 } }
})
```

**侧栏宽度 token**：

| Token | 数值 | 断点 |
|---|---|---|
| `SIDEBAR.wide` | 260px | >= medium |
| `SIDEBAR.compact` | 200px | medium (768–1024px) |
| `SIDEBAR.rail` | 40px | < narrow (< 768px) |

**StarMap 高度 token**：

```css
height: clamp(300px, 50vh, 600px);  /* 替代固定 520px */
```

响应式设计完整约束见 `docs/game-design.md` §9。

---

## 5. 动效边界（MOTION）

| Token | 时长 | 用途 | 手册对应 |
|---|---|---|---|
| `MOTION.fast` | 0.15s | hover / press | — |
| `MOTION.base` | 0.25s | color / opacity | — |
| `MOTION.slow` | 0.4s | size / transform | — |
| `MOTION.intro` | 1.1s | NovaIntro 启动仪式 | §5 红线 ≤ 1.2s |
| `MOTION.reduced` | 0.15s | reduced-motion fallback | §5 强制 |

Easing：
- `MOTION.ease.smooth` — `cubic-bezier(0.16, 1, 0.3, 1)`（弹性入场）
- `MOTION.ease.snappy` — `cubic-bezier(0.4, 0, 0.2, 1)`（响应式）

### 5.1 性能红线（§5）

- 不使用持续 Canvas 动画干扰打字
- 不使用 `blur()` BackdropFilter 做大面积背景
- 所有动画必须支持 `prefers-reduced-motion`
- 星图背景在页面不可见时暂停

### 5.2 响应式动效规则

| 断点条件 | 调整 |
|---|---|
| narrow (< 768px) | `MOTION.slow` → 0.2s；`MOTION.intro` → 0.6s；milestone 彩蛋改为 toast（不播全屏动效） |
| reduced-motion（任何断点） | 全部 → `MOTION.reduced` (0.15s)；intro → 0s |
| narrow + reduced-motion | 全部 instant；仅保留 opacity 过渡 0.15s |

> narrow 断点下 hover-based 动效移除（桌面小窗口仍有鼠标，但空间紧凑不适合展开式动效）。

---

## 6. 圆角（RADIUS）

| Token | 数值 | 用途 |
|---|---|---|
| `RADIUS.sharp` | 2 | 按钮 / 芯片 |
| `RADIUS.default` | 3 | 输入框 |
| `RADIUS.card` | 6 | 卡片 / 对话框 |

---

## 7. 当前代码引用现状

| Token | 已替代 | 仍 hardcode | 下一步 |
|---|---|---|---|
| `TYPE.body` / `bodySm` | 多数 `variant="body1/2"` 继承 | ~10 处 `fontSize: "0.85rem"` | 下一轮 refactor |
| `TYPE.mono` | `FONT.mono` 已统一 | ~5 处 `fontSize: "0.8rem"` | 下一轮 |
| `TYPE.monoSm` | `caption` variant 部分继承 | ~10 处 `fontSize: "0.7rem"` | 下一轮 |
| `MOTION.*` | 已统一引用 | 散落 ~15 处 `"0.15s"` 等 | 下一轮 |
| `SPACE.*` | 未引用 | 散落 ~40 处 `p:2 gap:1.5` | **P2 大改造** |
| `BREAK.*` | **未实现** | 侧栏 280px hardcode；StarMap 520px hardcode | **P1 响应式** |
| 色彩对比度修正 | **未实现** | `starDim` / `starFaint` / `dust` / `surface` 值待更新 | **P1 对比度** |

> 现状：tokens 已建，但组件级替换是 P2 工作。色彩对比度修正和断点 token 是 P1 工作。本文件先固化 contract。
