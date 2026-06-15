import { useEffect, useState } from "react";
import { Box, Typography, Card, CardContent, IconButton, Chip } from "@mui/material";
import { LinkOff as DisconnectIcon, Visibility as OpenIcon } from "@mui/icons-material";
import { T } from "../theme";
import OrbitRing from "./OrbitRing";
import { ProjectInfo } from "../api/client";

/**
 * Two visual modes for cards:
 *
 *   - kind=site  → bright star: warm nova flare, glowing edge on hover
 *   - kind=note  → quiet dim star: outline only, lower flare
 *
 * Magnitude still drives size from updated_at — a "new note" is small
 * but readable; a "freshly written site post" is large and luminous.
 *
 * A card whose id matches a `nova.flash.<id>` sessionStorage flag
 * (set by Dashboard on create) briefly plays a "first light" pulse —
 * the moment your star was born is acknowledged by the card itself.
 *
 * The stage label (game-design §3.2) follows project activity:
 *
 *   星尘  — 刚创建，无内容（来自 sessionStorage flash 而非 updated_at）
 *   星胚  — 1-2 篇内容
 *   新星  — 3+ 篇内容 / 1000+ 字
 *   恒星  — 已升级为站点
 *   星港  — 已部署（kind=site）
 *
 * `wordCount` is supplied by the Dashboard after it sums words across
 * notes/posts for each project. Pass `undefined` to fall back to a
 * purely activity-based label.
 */
function stageFor(p: ProjectInfo, wordCount: number | undefined): {
  size: number;
  flare: number;
  label: string;
  ringStatus: "idle" | "active" | "locked";
} {
  const isSite = p.kind === "site";
  const hours = (Date.now() / 1000 - p.updated_at) / 3600;
  const wc = wordCount ?? 0;

  if (isSite) {
    if (wc >= 1000) return { size: 1.6, flare: 1, label: "星港", ringStatus: "locked" };
    return { size: 1.4, flare: 0.85, label: "恒星", ringStatus: "locked" };
  }
  if (hours < 1) return { size: 1.5, flare: 1, label: "活跃", ringStatus: "active" };
  if (hours < 24) return { size: 1.3, flare: 0.7, label: "新", ringStatus: "active" };
  if (wc >= 1000) return { size: 1.2, flare: 0.5, label: "新星", ringStatus: "active" };
  if (wc > 0) return { size: 1, flare: 0.3, label: "星胚", ringStatus: "active" };
  return { size: 1, flare: 0.15, label: "星尘", ringStatus: "idle" };
}

export default function ProjectCard({
  project,
  wordCount,
  onOpen,
  onDelete,
  themeMode,
}: {
  project: ProjectInfo;
  wordCount?: number;
  onOpen: () => void;
  onDelete: (e: React.MouseEvent) => void;
  themeMode: "dark" | "light";
}) {
  const m = stageFor(project, wordCount);
  const t = T[themeMode];
  const isNote = project.kind === "note";

  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`nova.flash.${project.id}`) === "1") {
        sessionStorage.removeItem(`nova.flash.${project.id}`);
        setFlashing(true);
        const t = setTimeout(() => setFlashing(false), 1400);
        return () => clearTimeout(t);
      }
    } catch {}
  }, [project.id]);

  return (
    <Card
      onClick={onOpen}
      sx={{
        position: "relative",
        cursor: "pointer",
        p: m.size * 1.5,
        opacity: isNote ? 0.85 : 1,
        ...(flashing
          ? {
              animation: "nova-card-flash 1.4s ease-out",
              borderColor: t.nova,
            }
          : {}),
        "&:hover": {
          borderColor: t.nova,
          transform: "translateY(-2px)",
          boxShadow: `0 12px 40px ${t.novaGlow}`,
          opacity: 1,
        },
        "&:hover .project-glow": { opacity: 1 },
      }}
    >
      <Box
        className="project-glow"
        sx={{
          position: "absolute",
          top: m.size * 1.5,
          right: m.size * 1.5,
          width: m.size * 20,
          height: m.size * 20,
          opacity: m.flare,
          transition: "opacity 0.3s ease",
          background: `radial-gradient(circle, ${t.nova} 0%, transparent 70%)`,
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />

      <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5 }}>
          {/* Stage ring — every card has a ring indicating its
              life-cycle stage. Locked for sites, active for fresh
              notes, idle for empty dust. */}
          <OrbitRing
            status={m.ringStatus}
            size={9}
            sx={{ alignSelf: "center", mr: 0.5 }}
          />
          <Typography
            variant="h5"
            sx={{
              fontFamily: "Fraunces, serif",
              fontSize: `${1.15 * m.size}rem`,
              fontWeight: 500,
              color: t.star,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
            }}
          >
            {project.name}
          </Typography>
          {m.label && (
            <Chip
              label={m.label}
              size="small"
              sx={{
                color: t.nova,
                borderColor: t.nova,
                border: "1px solid",
                background: "transparent",
              }}
            />
          )}
        </Box>

        <Typography
          variant="caption"
          sx={{ display: "block", color: t.starFaint, mb: 2 }}
        >
          {isNote ? "笔记" : project.template} · {formatDate(project.updated_at)}
          {wordCount !== undefined && wordCount > 0 && ` · ${wordCount} 字`}
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 0.5,
            opacity: 0,
            transition: "opacity 0.2s ease",
            ".MuiCard-root:hover &": { opacity: 1 },
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            title="进入轨道"
          >
            <OpenIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(e);
            }}
            title="让星体退场"
          >
            <DisconnectIcon fontSize="small" />
          </IconButton>
        </Box>
      </CardContent>

      <style>
        {`
          @keyframes nova-card-flash {
            0%   { box-shadow: 0 0 0 0 ${t.novaGlow}; transform: scale(1); }
            25%  { box-shadow: 0 0 32px 6px ${t.novaGlow}; transform: scale(1.04); }
            100% { box-shadow: 0 0 0 0 ${t.novaGlow}; transform: scale(1); }
          }
        `}
      </style>
    </Card>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
