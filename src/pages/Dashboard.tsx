import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import {
  Settings as SettingsIcon,
  LightMode as SunIcon,
  DarkMode as MoonIcon,
} from "@mui/icons-material";
import { api, ProjectKind, isTauri } from "../api/client";
import { T, FONT } from "../theme";
import Starfield from "../components/Starfield";
import Observatory from "../components/Observatory";
import AIChatPanel from "../components/AIChatPanel";
import StarMap from "../components/StarMap";
import { emit } from "../lib/events";
import { countWords } from "../lib/words";

const TEMPLATES = [
  { id: "blog", name: "博客", desc: "记录思考与生活" },
  { id: "gallery", name: "相册", desc: "展示视觉作品（v1 基于博客模板启动）" },
  { id: "vlog", name: "影像日志", desc: "以视频为主要载体（v1 基于博客模板启动）" },
  { id: "blog-gallery", name: "博客 + 相册", desc: "图文并存的混合体（v1 基于博客模板启动）" },
  { id: "corporate", name: "企业官网", desc: "团队、产品、联系（v1 基于博客模板启动）" },
  { id: "agent-home", name: "智能体主页", desc: "Agent 的数字领地（v1 基于博客模板启动）" },
];

export default function Dashboard({
  onSelectProject,
  onOpenSettings,
  themeMode,
  onToggleTheme,
}: {
  onSelectProject: (projectId: string) => void;
  onOpenSettings: () => void;
  themeMode: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ProjectKind>("note");
  const [newTemplate, setNewTemplate] = useState("blog");
  // Cached at mount so toggling this in dev doesn't flicker.
  const inTauriEnv = isTauri();

  const t = T[themeMode];

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    // Skip the IPC round-trip in pure-browser mode so we don't burn
    // retries against a missing __TAURI_INTERNALS__. The web preview
    // still renders EmptyHero with projects=[].
    enabled: isTauri(),
    queryFn: () => api.projects.list(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.projects.create({
        name: newName,
        kind: newKind,
        template: newKind === "site" ? newTemplate : "",
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialogOpen(false);
      setNewName("");

      // Burst at viewport center: a star has just been born.
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      emit({ type: "create", x: cx, y: cy });

      // Every 5th project triggers a meteor shower — a small reward
      // for the user's accumulating practice.
      const total = projects.length + 1;
      if (total > 0 && total % 5 === 0) {
        setTimeout(() => emit({ type: "milestone", threshold: total }), 600);
      }

      // Mark this card so it briefly glows when it first renders.
      if (created?.id) {
        try {
          sessionStorage.setItem(`nova.flash.${created.id}`, "1");
        } catch {}
      }
    },
  });

  const handleCreate = () => {
    if (newName.trim()) {
      createMutation.mutate();
    }
  };

  const notes = projects.filter((p) => p.kind === "note");
  const sites = projects.filter((p) => p.kind === "site");

  // Per-project word count, so cards can show "新星 / 恒星 / 星港"
  // stages (game-design §3.2). Parallel fetch — same shape as
  // Observatory's tally but broken down by project id.
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        projects.map(async (p) => {
          try {
            if (p.kind === "note") {
              const ns = await api.notes.list(p.path);
              next[p.id] = ns.reduce((acc, n) => acc + countWords(n.content), 0);
            } else {
              const ps = await api.content.list(p.path);
              next[p.id] = ps.reduce(
                (acc, post) => acc + countWords(post.content),
                0,
              );
            }
          } catch {
            // best-effort; leave undefined for failing projects
          }
        }),
      );
      if (!cancelled) setWordCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  return (
    <Box sx={{ position: "relative", minHeight: "100vh" }}>
      <Starfield />

      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1200,
          mx: "auto",
          px: { xs: 3, md: 6 },
          py: 4,
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 8,
          }}
        >
          <Typography
            sx={{
              fontFamily: FONT.display,
              fontVariationSettings: '"opsz" 144, "SOFT" 100',
              fontSize: "1.4rem",
              fontWeight: 500,
              color: t.star,
              letterSpacing: "-0.02em",
            }}
          >
            <Box component="span" sx={{ color: t.nova, mr: 0.5 }}>✦</Box>
            nova
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <IconButton onClick={onToggleTheme} aria-label="切换主题">
              {themeMode === "dark" ? <SunIcon /> : <MoonIcon />}
            </IconButton>
            <IconButton onClick={onOpenSettings} aria-label="设置">
              <SettingsIcon />
            </IconButton>
          </Box>
        </Box>

        {/* Hero */}
        {projects.length === 0 ? (
          <EmptyHero onCreate={() => setDialogOpen(true)} t={t} inTauri={inTauriEnv} />
        ) : (
          <ActiveHero
            noteCount={notes.length}
            siteCount={sites.length}
            onCreate={() => setDialogOpen(true)}
            t={t}
            inTauri={inTauriEnv}
          />
        )}

        {/* Projects — true star map (game-design §4.3) */}
        {isLoading ? (
          <Typography sx={{ color: t.starDim, mt: 6 }}>正在观测…</Typography>
        ) : projects.length > 0 ? (
          <Box sx={{ mt: 5 }}>
            <StarMap
              items={projects.map((p) => {
                const wc = wordCounts[p.id] ?? 0;
                // Site upgrade path (§3.2): any site is at least
                // "恒星"; site + 1000+ words becomes "星港". Notes
                // follow the standard mass->stage ladder.
                const stage =
                  p.kind === "site"
                    ? wc >= 1000
                      ? "星港"
                      : "恒星"
                    : wc >= 1000
                      ? "新星"
                      : wc >= 1
                        ? "星胚"
                        : "星尘";
                return {
                  id: p.id,
                  title: p.name,
                  kind: p.kind,
                  mass: { count: wc, stage },
                  updatedAt: p.updated_at,
                };
              })}
              onSelect={onSelectProject}
              themeMode={themeMode}
            />
          </Box>
        ) : null}

        {/* Footer */}
        <Box
          sx={{
            mt: 12,
            mb: 10, // leave room for the Observatory strip
            pt: 4,
            borderTop: `1px solid ${t.border}`,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <Typography
            variant="overline"
            sx={{ color: t.starFaint, fontSize: "0.65rem" }}
          >
            每一颗星，都是一个正在生长的世界
          </Typography>
          <Typography
            variant="overline"
            sx={{ color: t.starFaint, fontSize: "0.65rem" }}
          >
            {projects.length} stars
          </Typography>
        </Box>
      </Box>

      <Observatory projects={projects} themeMode={themeMode} />
      <AIChatPanel
        themeMode={themeMode}
        context={{
          projectTitle: "",
          projectKind: "note",
        }}
      />

      {/* Create dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{
            fontFamily: FONT.display,
            fontWeight: 400,
            fontSize: "1.5rem",
          }}
        >
          命名这颗星
        </DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", mb: 3, mt: 0 }}
          >
            先给它一个名字。你可以现在就把它点亮成站点，也可以先把它当作一份笔记，之后再决定。
          </Typography>

          <TextField
            autoFocus
            placeholder="例如：我的周记、摄影集、产品手册…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            fullWidth
            sx={{ mb: 2.5 }}
          />

          <Typography
            variant="caption"
            sx={{ color: "text.disabled", display: "block", mb: 1 }}
          >
            诞生形态
          </Typography>

          <ToggleButtonGroup
            value={newKind}
            exclusive
            onChange={(_, v) => v && setNewKind(v)}
            fullWidth
            sx={{
              mb: 2.5,
              "& .MuiToggleButton-root": {
                border: "1px solid",
                borderColor: "divider",
                py: 1.5,
                textTransform: "none",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                px: 1.5,
                "&.Mui-selected": {
                  background: "transparent",
                  borderColor: "primary.main",
                  color: "primary.main",
                },
              },
            }}
          >
            <ToggleButton value="note">
              <Box sx={{ textAlign: "left" }}>
                <Typography sx={{ fontWeight: 500 }}>先作为笔记</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  从 Markdown 开始，之后仍可升级为站点
                </Typography>
              </Box>
            </ToggleButton>
            <ToggleButton value="site">
              <Box sx={{ textAlign: "left" }}>
                <Typography sx={{ fontWeight: 500 }}>直接点亮为站点</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  立即获得模板、预览与构建能力
                </Typography>
              </Box>
            </ToggleButton>
          </ToggleButtonGroup>

          {newKind === "site" && (
            <>
              <Typography
                variant="caption"
                sx={{ color: "text.disabled", display: "block", mb: 1 }}
              >
                模板
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 1,
                  mb: 1,
                }}
              >
                {TEMPLATES.map((tpl) => {
                  const selected = newTemplate === tpl.id;
                  return (
                    <Box
                      key={tpl.id}
                      onClick={() => setNewTemplate(tpl.id)}
                      sx={{
                        p: 1.5,
                        cursor: "pointer",
                        border: "1px solid",
                        borderColor: selected
                          ? "primary.main"
                          : "divider",
                        borderRadius: 1,
                        background: selected
                          ? "rgba(255,107,107,0.06)"
                          : "transparent",
                      }}
                    >
                      <Typography
                        sx={{
                          fontWeight: 500,
                          color: selected ? "primary.main" : "text.primary",
                          lineHeight: 1.3,
                        }}
                      >
                        {tpl.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary" }}
                      >
                        {tpl.desc}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            {newKind === "site" ? "点亮为站点" : "开始记录"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function EmptyHero({
  onCreate,
  t,
  inTauri,
}: {
  onCreate: () => void;
  t: typeof T.dark;
  inTauri: boolean;
}) {
  return (
    <Box sx={{ pt: 6, pb: 4 }}>
      <Typography
        sx={{
          fontFamily: FONT.display,
          fontVariationSettings: '"opsz" 144, "SOFT" 100',
          fontSize: { xs: "2.5rem", md: "4rem" },
          lineHeight: 1.05,
          fontWeight: 400,
          color: t.star,
          letterSpacing: "-0.04em",
          maxWidth: 720,
        }}
      >
        把第一篇文字，
        <Box component="span" sx={{ color: t.nova, fontStyle: "italic" }}>
          点亮
        </Box>
        。
      </Typography>
      <Typography
        sx={{
          mt: 2,
          color: t.starDim,
          fontSize: "1.05rem",
          maxWidth: 520,
          lineHeight: 1.6,
        }}
      >
        Nova 是一个建站工具——但更像一本可以生长的笔记。
        从一个名字开始，剩下的交给我们。
      </Typography>
      <Button
        variant="contained"
        size="large"
        onClick={onCreate}
        disabled={!inTauri}
        sx={{ mt: 4, fontSize: "0.95rem", px: 4, py: 1.25 }}
      >
        开始建造
      </Button>
      {!inTauri && (
        <Typography variant="caption" sx={{ display: "block", mt: 2, color: t.starFaint, maxWidth: 480 }}>
          你正在浏览器预览模式下查看 Nova。在 Tauri 桌面应用中运行才能创建、编辑与构建项目。
        </Typography>
      )}
    </Box>
  );
}

function ActiveHero({
  noteCount,
  siteCount,
  onCreate,
  t,
  inTauri,
}: {
  noteCount: number;
  siteCount: number;
  onCreate: () => void;
  t: typeof T.dark;
  inTauri: boolean;
}) {
  const total = noteCount + siteCount;
  return (
    <Box
      sx={{
        pt: 2,
        pb: 4,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 2,
      }}
    >
      <Box>
        <Typography
          variant="overline"
          sx={{ color: t.starFaint, display: "block", mb: 1 }}
        >
          你的星空
        </Typography>
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: { xs: "2rem", md: "2.6rem" },
            lineHeight: 1.1,
            fontWeight: 400,
            color: t.star,
            letterSpacing: "-0.03em",
          }}
        >
          {total} {total === 1 ? "颗星" : "颗星"} · {siteCount} 站 / {noteCount} 笔记
        </Typography>
      </Box>
      <Button variant="outlined" onClick={onCreate} disabled={!inTauri}>
        + 新的星
      </Button>
    </Box>
  );
}
