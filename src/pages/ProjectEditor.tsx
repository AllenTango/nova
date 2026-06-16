import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Button,
  IconButton,
  Drawer,
  TextField,
  Select,
  MenuItem,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  ArrowBack as BackIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Settings as SettingsIcon,
  Visibility as PreviewIcon,
  VisibilityOff as PreviewOffIcon,
  AutoAwesome as SparkIcon,
  RocketLaunch as UpgradeIcon,
} from "@mui/icons-material";
import { api, Note, Post } from "../api/client";
import { T, FONT } from "../theme";
import MarkdownPreview from "../components/MarkdownPreview";
import AIChatPanel from "../components/AIChatPanel";
import OrbitRing from "../components/OrbitRing";
import { emit } from "../lib/events";
import { countWords, formatWordMass, massStageLabel } from "../lib/words";
import { openPath } from "@tauri-apps/plugin-opener";

const SITE_TEMPLATES = [
  { id: "blog", name: "博客" },
  { id: "gallery", name: "相册" },
  { id: "vlog", name: "影像日志" },
  { id: "blog-gallery", name: "博客 + 相册" },
  { id: "corporate", name: "企业官网" },
  { id: "agent-home", name: "智能体主页" },
];

/**
 * 自动保存草稿
 *
 * - key：`nova.draft.{note|post}.{projectId}.{path|"new"}`
 * - 内容：title + content + tags (+ type 仅 post)
 * - 触发：编辑变化后 1500ms debounce
 * - 不与已保存同步：只有用户点「保存/点亮」成功后才清草稿
 * - 生命周期：项目目录切换、关闭页面时保留，purge 才清
 *
 * 范围：仅 ProjectEditor 用。如果未来其他页面需要可以提
 * 升到 `src/lib/drafts.ts`。
 */
interface DraftPayload {
  title: string;
  content: string;
  type: string;
  tags: string;
  savedAt: number;
}

function draftKey(
  kind: "note" | "post",
  projectId: string,
  path: string | null,
): string {
  return `nova.draft.${kind}.${projectId}.${path ?? "new"}`;
}

function readDraft(key: string): DraftPayload | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (typeof parsed.content !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(key: string, payload: DraftPayload): void {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // 容量爆或 SSR——静默 fail，不阻塞用户
  }
}

function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 静默
  }
}

