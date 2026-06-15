/**
 * Nova 设计 tokens——全应用复用视觉值的唯一来源。
 *
 * 分两层：
 *   1. COLOR（`T.dark` / `T.light`）——语义化色板，映射到
 *      `docs/game-design.md` §2.1 里的宇宙观（Void / Nebula / Corona
 *      / Starlight 等）。
 *   2. TYPOGRAPHY（`TYPE`）——语义化字体 token。每个 token 有尺寸
 *      和推荐的 MUI variant / 角色，匹配 §2.2 的层级。
 *
 * 为什么有这个文件：之前组件到处硬编码 `fontSize: "0.85rem"` 之类
 * 30+ 处。现在可以引用 `TYPE.body.size`（或者继续用 MUI variant，
 * 它已经从 theme.ts 继承）。
 *
 * 何时直接用 TYPE token：
 *   - 在 sx={{}} 里要覆盖 Typography 默认值
 *   - 内联元素（Box component="code"、IconButton 等）
 *   - 一次性等宽数据展示
 *
 * 何时不要用：直接 `variant="body2"`，让 MUI 继承即可。
 */

import { T as _T, FONT as _FONT } from "../theme";

export const T = _T;
export const FONT = _FONT;

/**
 * 字体 tokens。尺寸以 rem 为单位。letter-spacing 和 font-family
 * 跟 `docs/game-design.md` §2.2。
 */
export const TYPE = {
  /** Display——页面级 hero 文本（如 NovaIntro wordmark、ProjectCard hero） */
  display: {
    size: "2.6rem",
    weight: 400,
    letterSpacing: "-0.04em",
    family: FONT.display,
  },
  /** Hero——大区块标题（如"让 Nova 认识你"） */
  hero: {
    size: "2.2rem",
    weight: 400,
    letterSpacing: "-0.03em",
    family: FONT.display,
  },
  /** Title——卡片/面板标题 */
  title: {
    size: "1.4rem",
    weight: 500,
    letterSpacing: "-0.02em",
    family: FONT.display,
  },
  /** Subtitle——次级标题、对话框标题 */
  subtitle: {
    size: "1.05rem",
    weight: 500,
    letterSpacing: "-0.01em",
    family: FONT.display,
  },
  /** Body——正文阅读文字（MUI body1） */
  body: {
    size: "0.95rem",
    weight: 400,
    family: FONT.body,
    lineHeight: 1.65,
  },
  /** Body small——紧凑正文（MUI body2） */
  bodySm: {
    size: "0.85rem",
    weight: 400,
    family: FONT.body,
    lineHeight: 1.6,
  },
  /** Mono——端口号、ID、模型名、telemetry */
  mono: {
    size: "0.8rem",
    weight: 400,
    family: FONT.mono,
  },
  /** Mono small——chip 文字、caption、微标签 */
  monoSm: {
    size: "0.7rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.06em",
  },
  /** Caption——MUI caption（时间戳、提示） */
  caption: {
    size: "0.72rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  /** Micro——最小可读字号（溢出提示、徽章） */
  micro: {
    size: "0.65rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.08em",
  },
} as const;

/**
 * 间距 tokens——布局节奏的语义化间距。
 *
 * 组件应当取用这些，而不是直接写 `p: 3` 或 `gap: 2`，
 * 这样跨页面的间距能保持一致。
 */
export const SPACE = {
  xs: 0.5,   // 4px  —— 紧凑内联间隙
  sm: 1,     // 8px  —— 组件内
  md: 2,     // 16px —— 兄弟元素之间
  lg: 3,     // 24px —— 区块分隔
  xl: 4,     // 32px —— 页面级分隔
  xxl: 6,    // 48px —— hero 间距
} as const;

/**
 * 动效 tokens——动画时序，匹配 §5 动效预算。
 */
export const MOTION = {
  /** 快速微交互（hover、press） */
  fast: "0.15s",
  /** 标准过渡（color、opacity） */
  base: "0.25s",
  /** 慢速过渡（size、transform） */
  slow: "0.4s",
  /** NovaIntro 仪式——总时长保持在 1.2s 以下（§5） */
  intro: "1.1s",
  /** reduced-motion 兜底 */
  reduced: "0.15s",
  /** 常用 easing 曲线 */
  ease: {
    smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
    snappy: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

/**
 * 圆角 tokens。
 */
export const RADIUS = {
  sharp: 2,    // 按钮、chip
  default: 3,  // 输入框
  card: 6,     // 卡片、对话框
  pill: 999,   // 备用
} as const;
