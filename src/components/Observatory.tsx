import { useEffect, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { T, FONT } from "../theme";
import OrbitRing from "./OrbitRing";
import { api, ProjectInfo, Note, Post } from "../api/client";
import { countWords } from "../lib/words";

/**
 * "天文台" — a small permanent strip at the bottom of the Dashboard
 * that turns the user's activity into astronomical readings.
 *
 * Reads:
 *  - star count (number of projects)
 *  - cumulative word count across all notes & posts
 *  - consecutive days of writing
 *  - longest streak
 *
 * The word count is the *new* number the user can watch grow — the
 * primary way a writer feels progress in a notes app. The streak is
 * the number that keeps them coming back tomorrow.
 */
export default function Observatory({
  projects,
  themeMode,
}: {
  projects: ProjectInfo[];
  themeMode: "dark" | "light";
}) {
  const t = T[themeMode];
  const [stats, setStats] = useState({ words: 0, streak: 0, longest: 0 });

  // Pull every project's notes/posts in parallel to sum word counts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let totalWords = 0;
      const allTimestamps: number[] = [];
      for (const p of projects) {
        try {
          if (p.kind === "note") {
            const ns: Note[] = await api.notes.list(p.path);
            for (const n of ns) {
              totalWords += countWords(n.content);
              allTimestamps.push(p.updated_at);
            }
          } else {
            const ps: Post[] = await api.content.list(p.path);
            for (const post of ps) {
              totalWords += countWords(post.content);
              allTimestamps.push(p.updated_at);
            }
          }
        } catch {
          // best-effort; skip a failing project
        }
      }
      if (!cancelled) {
        const { streak, longest } = computeStreaks(allTimestamps);
        setStats({ words: totalWords, streak, longest });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  return (
    <Box
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: 3,
          px: 3,
          py: 1,
          mb: 1.5,
          background: t.dust,
          border: `1px solid ${t.border}`,
          borderRadius: 1.5,
          boxShadow: `0 4px 24px rgba(0, 0, 0, 0.25)`,
          pointerEvents: "auto",
        }}
      >
        <Reading
          icon="✦"
          value={projects.length}
          label="颗星"
          tooltip="你点亮过的项目数"
          t={t}
        />
        <Divider t={t} />
        <Reading
          icon="✎"
          value={stats.words}
          label="字"
          tooltip="累计书写的中英文混排字数"
          t={t}
        />
        <Divider t={t} />
        <Reading
          icon="☀"
          value={stats.streak}
          label="天"
          tooltip={`连续书写天数 · 历史最长 ${stats.longest} 天`}
          t={t}
        />
        <Divider t={t} />
        {/* Milestone marker — pulses when the user crosses a 5-project
            or first-deploy threshold. game-design §3.3. */}
        <Tooltip
          title={
            stats.streak > 0
              ? `当前连续 ${stats.streak} 天 · 下一个里程碑：${
                  stats.streak >= 7 ? "30 天" : "7 天"
                }`
              : "开始第一个连续书写日"
          }
          placement="top"
          arrow
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <OrbitRing
              status={stats.streak > 0 ? "active" : "idle"}
              size={9}
            />
            <Typography
              variant="caption"
              sx={{
                fontFamily: FONT.mono,
                fontSize: "0.7rem",
                color: t.starFaint,
                letterSpacing: "0.04em",
              }}
            >
              里程碑
            </Typography>
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
}

function Reading({
  icon,
  value,
  label,
  tooltip,
  t,
}: {
  icon: string;
  value: number;
  label: string;
  tooltip: string;
  t: typeof T.dark;
}) {
  return (
    <Tooltip title={tooltip} placement="top" arrow>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          gap: 0.5,
          fontFamily: FONT.mono,
          fontSize: "0.78rem",
          color: t.starDim,
          letterSpacing: "0.04em",
        }}
      >
        <Box component="span" sx={{ color: t.nova, fontSize: "0.9rem" }}>
          {icon}
        </Box>
        <Box component="span" sx={{ color: t.star, fontWeight: 500 }}>
          {value.toLocaleString()}
        </Box>
        <Box component="span" sx={{ color: t.starFaint, fontSize: "0.7rem" }}>
          {label}
        </Box>
      </Box>
    </Tooltip>
  );
}

function Divider({ t }: { t: typeof T.dark }) {
  return (
    <Box
      sx={{
        width: "1px",
        background: t.border,
        alignSelf: "stretch",
      }}
    />
  );
}

function computeStreaks(timestamps: number[]): {
  streak: number;
  longest: number;
} {
  if (timestamps.length === 0) return { streak: 0, longest: 0 };
  const days = Array.from(
    new Set(
      timestamps.map((t) => {
        const d = new Date(t * 1000);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      })
    )
  ).sort();
  if (days.length === 0) return { streak: 0, longest: 0 };

  const dayIndex = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Math.floor(new Date(y, m, d).getTime() / 86400000);
  };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (dayIndex(days[i]) - dayIndex(days[i - 1]) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak: ending today or yesterday
  const today = dayIndex(
    `${new Date().getFullYear()}-${new Date().getMonth()}-${new Date().getDate()}`
  );
  const last = dayIndex(days[days.length - 1]);
  let streak = 0;
  if (today - last <= 1) {
    streak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      if (dayIndex(days[i + 1]) - dayIndex(days[i]) === 1) {
        streak += 1;
      } else {
        break;
      }
    }
  }
  return { streak, longest };
}
