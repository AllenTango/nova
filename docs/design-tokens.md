# Nova Design Tokens

> 版本：v1.0 | 状态：与 `src/theme/tokens.ts` 同步 | 适用范围：全站视觉决策

本文档是 Nova 视觉系统的「唯一真相源」。任何字号、间距、动效时长都应从 `src/theme/tokens.ts` 引用，而不是在组件里 hardcode。

---

## 1. 设计哲学

Nova 不是「带皮肤的笔记工具」，而是一座个人天文台。每个 token 都应让人联想到：星图、望远镜控制台、轨道数据、光信号、深空探测。

设计原则：
- **语义命名**：`TYPE.body` 而不是 `TYPE.font14`。读 token 名就知用途。
- **配套组件**：`variant="body2"` 已经继承 token，能继承就继承。
- **避免 magic number**：`fontSize: "0.85rem"` 出现 30+ 次 = 出事。

---

## 2. 色彩宇宙（COLOR）

详见 `docs/game-design.md` §2.1。代码层仍使用 `t.star` / `t.nova` / `t.border` 等变量名（已稳定，rename 是 P2 工作）。

| 概念名 | 代码变量 | 角色 |
|---|---|---|
| Void | `t.ink` | 深空主背景 |
| Nebula | `t.nebula` | 紫调次强调 |
| Corona | `t.nova` | 暖调主强调（按钮 / 重要反馈） |
| Starlight | `t.star` | 正文主文字 |
| Star-dim | `t.starDim` | 次要文字 |
| Star-faint | `t.starFaint` | 辅助 / 禁用 |
| Orbit | `t.border` | 分割线 / 边框 |
| Dust | `t.dust` | 浮层 / 面板背景 |

亮色模式有对应 `T.light.*`，结构同构。

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

| Token | size | weight | letter-spacing | 用途 | 对应 MUI variant |
|---|---|---|---|---|---|
| `TYPE.display` | 2.6rem | 400 | -0.04em | 启动仪式 / 星图大标签 | h1 (大) |
| `TYPE.hero` | 2.2rem | 400 | -0.03em | 页面级 hero text | h1 |
| `TYPE.title` | 1.4rem | 500 | -0.02em | 卡片 / 面板标题 | h2 |
| `TYPE.subtitle` | 1.05rem | 500 | -0.01em | 次级标题 / 对话框标题 | h3 |
| `TYPE.body` | 0.95rem | 400 | — | 标准正文 | body1 |
| `TYPE.bodySm` | 0.85rem | 400 | — | 紧凑正文 | body2 |
| `TYPE.mono` | 0.8rem | 400 | — | 端口 / ID / 模型名 | — |
| `TYPE.monoSm` | 0.7rem | 400 | 0.06em | 芯片 / 标签 | caption |
| `TYPE.caption` | 0.72rem | 400 | 0.06em | 时间戳 / 提示 | caption |
| `TYPE.micro` | 0.65rem | 400 | 0.08em | 极限小字 / 徽章 | — |

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

> 现状：tokens 已建，但组件级替换是 P2 工作。本文件先固化 contract。