export default function ProjectEditor({
  projectId,
  onBack,
  onOpenSettings,
  themeMode,
}: {
  projectId: string | null;
  onBack: () => void;
  onOpenSettings: () => void;
  themeMode: "dark" | "light";
}) {
  const t = T[themeMode];
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Note | Post | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState("blog");
  const [editTags, setEditTags] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeTemplate, setUpgradeTemplate] = useState("blog");
  const [savedPulse, setSavedPulse] = useState(false);
  const [syncHint, setSyncHint] = useState(false);
  /** 草稿自动保存时间戳；null = 当前选中项无草稿。 */
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  /** 草稿恢复提示：当前选中项有未保存的草稿但又点了同一项。 */
  const [draftPrompt, setDraftPrompt] = useState<DraftPayload | null>(null);
  const [buildResult, setBuildResult] = useState<null | {
    success: boolean;
    outputDir: string;
    message: string;
  }>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  const isSite = project?.kind === "site";

  const { data: notes = [] } = useQuery({
    queryKey: ["notes", project?.path],
    queryFn: () => api.notes.list(project!.path),
    enabled: !!project && project.kind === "note",
  });

  const { data: posts = [] } = useQuery({
    queryKey: ["posts", project?.path],
    queryFn: () => api.content.list(project!.path),
    enabled: !!project && project.kind === "site",
  });

  const items = isSite ? posts : notes;
  const selectedIsNote = !isSite;
  const wordCount = countWords(editContent);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
  });

  const { data: previewStatus } = useQuery({
    queryKey: ["preview-status", project?.path],
    queryFn: () => api.preview.status(),
    refetchInterval: 2000,
    enabled: !!project && project.kind === "site",
  });

  const createNoteMutation = useMutation({
    mutationFn: (vars: { title: string; content: string; tags: string[] }) =>
      api.notes.create({
        projectPath: project!.path,
        title: vars.title,
        content: vars.content,
        tags: vars.tags,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", project?.path] });
      setIsCreating(false);
    },
  });
  const updateNoteMutation = useMutation({
    mutationFn: (vars: { path: string; title: string; content: string; tags: string[] }) =>
      api.notes.update(vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", project?.path] });
    },
  });
  const deleteNoteMutation = useMutation({
    mutationFn: (path: string) => api.notes.delete(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", project?.path] });
      setSelected(null);
    },
  });

  const createPostMutation = useMutation({
    mutationFn: (vars: { title: string; type: string; content: string; tags: string[] }) =>
      api.content.create(
        project!.path,
        vars.title,
        vars.type,
        vars.content,
        vars.tags
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", project?.path] });
      setIsCreating(false);
    },
  });
  const updatePostMutation = useMutation({
    mutationFn: (vars: { path: string; title: string; content: string; tags: string[] }) =>
      api.content.update(vars.path, vars.title, vars.content, vars.tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", project?.path] });
    },
  });
  const deletePostMutation = useMutation({
    mutationFn: (path: string) => api.content.delete(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", project?.path] });
      setSelected(null);
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: () => api.projects.upgradeToSite(projectId!, upgradeTemplate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setUpgradeOpen(false);
      emit({ type: "upgrade", x: window.innerWidth / 2, y: 120 });
    },
  });

  const startPreviewMutation = useMutation({
    mutationFn: () =>
      api.preview.start(project!.path, settings?.preview_port ?? 4321),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preview-status", project?.path] });
    },
  });

  const stopPreviewMutation = useMutation({
    mutationFn: () => api.preview.stop(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preview-status", project?.path] });
    },
  });

  const buildSiteMutation = useMutation({
    mutationFn: () => api.deploy.buildSite(project!.path),
    onSuccess: (result) => {
      setBuildResult({
        success: result.success,
        outputDir: result.output_dir,
        message: result.message,
      });
      if (result.success) {
        emit({ type: "milestone", threshold: 1 });
      }
    },
  });

  useEffect(() => {
    if (selected) {
      setEditTitle(selected.title);
      setEditContent(selected.content);
      if (!selectedIsNote && "type" in selected) setEditType(selected.type);
      setEditTags(selected.tags.join(", "));
    }
  }, [selected, selectedIsNote]);

  // 选项目/选中项变化时检测草稿。同一项重新打开 → 弹 prompt 问是否载入。
  useEffect(() => {
    if (!project) return;
    const kind: "note" | "post" = isSite ? "post" : "note";
    const path = isCreating ? null : selected?.path ?? null;
    const key = draftKey(kind, project.id, path);
    const draft = readDraft(key);
    if (!draft) {
      setDraftSavedAt(null);
      setDraftPrompt(null);
      return;
    }
    // 已暂存但与当前内容一致（用户没改）→ 不弹
    if (
      draft.title === editTitle &&
      draft.content === editContent &&
      draft.tags === editTags &&
      (isSite ? draft.type === editType : true)
    ) {
      setDraftSavedAt(draft.savedAt);
      setDraftPrompt(null);
      return;
    }
    // 未保存的草稿与已加载项不同 → 弹 prompt
    setDraftPrompt(draft);
    setDraftSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, selected?.path, isCreating]);

  // 编辑变化 → 1500ms debounce 写草稿
  const draftDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!project) return;
    // 没选 + 唔新建 → 不存
    if (!isCreating && !selected) return;
    // 内容无变化 → 不存（避免覆盖刚清的草稿）
    if (
      editTitle === "" &&
      editContent === "" &&
      editTags === "" &&
      (isSite ? editType === "blog" : true)
    ) {
      return;
    }
    if (draftDebounceRef.current) window.clearTimeout(draftDebounceRef.current);
    draftDebounceRef.current = window.setTimeout(() => {
      const kind: "note" | "post" = isSite ? "post" : "note";
      const path = isCreating ? null : selected?.path ?? null;
      const key = draftKey(kind, project.id, path);
      writeDraft(key, {
        title: editTitle,
        content: editContent,
        type: editType,
        tags: editTags,
        savedAt: Date.now(),
      });
      setDraftSavedAt(Date.now());
    }, 1500);
    return () => {
      if (draftDebounceRef.current) window.clearTimeout(draftDebounceRef.current);
    };
  }, [project?.id, selected?.path, isCreating, isSite, editTitle, editContent, editType, editTags]);

  /** 载入草稿（点 prompt 上的"载入"按钮） */
  const loadDraft = useCallback((draft: DraftPayload) => {
    setEditTitle(draft.title);
    setEditContent(draft.content);
    setEditType(draft.type);
    setEditTags(draft.tags);
    setDraftPrompt(null);
    setDraftSavedAt(draft.savedAt);
  }, []);

  /** 丢弃草稿 */
  const discardDraft = useCallback(() => {
    if (!project) return;
    const kind: "note" | "post" = isSite ? "post" : "note";
    const path = isCreating ? null : selected?.path ?? null;
    clearDraft(draftKey(kind, project.id, path));
    setDraftPrompt(null);
    setDraftSavedAt(null);
  }, [project, isSite, isCreating, selected?.path]);

  if (!projectId || !project) {
    return (
      <Box sx={{ p: 3 }}>
        <Button startIcon={<BackIcon />} onClick={onBack}>
          返回
        </Button>
        <Typography sx={{ mt: 2 }}>项目未找到</Typography>
      </Box>
    );
  }

  const handleSave = () => {
    if (!selected) return;
    const tags = editTags.split(",").map((s) => s.trim()).filter(Boolean);
    if (selectedIsNote) {
      updateNoteMutation.mutate({
        path: selected.path,
        title: editTitle,
        content: editContent,
        tags,
      });
    } else {
      updatePostMutation.mutate({
        path: selected.path,
        title: editTitle,
        content: editContent,
        tags,
      });
    }
    // 保存成功 → 清草稿（mutation onSuccess 里清，避免失败时丢失）
    if (project) {
      const kind: "note" | "post" = isSite ? "post" : "note";
      clearDraft(draftKey(kind, project.id, selected.path));
    }
    emit({
      type: "save",
      projectId: project.id,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    setSavedPulse(true);
    setSyncHint(true);
    setDraftSavedAt(null);
    window.setTimeout(() => setSavedPulse(false), 900);
    window.setTimeout(() => setSyncHint(false), 1800);
  };

  const handleCreate = () => {
    const tags = editTags.split(",").map((s) => s.trim()).filter(Boolean);
    if (selectedIsNote) {
      createNoteMutation.mutate({
        title: editTitle || "未命名",
        content: editContent,
        tags,
      });
    } else {
      createPostMutation.mutate({
        title: editTitle || "未命名",
        type: editType,
        content: editContent,
        tags,
      });
    }
  };

  const handleDelete = (path: string) => {
    if (selectedIsNote) deleteNoteMutation.mutate(path);
    else deletePostMutation.mutate(path);
  };

  const handleNew = () => {
    setIsCreating(true);
    setSelected(null);
    setEditTitle("");
    setEditContent("");
    setEditType("blog");
    setEditTags("");
  };

  const hasSelection = isCreating || selected;

  return (
    <Box sx={{ display: "flex", height: "100vh", position: "relative" }}>
      {/* Editor deliberately omits the breathing starfield — a constant
          canvas redraw on top of a long-document editor is a stutter
          source. The Dashboard carries the signature; the editor stays
          quiet. */}

      <Drawer
        variant="permanent"
        sx={{
          width: 280,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: 280,
            background: "transparent",
            borderRight: `1px solid ${t.border}`,
          },
        }}
      >
        <Box sx={{ p: 3, position: "relative", zIndex: 1 }}>
          <Button
            startIcon={<BackIcon />}
            onClick={onBack}
            size="small"
            sx={{ mb: 3, color: t.starDim, fontSize: "0.8rem" }}
          >
            星空
          </Button>

          <Box sx={{ mb: 3 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: t.nova,
                boxShadow: `0 0 12px ${t.nova}`,
                mb: 1.5,
                opacity: selectedIsNote ? 0.6 : 1,
              }}
            />
            <Typography
              sx={{
                fontFamily: FONT.display,
                fontSize: "1.3rem",
                fontWeight: 500,
                color: t.star,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              {project.name}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: t.starFaint, display: "block", mt: 0.5 }}
            >
              {selectedIsNote ? "笔记项目" : `${project.template} · 站点`}
            </Typography>
          </Box>

          {selectedIsNote && (
            <Button
              fullWidth
              variant="outlined"
              startIcon={<UpgradeIcon />}
              onClick={() => setUpgradeOpen(true)}
              sx={{ mb: 2, fontSize: "0.8rem" }}
            >
              升级为站点
            </Button>
          )}

          <Divider sx={{ borderColor: t.border, mb: 2 }} />

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 1.5,
            }}
          >
            <Typography variant="overline" sx={{ color: t.starFaint }}>
              {selectedIsNote ? "笔记" : "内容"}
            </Typography>
            <IconButton
              size="small"
              onClick={handleNew}
              sx={{ color: t.nova }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>

          {items.length === 0 ? (
            <Typography
              variant="body2"
              sx={{ color: t.starFaint, fontSize: "0.8rem", py: 2 }}
            >
              还没有{selectedIsNote ? "笔记" : "内容"}。先种下第一篇。
            </Typography>
          ) : (
            <List dense disablePadding>
              {items.map((item) => (
                <ListItem
                  key={item.path}
                  disablePadding
                  sx={{ mb: 0.5 }}
                  secondaryAction={
                    selected?.path === item.path ? (
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(item.path)}
                        title="让条目退场"
                      >
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    ) : null
                  }
                >
                  <ListItemButton
                    selected={selected?.path === item.path}
                    onClick={() => {
                      setSelected(item);
                      setIsCreating(false);
                    }}
                    sx={{ py: 0.75, gap: 1 }}
                  >
                    {/* Active orbit ring marks the currently visited star. */}
                    {selected?.path === item.path && (
                      <OrbitRing status="active" size={6} />
                    )}
                    <ListItemText
                      primary={item.title || "未命名"}
                      slotProps={{
                        primary: {
                          sx: {
                            fontSize: "0.85rem",
                            color: t.star,
                            fontWeight: 400,
                          },
                        },
                      }}
                      secondary={
                        !selectedIsNote && "type" in item ? (
                          <Chip
                            label={typeLabel(String(item.type))}
                            size="small"
                            variant="outlined"
                            sx={{ mt: 0.5, height: 16, fontSize: "0.6rem" }}
                          />
                        ) : undefined
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}

          <Box sx={{ position: "absolute", bottom: 16, left: 24, right: 24 }}>
            <Button
              startIcon={<SettingsIcon fontSize="small" />}
              onClick={onOpenSettings}
              size="small"
              sx={{ color: t.starFaint, fontSize: "0.75rem" }}
            >
              设置
            </Button>
          </Box>
        </Box>
      </Drawer>

      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          zIndex: 1,
        }}
      >
        {hasSelection ? (
          <>
            <Box
              sx={{
                px: 4,
                py: 2.5,
                borderBottom: `1px solid ${t.border}`,
                display: "flex",
                alignItems: "center",
                gap: 1.5,
              }}
            >
              <TextField
                placeholder="标题"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                variant="standard"
                sx={{
                  flex: 1,
                  "& .MuiInput-root": {
                    fontFamily: FONT.display,
                    fontSize: "1.3rem",
                    color: t.star,
                    "&:before": { display: "none" },
                    "&:after": { borderBottomColor: t.nova },
                  },
                  "& input": { padding: 0 },
                }}
              />
              {isCreating && !selectedIsNote && (
                <Select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  size="small"
                  variant="standard"
                  sx={{ fontSize: "0.85rem", minWidth: 100 }}
                >
                  <MenuItem value="blog">博客</MenuItem>
                  <MenuItem value="vlog">影像</MenuItem>
                  <MenuItem value="gallery">相册</MenuItem>
                </Select>
              )}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {/* Save ritual — the button pulses, and a quiet caption
                    confirms the star's mass has been synced to the map. */}
                <Button
                  variant="contained"
                  size="small"
                  onClick={isCreating ? handleCreate : handleSave}
                  sx={savedPulse ? { boxShadow: `0 0 24px ${t.novaGlow}` } : undefined}
                >
                  {isCreating ? "点亮" : savedPulse ? "已点亮" : "保存"}
                </Button>
                <Typography
                  variant="caption"
                  sx={{
                    color: t.nova,
                    fontFamily: FONT.mono,
                    fontSize: "0.7rem",
                    opacity: syncHint ? 1 : 0,
                    transform: syncHint ? "translateX(0)" : "translateX(-6px)",
                    transition: "all 0.3s ease",
                  }}
                >
                  已同步至星图
                </Typography>
              </Box>
              {isSite && !isCreating && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    if (previewStatus?.is_running) stopPreviewMutation.mutate();
                    else startPreviewMutation.mutate();
                  }}
                >
                  {previewStatus?.is_running ? "停止预览" : "启动预览"}
                </Button>
              )}
              {isSite && !isCreating && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => buildSiteMutation.mutate()}
                >
                  构建站点
                </Button>
              )}
              {!isCreating && (
                <Tooltip title={showPreview ? "隐藏预览" : "显示预览"}>
                  <IconButton onClick={() => setShowPreview(!showPreview)}>
                    {showPreview ? <PreviewOffIcon /> : <PreviewIcon />}
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <Box
                sx={{
                  flex: showPreview ? "1 1 50%" : "1 1 100%",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  transition: "flex 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <Box sx={{ px: 4, pt: 2 }}>
                  <TextField
                    placeholder="标签 (逗号分隔)"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    size="small"
                    variant="standard"
                    fullWidth
                    sx={{
                      "& .MuiInput-root": {
                        color: t.starDim,
                        fontSize: "0.8rem",
                        fontFamily: FONT.mono,
                        "&:before": { borderBottomColor: t.border },
                        "&:hover:before": { borderBottomColor: t.borderStrong },
                      },
                    }}
                  />
                </Box>
                <Box sx={{ flex: 1, px: 4, py: 2, overflow: "auto" }}>
                  <TextField
                    placeholder={`在这里书写 ${selectedIsNote ? "笔记" : "内容"}…\n\nMarkdown 语法可用：\n# 标题\n**加粗** *斜体*\n> 引用\n![图片](url)\n[链接](url)`}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    multiline
                    fullWidth
                    variant="standard"
                    sx={{
                      "& .MuiInput-root": {
                        fontFamily: FONT.mono,
                        fontSize: "0.9rem",
                        lineHeight: 1.75,
                        color: t.star,
                        alignItems: "flex-start",
                        "&:before, &:after": { display: "none" },
                      },
                      "& textarea": { padding: 0 },
                    }}
                  />
                </Box>

                {/* Star-mass readout: writing injects mass into the star. */}
                <Box
                  sx={{
                    px: 4,
                    py: 1,
                    borderTop: `1px solid ${t.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 1.5,
                  }}
                >
                  {/* 草稿状态行：编辑变化 → 1500ms debounce 自动暂存 localStorage。 */}
                {draftSavedAt && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: t.starFaint,
                      fontFamily: FONT.mono,
                      fontSize: "0.65rem",
                      letterSpacing: "0.04em",
                      ml: 2,
                    }}
                    title={`本地草稿暂存于 ${new Date(draftSavedAt).toLocaleTimeString()}`}
                  >
                    · 草稿已暂存
                  </Typography>
                )}
                <OrbitRing
                    status={wordCount >= 1000 ? "locked" : wordCount > 0 ? "active" : "idle"}
                    size={7}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      color: t.starFaint,
                      fontFamily: FONT.mono,
                      fontSize: "0.7rem",
                      letterSpacing: "0.04em",
                    }}
                  >
                    星尘质量
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: t.star,
                      fontFamily: FONT.mono,
                      fontSize: "0.75rem",
                      fontWeight: 500,
                    }}
                  >
                    {formatWordMass(wordCount)} 字
                  </Typography>
                  <Chip
                    label={massStageLabel(wordCount)}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: "0.6rem",
                      color: t.nova,
                      borderColor: t.nova,
                      border: "1px solid",
                      background: "transparent",
                    }}
                  />
                </Box>
              </Box>

              {showPreview && (
                <Box
                  sx={{
                    flex: "1 1 50%",
                    borderLeft: `1px solid ${t.border}`,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <Box
                    sx={{
                      px: 3,
                      py: 1.5,
                      borderBottom: `1px solid ${t.border}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <SparkIcon sx={{ fontSize: 14, color: t.nova }} />
                    <Typography
                      variant="overline"
                      sx={{ color: t.starFaint, lineHeight: 1 }}
                    >
                      实时预览
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, overflow: "hidden" }}>
                    {isSite && previewStatus?.is_running && previewStatus.url ? (
                      <iframe
                        title="Astro preview"
                        src={previewStatus.url}
                        style={{ width: "100%", height: "100%", border: 0 }}
                      />
                    ) : (
                      <MarkdownPreview source={editContent} themeMode={themeMode} />
                    )}
                  </Box>
                </Box>
              )}
            </Box>

            {isSite && buildResult && (
              <Box
                sx={{
                  px: 4,
                  py: 1.5,
                  borderTop: `1px solid ${t.border}`,
                  color: buildResult.success ? t.nova : t.starDim,
                  background: t.surface,
                }}
              >
                <Typography variant="overline" sx={{ display: "block", mb: 0.5 }}>
                  {buildResult.success ? "信标已发射" : "构建失败"}
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                  {buildResult.success
                    ? `产物目录：${buildResult.outputDir}`
                    : buildResult.message || "构建失败，请检查日志"}
                </Typography>
                {buildResult.success && (
                  <Box sx={{ mt: 1, display: "flex", gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => openPath(buildResult.outputDir)}
                    >
                      打开产物目录
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigator.clipboard.writeText(buildResult.outputDir)}
                    >
                      复制路径
                    </Button>
                  </Box>
                )}
              </Box>
            )}
          </>
        ) : (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Typography
              sx={{
                fontFamily: FONT.display,
                fontSize: "1.5rem",
                color: t.starDim,
                fontStyle: "italic",
                fontVariationSettings: '"opsz" 60, "SOFT" 100',
              }}
            >
              {selectedIsNote ? "写下第一段思考" : "选一颗星，开始书写"}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: t.starFaint,
                maxWidth: 320,
                textAlign: "center",
              }}
            >
              {selectedIsNote
                ? "从左侧新建笔记，或继续这一段旅程"
                : "从左侧选择一篇内容，或新建一个"}
            </Typography>
          </Box>
        )}
      </Box>

      <Dialog
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: FONT.display, fontWeight: 400, fontSize: "1.5rem" }}>
          点亮为站点
        </DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", mb: 3, mt: 0 }}
          >
            你的笔记将获得一个站点模板，启用实时预览、模板定制与未来的部署能力。
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "text.disabled", display: "block", mb: 1 }}
          >
            模板
          </Typography>
          <Select
            value={upgradeTemplate}
            onChange={(e) => setUpgradeTemplate(e.target.value)}
            fullWidth
            size="small"
          >
            {SITE_TEMPLATES.map((tpl) => (
              <MenuItem key={tpl.id} value={tpl.id}>
                {tpl.name}
              </MenuItem>
            ))}
          </Select>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setUpgradeOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={() => upgradeMutation.mutate()}
          >
            点亮
          </Button>
        </DialogActions>
      </Dialog>

      {/* 草稿恢复提示：检测到未保存的草稿，问用户载入还是丢弃。 */}
      <Dialog
        open={!!draftPrompt}
        onClose={() => discardDraft()}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: FONT.display, fontWeight: 400, fontSize: "1.3rem" }}>
          检测到未保存的草稿
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {draftPrompt && (
              <>
                你的「{project.name}」里有 {Math.round(
                  (Date.now() - draftPrompt.savedAt) / 60000,
                )} 分钟前的本地暂存。是否载入？
              </>
            )}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => discardDraft()}>丢弃</Button>
          <Button
            variant="contained"
            onClick={() => draftPrompt && loadDraft(draftPrompt)}
          >
            载入草稿
          </Button>
        </DialogActions>
      </Dialog>

      <AIChatPanel
        themeMode={themeMode}
        context={{
          projectTitle: project.name,
          projectKind: project.kind as "note" | "site",
          contentTitle: editTitle || undefined,
          contentType: !selectedIsNote ? editType : undefined,
          tags: editTags.split(",").map((s) => s.trim()).filter(Boolean),
          content: editContent || undefined,
        }}
      />
    </Box>
  );
}

function typeLabel(t: string) {
  return { blog: "博客", vlog: "影像", gallery: "相册" }[t] || t;
}
