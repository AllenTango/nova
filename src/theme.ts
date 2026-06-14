import { createTheme } from "@mui/material";

// ── Design Tokens ───────────────────────────────────────────────
// Theme: Star/Nova — every project is a star, site or note
//
// Dark = deep space.  Light = peach daybreak (from memoria/peach).
// Bright mode is not a "light" theme afterthought — it's a real
// counterpart with its own material language.

const T = {
  // Dark — deep space
  dark: {
    ink: "#0B0B14",       // deep void background
    dust: "#1A1726",      // panel background
    surface: "#2A2538",   // raised surface
    border: "rgba(232, 228, 255, 0.08)",
    borderStrong: "rgba(232, 228, 255, 0.16)",
    star: "#E8E4FF",      // primary text (starlight)
    starDim: "#9A93B8",   // secondary text (distant stars)
    starFaint: "#5C5677", // tertiary text
    nova: "#FF6B6B",      // primary accent (the nova flare)
    novaGlow: "rgba(255, 107, 107, 0.15)",
    nebula: "#6B5BFF",    // secondary accent (nebula purple)
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
export { T, FONT };
