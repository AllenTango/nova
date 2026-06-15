import { useState, useEffect } from "react";
import { Box, Button, Typography } from "@mui/material";
import { T, FONT } from "../theme";
import { isTauri } from "../api/client";

/**
 * 越界 gate。
 *
 * 在**生产构建**中，Nova 的前端仅设计为在 Tauri webview 内被加载。
 * 如果用户从外部浏览器访问（如在 Chrome 输 `http://localhost:3847`），
 * Tauri runtime shim 不存在，每个 invoke() 都会失败，UI 静默渲染
 * 一个空项目列表。
 *
 * 此 gate 在 React 树最顶端拦住这种情况，展示一个说明页面，
 * 引导用户回到桌面应用。
 *
 * 在**开发态**（vite 启动的 `npm run dev`），前端由 vite dev server
 * 跑在 `localhost:1420`，本来就是要用浏览器打开。所以只在生产
 * 构建里强制 gate，识别方式：
 *
 *   - `import.meta.env.PROD === true`
 *   - `import.meta.env.DEV  === false`
 *
 * dev server 永不设 PROD，所以这个 check 在开发态自然为 false，
 * gate 保持隐形。
 *
 * 为何不直接用 `!isTauri()`：因为 dev 期间用外部浏览器是合法场景
 * —— vite HMR 需要它。DEV/PROD 切分既保开发体验顺滑，又加固生产。
 *
 * ## 开发态预览旁路
 *
 * 开发态可通过 URL 追加 `?preview-gate` 强制渲染 gate 做视觉评审：
 *
 *   http://localhost:1420/?preview-gate           → 显示 gate
 *   http://localhost:1420/?preview-gate=false     → 不显示 gate
 *   http://localhost:1420/                        → 正常 dev（不拦）
 *
 * 这样无需为生产构建打包就能截到越界页面的图。旁路仅开发态有效
 * ——生产构建里真正起作用的是 `PROD && !isTauri()` 这条检查。
 *
 * 实现细节：用 `window.location.search` 而非 `URLSearchParams`
 * （URL 只在 mount 时解析一次，少几行）。
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
