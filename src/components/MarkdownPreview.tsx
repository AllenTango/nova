import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { T, FONT } from "../theme";
import { renderMarkdown } from "./markdown";

/**
 * Live Markdown preview pane.
 *
 * Two layers of work avoidance:
 *  1. We debounce the source by ~120ms — while the user is actively
 *     typing we don't need to re-render on every keystroke.
 *  2. We wrap `dangerouslySetInnerHTML` in a `useRef` + manual set;
 *     React's diff on a large innerHTML string was the single biggest
 *     source of editor jitter on long documents.
 */
export default function MarkdownPreview({
  source,
  placeholder = "从这里开始书写…",
  themeMode,
  debounceMs = 120,
}: {
  source: string;
  placeholder?: string;
  themeMode: "dark" | "light";
  debounceMs?: number;
}) {
  const tokens = T[themeMode];
  const [debouncedSource, setDebouncedSource] = useState(source);
  const html = useMemo(() => renderMarkdown(debouncedSource), [debouncedSource]);
  const ref = useRef<HTMLDivElement>(null);

  // Debounce the incoming source so the preview doesn't re-render
  // on every keystroke while the user is typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSource(source), debounceMs);
    return () => clearTimeout(t);
  }, [source, debounceMs]);

  // Write the rendered HTML directly to the DOM. Avoids React's
  // innerHTML diff on potentially large documents.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  if (!debouncedSource.trim()) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 1,
          color: tokens.starFaint,
        }}
      >
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontStyle: "italic",
            fontSize: "1.2rem",
          }}
        >
          空白
        </Typography>
        <Typography variant="caption">{placeholder}</Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={ref}
      sx={{
        height: "100%",
        overflow: "auto",
        px: 5,
        py: 4,
        color: tokens.star,
        "& h1, & h2, & h3, & h4, & h5, & h6": {
          fontFamily: FONT.display,
          fontWeight: 500,
          color: tokens.star,
          letterSpacing: "-0.02em",
          lineHeight: 1.25,
          marginTop: "1.5em",
          marginBottom: "0.5em",
        },
        "& h1": { fontSize: "2rem", fontWeight: 400 },
        "& h2": { fontSize: "1.5rem" },
        "& h3": { fontSize: "1.2rem" },
        "& p": { lineHeight: 1.8, margin: "0.8em 0" },
        "& a": { color: tokens.nova, textDecoration: "none", borderBottom: `1px dashed ${tokens.nova}` },
        "& a:hover": { borderBottomStyle: "solid" },
        "& code": {
          fontFamily: FONT.mono,
          fontSize: "0.85em",
          background: tokens.surface,
          padding: "0.1em 0.4em",
          borderRadius: 2,
          color: tokens.nova,
        },
        "& pre": {
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: 3,
          padding: "1em",
          overflowX: "auto",
          fontFamily: FONT.mono,
          fontSize: "0.85rem",
          lineHeight: 1.6,
        },
        "& pre code": {
          background: "transparent",
          padding: 0,
          color: tokens.star,
        },
        "& blockquote": {
          borderLeft: `3px solid ${tokens.nova}`,
          paddingLeft: "1em",
          margin: "1em 0",
          color: tokens.starDim,
          fontStyle: "italic",
        },
        "& img": {
          maxWidth: "100%",
          borderRadius: 4,
          margin: "1em 0",
        },
        "& hr": {
          border: "none",
          borderTop: `1px solid ${tokens.border}`,
          margin: "2em 0",
        },
        "& ul, & ol": {
          paddingLeft: "1.5em",
          lineHeight: 1.8,
        },
        "& li": { marginBottom: "0.3em" },
      }}
    />
  );
}
