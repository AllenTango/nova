import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { T, FONT } from "../theme";

/**
 * First-launch opening ceremony.
 *
 * Plays once. After it has run, localStorage keeps a flag so we
 * never replay it on the same machine.
 *
 * Sequence (~3.5 seconds):
 *   0.0s  blank void
 *   0.4s  faintest point of light appears at center
 *   1.0s  the word "nova" begins to fade in (italic serif, soft)
 *   2.0s  the typography reaches full intensity
 *   2.6s  a quiet shockwave pushes outward, then the whole
 *         thing dissolves and the dashboard is revealed
 *   3.5s  done.
 *
 * For users with prefers-reduced-motion, the ceremony is
 * reduced to a single 200ms fade-in of the wordmark.
 */
const STORAGE_KEY = "nova.intro.seen";

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
      setTimeout(onDone, 250);
    }, reduced ? 200 : 3500);
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
        animation: "nova-intro-out 0.6s ease 3.1s forwards",
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
        {/* The point of light */}
        <Box
          sx={{
            position: "absolute",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: T.dark.nova,
            boxShadow: `0 0 32px 8px ${T.dark.nova}`,
            animation: "nova-intro-point 1.4s ease-out forwards",
          }}
        />
        {/* The word */}
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: { xs: "3.5rem", md: "5rem" },
            fontWeight: 400,
            color: T.dark.star,
            letterSpacing: "-0.04em",
            fontStyle: "italic",
            fontVariationSettings: '"opsz" 144, "SOFT" 100',
            animation: "nova-intro-word 1.8s ease-out 0.6s both",
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
            30%  { transform: scale(1.2); opacity: 1; }
            60%  { transform: scale(1);   opacity: 1; }
            100% { transform: scale(0.6); opacity: 0.4; }
          }
          @keyframes nova-intro-word {
            0%   { opacity: 0; transform: translateY(8px); letter-spacing: 0; }
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
