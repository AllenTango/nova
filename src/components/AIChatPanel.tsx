import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import {
  Send as SendIcon,
  Close as CloseIcon,
  SwapHoriz as SwitchIcon,
} from "@mui/icons-material";
import { api, ProviderEntry, Settings, isTauri } from "../api/client";
import { T, FONT } from "../theme";
import OrbitRing from "./OrbitRing";
import { useLocalAI } from "../hooks/useLocalAI";

type PanelContext = {
  projectTitle: string;
  projectKind: "note" | "site";
  contentTitle?: string;
  contentType?: string;
  tags?: string[];
  content?: string;
};

// Stable shim used when real settings haven't loaded yet — keeps the
// useLocalAI hook order deterministic so React doesn't throw
// "Rendered more hooks than during the previous render."
const EMPTY_SETTINGS: Settings = {
  nova_port: 18999,
  preview_port: 4321,
  theme: "dark",
};

export default function AIChatPanel({
  themeMode,
  context,
}: {
  themeMode: "dark" | "light";
  context: PanelContext;
}) {
  const t = T[themeMode];
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<ProviderEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [sessionToken, setSessionToken] = useState<string>("");
  const [, setSystemPrompt] = useState<string>("");

  useEffect(() => {
    if (!isTauri()) return;
    // Fetch in parallel — Settings (for nova_port + sessionToken) and
    // the provider list. We only block the chat switcher on the
    // providers list; everything else stays optimistic.
    api.settings
      .get()
      .then((s) => {
        setSettings(s);
        return api.settings.getSessionToken();
      })
      .then((token) => setSessionToken(token))
      .catch(() => {});
    api.providers
      .list()
      .then((list) => {
        setOptions(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const inProject = Boolean(context.projectTitle);
  const activeOption = useMemo(
    () => options.find((o) => o.id === selectedId) ?? options[0],
    [options, selectedId]
  );

  // Build system prompt from context
  useEffect(() => {
    if (!settings) return;
    const parts = [
      `你是 Nova 的副官。`,
      inProject ? `当前项目：${context.projectTitle}` : `当前位于 Nova 星图总览界面。`,
      inProject
        ? `项目类型：${context.projectKind === "note" ? "纯笔记项目" : "站点项目"}`
        : `当前任务更偏向：命名项目、选择模板、判断先建笔记还是站点、规划下一步。`,
      context.contentTitle ? `当前内容标题：${context.contentTitle}` : "",
      context.contentType ? `当前内容类型：${context.contentType}` : "",
      context.tags && context.tags.length > 0
        ? `当前标签：${context.tags.join(", ")}`
        : "",
      context.content
        ? `当前内容正文（节选）：\n${context.content.slice(0, 1800)}`
        : "",
      `回答应该简洁、可执行，优先围绕命名、结构、标签、模板、发布和下一步建议。`,
    ].filter(Boolean);
    setSystemPrompt(parts.join("\n\n"));
  }, [settings, context]);

  const maybeHandleCommand = () => {
    const cmd = input.trim();
    if (cmd === "/switch" || cmd === "/providers") {
      setShowSwitcher(true);
      return true;
    }
    return false;
  };

  // useLocalAI for streaming chat. The hook must always be called in
  // the same order every render, so we feed it a stable default
  // settings shim before real settings load — `useLocalAI` itself
  // treats empty/disabled settings as "no chat possible" and stays
  // inert until the real ones arrive.
  const localAI = useLocalAI({
    settings: settings ?? EMPTY_SETTINGS,
    sessionToken,
    overrides: activeOption
      ? {
          provider: activeOption.family,
          model: activeOption.model,
          base_url: activeOption.base_url,
          // Hand the Rust side the registry id; it pulls the api_key
          // from the secrets file (or env) so the frontend never sees
          // the credential in plaintext.
          provider_id: activeOption.id,
        }
      : undefined,
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || localAI.isLoading || !settings) return;
    if (maybeHandleCommand()) {
      setInput("");
      return;
    }
    // Submit to useChat - the hook handles streaming internally
    localAI.handleSubmit(e);
    setInput("");
  };

  return (
    <Box
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          width: "min(960px, calc(100vw - 24px))",
          mb: 1.5,
          background: t.dust,
          border: `1px solid ${t.border}`,
          borderRadius: 1.5,
          boxShadow: `0 6px 28px rgba(0,0,0,0.25)`,
          overflow: "hidden",
          pointerEvents: "auto",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {/* Locked ring — this is the AI 副官's currently bound
                comm link. Per game-design §2.3 / §4.2, a pulsing locked
                ring signals the active channel. */}
            {activeOption && (
              <OrbitRing status="locked" size={9} />
            )}
            <Typography
              variant="overline"
              sx={{ color: t.starFaint, fontFamily: FONT.mono }}
            >
              副官
            </Typography>
            {activeOption && (
              <Typography variant="caption" sx={{ color: t.nova }}>
                {activeOption.label}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {!open && (
              <Typography variant="caption" sx={{ color: t.starFaint }}>
                {!inProject
                  ? "需要命名、模板选择或创作方向建议？"
                  : context.projectKind === "note"
                    ? "需要标题、结构、标签或'是否该升级为站点'的建议？"
                    : "需要标题、结构、标签或发布建议？"}
              </Typography>
            )}
            <Button size="small" onClick={() => setOpen((v) => !v)}>
              {open ? "收起" : "展开"}
            </Button>
            {open && (
              <IconButton size="small" onClick={() => setOpen(false)}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
        </Box>
        {open && (
          <>
            <Divider sx={{ borderColor: t.border }} />
            <Box sx={{ p: 2, display: "grid", gap: 1.5 }}>
              {showSwitcher && (
                <Box sx={{ border: `1px solid ${t.border}`, borderRadius: 1, overflow: "hidden" }}>
                  <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <SwitchIcon sx={{ fontSize: 14, color: t.nova }} />
                    <Typography variant="overline" sx={{ color: t.starFaint }}>
                      已配置供应商
                    </Typography>
                  </Box>
                  <List dense disablePadding>
                    {options.map((option) => (
                      <ListItemButton
                        key={option.id}
                        selected={option.id === selectedId}
                        onClick={() => {
                          setSelectedId(option.id);
                          setShowSwitcher(false);
                        }}
                      >
                        <ListItemText
                          primary={option.label}
                          secondary={`${option.family} · ${option.base_url || "(默认 URL)"}`}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                </Box>
              )}

              <Box component="form" onSubmit={handleSend} sx={{ display: "grid", gap: 1.5 }}>
                <TextField
                  multiline
                  minRows={3}
                  placeholder={
                    inProject
                      ? "例如：帮我给这篇内容起一个更像博客标题的标题，或建议 3 个标签。输入 /switch 切换已配置供应商。"
                      : "例如：我想做一个摄影日志，帮我起 5 个项目名字，并推荐一个模板。输入 /switch 切换已配置供应商。"
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  fullWidth
                />
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {inProject ? (
                      <>
                        <Button size="small" variant="outlined" onClick={() => setInput("基于当前内容与语气，给我 3 个更合适的标题")}>标题建议</Button>
                        <Button size="small" variant="outlined" onClick={() => setInput("基于当前内容建议 5 个标签，并说明每个标签的含义")}>标签建议</Button>
                        <Button size="small" variant="outlined" onClick={() => setInput(context.projectKind === "note" ? "判断这份笔记是否适合升级为站点内容，并说明原因" : "判断这篇内容是否适合发布到站点首页，并说明原因")}>发布判断</Button>
                      </>
                    ) : (
                      <>
                        <Button size="small" variant="outlined" onClick={() => setInput("根据我的创作方向，帮我想 5 个项目名字")}>命名建议</Button>
                        <Button size="small" variant="outlined" onClick={() => setInput("我应该先创建纯笔记项目还是站点项目？请给判断标准")}>类型判断</Button>
                        <Button size="small" variant="outlined" onClick={() => setInput("根据我的需求，推荐一个模板并说明原因")}>模板推荐</Button>
                      </>
                    )}
                  </Box>
                  <Button
                    type="submit"
                    variant="contained"
                    endIcon={localAI?.isLoading ? <CircularProgress size={14} color="inherit" /> : <SendIcon />}
                    disabled={localAI?.isLoading || !input.trim()}
                  >
                    发送
                  </Button>
                </Box>
              </Box>

              {/* Streaming message display */}
              {localAI?.messages && localAI.messages.length > 0 && (
                <Box
                  sx={{
                    border: `1px solid ${t.border}`,
                    borderRadius: 1,
                    p: 1.5,
                    color: t.star,
                    background: t.surface,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    fontSize: "0.9rem",
                  }}
                >
                  {localAI.messages.map((msg, i) => (
                    <Box key={i}>
                      {msg.role === "user" && (
                        <Typography variant="caption" sx={{ color: t.nova, display: "block", mb: 0.5 }}>
                          你：
                        </Typography>
                      )}
                      {msg.content}
                      {i < (localAI?.messages?.length ?? 0) - 1 && <Divider sx={{ my: 1, borderColor: t.border }} />}
                    </Box>
                  ))}
                  {localAI?.isLoading && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                      <CircularProgress size={10} sx={{ color: t.nova }} />
                      <Typography variant="caption" sx={{ color: t.starFaint }}>
                        生成中...
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}

              {localAI?.error && (
                <Box
                  sx={{
                    border: `1px solid ${t.border}`,
                    borderRadius: 1,
                    p: 1.5,
                    color: "error.main",
                    background: t.surface,
                    whiteSpace: "pre-wrap",
                    fontSize: "0.85rem",
                  }}
                >
                  {localAI?.error?.message || String(localAI?.error)}
                </Box>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}