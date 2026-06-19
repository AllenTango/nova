import { createTheme } from "@mui/material";

// ── Design Tokens ───────────────────────────────────────────────
// Theme: Star/Nova — every project is a star, site or note
//
// Dark = deep space.  Light = peach daybreak (from memoria/peach).
// Bright mode is not a "light" theme afterthought — it's a real
// counterpart with its own material language.

// ── Breakpoint Tokens ──────────────────────────────────────────────
// Nova 是 Tauri 桌面应用，"断点"对应用户缩小窗口或分屏场景。
// BREAK token 必须与 MUI breakpoints.values 保持同步。
const BREAK = {
  narrow: 768,   // 窗口宽度 < 768px → 侧栏折叠为 icon rail
  medium: 1024,  // 768-1024px → 紧凑侧栏
  wide: 1280,    // >= 1280px → 完整布局
};

const SIDEBAR = {
  wide: 260,     // >= medium (1024px+)
  compact: 200,  // medium (768-1024px)
  rail: 40,      // < narrow (768px) 折叠为 icon rail
};

const STARMAP = {
  // StarMap 高度使用 clamp 替代固定 520px
  height: "clamp(300px, 50vh, 600px)",
};

// ── Motion Tokens ──────────────────────────────────────────────────
const MOTION = {
  fast: "0.15s",
  base: "0.25s",
  slow: "0.4s",
  intro: "1.1s",
  reduced: "0.15s",        // prefers-reduced-motion 兜底
  narrowFactor: 0.5,       // narrow 断点下 transform 时长减半
  ease: {
    smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
    snappy: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
};

const T = {
  // Dark — deep space
  dark: {
    ink: "#0B0B14",       // deep void background
    dust: "#1E1A2E",      // panel background (ΔL ~7% from ink)
    surface: "#2E2940",   // raised surface (ΔL ~7% from dust)
    border: "rgba(232, 228, 255, 0.08)",
    borderStrong: "rgba(232, 228, 255, 0.16)",
    star: "#E8E4FF",      // primary text (starlight, ~15.5:1 AAA)
    starDim: "#B0AAD0",   // secondary text (~6.2:1 AA enhanced)
    starFaint: "#7A7399", // tertiary text (~4.5:1 AA minimum; 0.75rem+)
    nova: "#FF6B6B",      // primary accent (the nova flare, ~5.8:1 AA)
    novaGlow: "rgba(255, 107, 107, 0.15)",
    nebula: "#6B5BFF",    // secondary accent (nebula purple, ~3.5:1 AA large)
    nebulaGlow: "rgba(107, 91, 255, 0.18)",
    backdrop: "#0B0B14",
  },

  // Light — peach daybreak (memoria/peach derived)
  light: {
    ink: "#FBF3E8",       // peach cream background
    dust: "#FFF8EE",      // panel background (slightly lighter)
    surface: "#F5E6D3",   // raised surface (deeper peach)
    border: "rgba(101, 70, 50, 0.10)",
    borderStrong: "rgba(101, 70, 50, 0.20)",
    star: "#3A2A20",      // primary text (warm brown)
    starDim: "#7A5A4A",   // secondary text
    starFaint: "#A88870", // tertiary text
    nova: "#E85A4F",      // primary accent (peach red)
    novaGlow: "rgba(232, 90, 79, 0.12)",
    nebula: "#7A6AE8",    // secondary accent (peach purple)
    nebulaGlow: "rgba(122, 106, 232, 0.14)",
    backdrop: "#FBF3E8",
  },
};

const FONT = {
  display: '"Fraunces", "Songti SC", "STSong", serif',
  body: '"IBM Plex Sans", "PingFang SC", "Hiragino Sans GB", sans-serif',
  mono: '"JetBrains Mono", "Menlo", "Courier New", monospace',
};

const buildTheme = (mode: "dark" | "light") => {
  const t = T[mode];

  return createTheme({
    breakpoints: {
      values: {
        xs: 0,
        sm: BREAK.narrow,   // 768
        md: BREAK.medium,  // 1024
        lg: BREAK.wide,     // 1280
        xl: 1536,
      },
    },
    palette: {
      mode,
      primary: { main: t.nova },
      secondary: { main: t.nebula },
      background: {
        default: t.ink,
        paper: t.dust,
      },
      text: {
        primary: t.star,
        secondary: t.starDim,
        disabled: t.starFaint,
      },
      divider: t.border,
    },
    typography: {
      fontFamily: FONT.body,
      h1: {
        fontFamily: FONT.display,
        fontWeight: 400,
        letterSpacing: "-0.04em",
        fontVariationSettings: '"opsz" 144, "SOFT" 100',
      },
      h2: {
        fontFamily: FONT.display,
        fontWeight: 400,
        letterSpacing: "-0.03em",
        fontVariationSettings: '"opsz" 80, "SOFT" 80',
      },
      h3: {
        fontFamily: FONT.display,
        fontWeight: 500,
        letterSpacing: "-0.02em",
      },
      h4: {
        fontFamily: FONT.display,
        fontWeight: 400,
        letterSpacing: "-0.02em",
        fontVariationSettings: '"opsz" 48, "SOFT" 60',
      },
      h5: {
        fontFamily: FONT.display,
        fontWeight: 500,
      },
      h6: {
        fontFamily: FONT.display,
        fontWeight: 500,
        letterSpacing: "-0.01em",
      },
      body1: { fontSize: "0.95rem", lineHeight: 1.65 },
      body2: { fontSize: "0.85rem", lineHeight: 1.6 },
      button: {
        fontFamily: FONT.body,
        fontWeight: 500,
        textTransform: "none",
        letterSpacing: "0.01em",
      },
      caption: {
        fontFamily: FONT.mono,
        fontSize: "0.72rem",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      },
      overline: {
        fontFamily: FONT.mono,
        fontSize: "0.7rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      },
    },
    shape: {
      borderRadius: 4,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            background: t.backdrop,
            transition: "background-color 0.3s ease",
          },
          body: {
            background: t.ink,
            color: t.star,
            fontFeatureSettings: '"ss01", "cv11"',
            transition: "background-color 0.3s ease, color 0.3s ease",
          },
          "::selection": {
            background: t.nova,
            color: t.ink,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 18,
            paddingRight: 18,
            transition: "all 0.15s ease",
          },
          contained: {
            background: t.nova,
            color: "#FFFFFF",
            boxShadow: "none",
            "&:hover": {
              background: t.nova,
              boxShadow: `0 0 24px ${t.novaGlow}`,
            },
          },
          outlined: {
            borderColor: t.borderStrong,
            color: t.star,
            "&:hover": {
              borderColor: t.nova,
              background: "transparent",
              color: t.nova,
            },
          },
          text: {
            color: t.starDim,
            "&:hover": {
              background: "transparent",
              color: t.star,
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            background: t.dust,
            border: `1px solid ${t.border}`,
            borderRadius: 6,
            backgroundImage: "none",
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: t.starDim,
            borderRadius: 2,
            "&:hover": {
              background: "transparent",
              color: t.nova,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: FONT.mono,
            fontSize: "0.68rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            borderRadius: 2,
            height: 22,
          },
          outlined: {
            borderColor: t.borderStrong,
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 3,
              "& fieldset": { borderColor: t.border },
              "&:hover fieldset": { borderColor: t.borderStrong },
              "&.Mui-focused fieldset": {
                borderColor: t.nova,
                borderWidth: 1,
              },
            },
            "& .MuiInputLabel-root.Mui-focused": { color: t.nova },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          outlined: { borderRadius: 3 },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            background: t.dust,
            borderRight: `1px solid ${t.border}`,
            backgroundImage: "none",
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 3,
            "&.Mui-selected": {
              background: t.novaGlow,
              borderLeft: `2px solid ${t.nova}`,
              "&:hover": { background: t.novaGlow },
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            background: t.dust,
            border: `1px solid ${t.borderStrong}`,
            borderRadius: 6,
            backgroundImage: "none",
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            background: t.nebulaGlow,
            color: t.star,
            border: `1px solid ${t.nebula}`,
          },
        },
      },
    },
  });
};

export const darkTheme = buildTheme("dark");
export const lightTheme = buildTheme("light");
export const tokens = T.dark; // backward-compat default export
export { T, FONT, BREAK, SIDEBAR, STARMAP, MOTION };
