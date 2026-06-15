/**
 * Nova Design Tokens — the single source of truth for all visual values
 * that recur across the app.
 *
 * Two layers:
 *   1. COLOR  (`T.dark` / `T.light`) — semantic color palette, mapped to
 *      the cosmology in `docs/game-design.md` §2.1 (Void / Nebula / Corona
 *      / Starlight / etc.).
 *   2. TYPOGRAPHY (`TYPE`) — semantic font tokens. Each token has a size
 *      and a recommended MUI variant / role, matching §2.2's hierarchy.
 *
 * Why this file: components used to hardcode `fontSize: "0.85rem"` etc.
 * across 30+ places. Now they can reference `TYPE.body.size` (or just
 * keep using the MUI variant which already inherits from theme.ts).
 *
 * When to use TYPE tokens directly:
 *   - inside sx={{}} where you need to override Typography's default
 *   - for inline elements (Box component="code", IconButton, etc.)
 *   - for one-off monospace data displays
 *
 * When NOT to use them: just set `variant="body2"` and let MUI inherit.
 */

import { T as _T, FONT as _FONT } from "../theme";

export const T = _T;
export const FONT = _FONT;

/**
 * Typography tokens. Sizes are in rem. Letter-spacing and font-family
 * follow `docs/game-design.md` §2.2.
 */
export const TYPE = {
  /** Display — page-level hero text (e.g. NovaIntro wordmark, ProjectCard hero) */
  display: {
    size: "2.6rem",
    weight: 400,
    letterSpacing: "-0.04em",
    family: FONT.display,
  },
  /** Hero — large section headers (e.g. "Let Nova meet you") */
  hero: {
    size: "2.2rem",
    weight: 400,
    letterSpacing: "-0.03em",
    family: FONT.display,
  },
  /** Title — card / panel headers */
  title: {
    size: "1.4rem",
    weight: 500,
    letterSpacing: "-0.02em",
    family: FONT.display,
  },
  /** Subtitle — secondary headers, dialog titles */
  subtitle: {
    size: "1.05rem",
    weight: 500,
    letterSpacing: "-0.01em",
    family: FONT.display,
  },
  /** Body — standard reading text (MUI body1) */
  body: {
    size: "0.95rem",
    weight: 400,
    family: FONT.body,
    lineHeight: 1.65,
  },
  /** Body small — compact body text (MUI body2) */
  bodySm: {
    size: "0.85rem",
    weight: 400,
    family: FONT.body,
    lineHeight: 1.6,
  },
  /** Mono — port numbers, IDs, model names, telemetry */
  mono: {
    size: "0.8rem",
    weight: 400,
    family: FONT.mono,
  },
  /** Mono small — chip text, captions, micro labels */
  monoSm: {
    size: "0.7rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.06em",
  },
  /** Caption — MUI caption (timestamps, hints) */
  caption: {
    size: "0.72rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  /** Micro — the smallest readable size (overflow hints, badges) */
  micro: {
    size: "0.65rem",
    weight: 400,
    family: FONT.mono,
    letterSpacing: "0.08em",
  },
} as const;

/**
 * Spacing tokens — semantic spacing for the layout rhythm.
 *
 * Components should reach for these instead of writing `p: 3` or `gap: 2`
 * directly, so spacing stays consistent across pages.
 */
export const SPACE = {
  xs: 0.5,   // 4px  — tight inline gaps
  sm: 1,     // 8px  — within a component
  md: 2,     // 16px — between sibling elements
  lg: 3,     // 24px — section separation
  xl: 4,     // 32px — page-level separation
  xxl: 6,    // 48px — hero spacing
} as const;

/**
 * Motion tokens — animation timing, matching §5 motion budget.
 */
export const MOTION = {
  /** Fast micro-interactions (hover, press) */
  fast: "0.15s",
  /** Standard transitions (color, opacity) */
  base: "0.25s",
  /** Slow transitions (size, transform) */
  slow: "0.4s",
  /** NovaIntro ceremony — keep below 1.2s total (§5) */
  intro: "1.1s",
  /** Reduced-motion fallback */
  reduced: "0.15s",
  /** Common easing curves */
  ease: {
    smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
    snappy: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

/**
 * Border radius tokens.
 */
export const RADIUS = {
  sharp: 2,    // buttons, chips
  default: 3,  // inputs
  card: 6,     // cards, dialogs
  pill: 999,   // future use
} as const;
