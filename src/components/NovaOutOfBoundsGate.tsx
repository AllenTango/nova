import { useState, useEffect } from "react";
import { Box, Button, Typography } from "@mui/material";
import { T, FONT } from "../theme";
import { isTauri } from "../api/client";

/**
 * Out-of-bounds gate.
 *
 * In a **production build**, Nova's frontend is intended to be served
 * only inside the Tauri webview. If a user navigates here from an
 * external browser (e.g. `http://localhost:3847` typed into Chrome)
 * the Tauri runtime shims are missing, every invoke() would fail,
 * and the UI would silently render an empty project list.
 *
 * This gate catches that case at the very top of the React tree and
 * shows a single page that explains the situation and points the
 * user back at the desktop app.
 *
 * In **development** (`npm run dev` via vite), the frontend is served
 * straight from the vite dev server on `localhost:1420` and *is*
 * meant to be opened in a browser. So we only enforce the gate in
 * production builds, identified by:
 *
 *   - `import.meta.env.PROD === true`
 *   - `import.meta.env.DEV  === false`
 *
 * The dev server never sets PROD, so this check is naturally false
 * during development and the gate stays invisible.
 *
 * Why not just `!isTauri()` alone? Because external browsers during
 * development are a legitimate use case — vite HMR needs them. The
 * DEV/PROD split keeps the dev experience smooth while still
 * hardening production.
 *
 * ## Dev preview bypass
 *
 * The gate can be force-rendered in development for visual review by
 * appending `?preview-gate` to the URL:
 *
 *   http://localhost:1420/?preview-gate           → show gate
 *   http://localhost:1420/?preview-gate=false     → never show gate
 *   http://localhost:1420/                        → normal dev (no gate)
 *
 * This lets you screenshot the out-of-bounds screen without
 * rebuilding for production. The bypass is dev-only — in a prod
 * build the real `PROD && !isTauri()` check is what blocks.
 *
 * Implementation note: we use `window.location.search` rather than
 * `URLSearchParams` for size (the URL is parsed once on mount).
 */
function shouldBlock(): boolean {
  if (typeof window === "undefined") return false;

  // Dev preview bypass. Explicit `?preview-gate=false` always wins.
  if (window.location.search.includes("preview-gate")) {
    if (window.location.search.includes("preview-gate=false")) return false;
    return true;
  }

  // Real check: production build accessed from outside Tauri.
  return import.meta.env.PROD && !isTauri();
}

export default function NovaOutOfBoundsGate({
  children,
  themeMode,
}: {
  children: React.ReactNode;
  themeMode: "dark" | "light";
}) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (shouldBlock()) {
      setBlocked(true);
    }
  }, []);

  if (!blocked) return <>{children}</>;

  return <OutOfBoundsScreen themeMode={themeMode} />;
}

function OutOfBoundsScreen({ themeMode }: { themeMode: "dark" | "light" }) {
  const t = T[themeMode];
  const [copied, setCopied] = useState(false);

  // Try to copy a launch hint to the clipboard. If it fails (browser
  // without permission, or outside a secure context) we just skip —
  // the screen still tells the user what to do.
  const copyHint = async () => {
    try {
      await navigator.clipboard.writeText(
        "Nova 是桌面应用。请打开 Nova 应用本身，而不是在浏览器里访问。",
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // best-effort only
    }
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at center, ${t.dust} 0%, ${t.ink} 80%)`,
        color: t.star,
        px: 3,
      }}
    >
      <Box
        sx={{
          maxWidth: 480,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: { xs: "2.6rem", md: "3.4rem" },
            fontWeight: 400,
            letterSpacing: "-0.04em",
            color: t.star,
          }}
        >
          <Box component="span" sx={{ color: t.nova, mr: 1 }}>
            ✦
          </Box>
          nova
        </Typography>

        <Typography
          variant="overline"
          sx={{ color: t.starFaint, letterSpacing: "0.16em" }}
        >
          需要在桌面应用内打开
        </Typography>

        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: "1.3rem",
            lineHeight: 1.5,
            color: t.star,
            letterSpacing: "-0.02em",
          }}
        >
          你正在通过外部浏览器访问 Nova 前端。Nova 是一台桌面天文台，
          它的所有交互都运行在本地应用进程中。
        </Typography>

        <Typography
          sx={{
            color: t.starDim,
            fontSize: "0.95rem",
            lineHeight: 1.7,
          }}
        >
          请关闭此浏览器窗口，回到你机器上的{" "}
          <Box component="span" sx={{ color: t.nova, fontWeight: 500 }}>
            Nova 应用
          </Box>
          。所有数据都存放在本地，无需网络访问。
        </Typography>

        <Box
          sx={{
            mt: 2,
            p: 2,
            border: `1px solid ${t.border}`,
            borderRadius: 1,
            background: t.dust,
            textAlign: "left",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: t.starFaint,
              display: "block",
              mb: 0.5,
              fontFamily: FONT.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            为什么会看到这个页面
          </Typography>
          <Typography
            sx={{
              color: t.starDim,
              fontSize: "0.82rem",
              lineHeight: 1.65,
            }}
          >
            生产构建的前端代码假设运行在 Tauri 提供的 WebView
            环境中。此页面仅在外部浏览器直接访问构建产物时出现，
            不会拦截开发模式下的本地调试。
          </Typography>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "center", gap: 1.5, mt: 1 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={copyHint}
            sx={{
              fontFamily: FONT.mono,
              fontSize: "0.78rem",
              letterSpacing: "0.04em",
            }}
          >
            {copied ? "已复制提示" : "复制说明"}
          </Button>
          <Button
            variant="text"
            size="small"
            onClick={() => window.history.back()}
            sx={{ color: t.starDim }}
          >
            返回上一页
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
