import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { T, FONT } from "../theme";

/**
 * First-launch opening ceremony.
 *
 * Plays once. After it has run, localStorage keeps a flag so we
 * never replay it on the same machine.
 *
 * Budget: ≤ 1.2 seconds end-to-end (game-design §5 motion budget).
 *
 * Sequence (~1.1 seconds total):
 *   0.00s  blank void
 *   0.10s  point of light scales in (200ms ease-out)
 *   0.30s  wordmark "✦ nova" fades in (500ms ease-out)
 *   0.80s  whole overlay dissolves (300ms ease-in)
 *   1.10s  done — dashboard is revealed
 *
 * For users with prefers-reduced-motion, the ceremony is
 * reduced to a single 150ms fade-in of the wordmark.
 */
const STORAGE_KEY = "nova.intro.seen";
const TOTAL_MS = 1100;

export default function NovaIntro({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY) === "1") {
      onDone();
      return;
    }
    setVisible(true);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const done = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, "1");
      setVisible(false);
      // Let the dissolve animation finish before unmounting so the
      // dashboard doesn't flash in over the wordmark.
      setTimeout(onDone, reduced ? 0 : 320);
    }, reduced ? 150 : TOTAL_MS);
    return () => clearTimeout(done);
  }, [onDone]);

  if (!visible) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: T.dark.ink,
        animation: "nova-intro-out 0.3s ease-in 0.8s forwards",
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* The point of light — pulses in, then dims as the word takes over */}
        <Box
          sx={{
            position: "absolute",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: T.dark.nova,
            boxShadow: `0 0 24px 6px ${T.dark.nova}`,
            animation: "nova-intro-point 0.5s ease-out 0.1s forwards",
          }}
        />
        {/* The wordmark */}
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: { xs: "3.2rem", md: "4.4rem" },
            fontWeight: 400,
            color: T.dark.star,
            letterSpacing: "-0.04em",
            fontStyle: "italic",
            fontVariationSettings: '"opsz" 144, "SOFT" 100',
            animation: "nova-intro-word 0.5s ease-out 0.3s both",
          }}
        >
          <Box component="span" sx={{ color: T.dark.nova }}>
            ✦
          </Box>{" "}
          nova
        </Typography>
      </Box>
      <style>
        {`
          @keyframes nova-intro-point {
            0%   { transform: scale(0.2); opacity: 0; }
            60%  { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(0.5); opacity: 0.3; }
          }
          @keyframes nova-intro-word {
            0%   { opacity: 0; transform: translateY(6px); letter-spacing: 0; }
            100% { opacity: 1; transform: translateY(0);   letter-spacing: -0.04em; }
          }
          @keyframes nova-intro-out {
            0%   { opacity: 1; }
            100% { opacity: 0; }
          }
        `}
      </style>
    </Box>
  );
}
