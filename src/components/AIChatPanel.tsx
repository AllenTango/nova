import { useCallback, useEffect, useRef, useState } from "react";
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
import { api, ProviderEntry, Settings } from "../api/client";
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

// useLocalAI no longer needs Settings or a session token — Tauri IPC
// handles auth internally. The old EMPTY_SETTINGS shim is kept here
// only because `Settings` is still imported elsewhere in the file;
// remove it once that import goes away.

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
  // ADR 0003：default 是 chat 嘅唯一权威（NovaConfig.default_*_id）。
  // `selectedId` 仅做 UI display 用途——必须同 default.providerId
  // 同步，否则 top bar 显示嘅「链路 ID」会同实际 chat 用嘅链路不一致。
  const [selectedId, setSelectedId] = useState<string>("");
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  // ADR 0003 §3.6：副官 `/switch` 两段式状态机。先列 provider，
  // 选中后实时调 `list_models` 拉候选 model，用户选 model 后调
  // `set_default_model` 写入 default。
  type SwitcherStep =
    | { kind: "closed" }
    | { kind: "pick_provider" }
    | {
        kind: "pick_model";
        providerId: string;
        providerLabel: string;
        models: string[];
        loading: boolean;
        error?: string;
      }
    | { kind: "error"; message: string };
  const [switcherStep, setSwitcherStep] = useState<SwitcherStep>({ kind: "closed" });
  const [, setSystemPrompt] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 拉 default 状态（ADR 0003 §3.5 单一权威来源）。
  // 刷新时机：(1) hydration 一次；(2) /switch pick_model 后；
  // (3) Settings UI set_default 后（同 session 跨 component 需 refresh）。
  const refreshDefault = useCallback(async () => {
    try {
      const d = await api.ai.getDefault();
      if (d) {
        // Bug A fix：wire format snake_case（Rust serialize 默认），
        // 唔系 camelCase——之前 `d.providerId` 永远 undefined。
        setDefaultProviderId(d.provider_id);
        setDefaultModelId(d.model_id);
        if (d.provider_id) setSelectedId(d.provider_id);
      }
    } catch {
      // 默认值已经系 null，唔需要处理
    }
  }, []);

  useEffect(() => {
    // 拉 Settings（用来 gate 系统 prompt 构建和发送 handler）和
    // provider 列表（chat 切换器用）。session token 唔再用——
    // IPC auth 由 Tauri webview 内部处理。
    api.settings
      .get()
      .then((s) => setSettings(s))
      .catch(() => {});
    api.providers
      .list()
      .then((list) => {
        setOptions(list);
        if (list[0]) setSelectedId(list[0].id);
      })
      .catch(() => {});
    // 拉 default 状态——这一步系同步 selectedId 同 default.providerId
    // 嘅关键。Stage 3 fix：之前 top bar 显示 activeOption.id/model 系错嘅。
    refreshDefault();
  }, [refreshDefault]);

  const inProject = Boolean(context.projectTitle);
  // ADR 0003：top bar 同 chat 路径都直接用 default_*_id；activeOption
  // 仅作 `/switch` pick_provider 阶段嘅「当前 selected provider」参考，
  // 唔再参与 chat 决策。

  // 从 context 拼出系统 prompt
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
      setSwitcherStep({ kind: "pick_provider" });
      return true;
    }
    return false;
  };

  // Stage 3：副官 `/switch` 第二段——选 provider 后实时拉 model 列表。
  // 不缓存（ADR 0003 §3.6）：供应商 model 随时变动，每次 fetch fresh。
  const pickProvider = async (providerId: string, label: string) => {
    setSwitcherStep({
      kind: "pick_model",
      providerId,
      providerLabel: label,
      models: [],
      loading: true,
    });
    try {
      const models = await api.providers.listModels(providerId);
      setSwitcherStep({
        kind: "pick_model",
        providerId,
        providerLabel: label,
        models,
        loading: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwitcherStep({
        kind: "pick_model",
        providerId,
        providerLabel: label,
        models: [],
        loading: false,
        error: msg,
      });
    }
  };

  // Stage 3：选 model 后写入 default（调用 `set_default_model` Tauri
  // command）并关闭 switcher。**ADR 0003 fix**：set_default 后必须
  // refreshDefault 同步 local default state + selectedId，否则 top bar
  // 显示嘅链路 ID 同 chat 实际用嘅链路唔一致（user 报告嘅 bug）。
  const pickModel = async (modelId: string) => {
    if (switcherStep.kind !== "pick_model") return;
    try {
      await api.ai.setDefault(switcherStep.providerId, modelId);
      await refreshDefault();
      setSwitcherStep({ kind: "closed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSwitcherStep({ kind: "error", message: msg });
    }
  };

  // 流式 chat。Tauri 2 IPC + Channel——hook 不再需要 Settings
  // （无 localhost 端口要 dial）也不需要 sessionToken（IPC 走
  // Tauri webview 自带的权限模型）。
//
// **ADR 0003 修正**：Stage 3 之前传入 `activeOption` 当 overrides，
// 但 `overrides.model` 会覆盖 `NovaConfig.default_model_id`——
// 即用户喺 `/switch` 切咗新 model 之后 default 已更新，但
// `activeOption.model` 仲系旧 entry 嘅 model 字段，inline override
// 会把新 default 覆盖返去旧值，导致 chat 用旧 model 调上游可能 404。
//
// 修复：**完全不传 overrides**，让 Rust 完全走 default 路径。
// `activeOption` 仅作 UI display（top bar + switcher 列表）用途。
  const localAI = useLocalAI(undefined);

  // 流式期间自动滚到最新一条。
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localAI.messages, localAI.isLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || localAI.isLoading || !settings) return;
    if (maybeHandleCommand()) {
      setInput("");
      localAI.setInput("");
      return;
    }
    // 直接传 input 文本，不依赖 hook 内部 state（React batching 会导致闭包 stale）。
    localAI.handleSubmit(input, e);
    setInput("");
    localAI.setInput("");
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
            {defaultProviderId ? (
              <OrbitRing status="locked" size={9} />
            ) : (
              <OrbitRing status="active" size={9} />
            )}
            <Typography
              variant="overline"
              sx={{ color: t.starFaint, fontFamily: FONT.mono }}
            >
              副官 · 通讯链路
            </Typography>
            {/* ADR 0003：top bar 必须显示 NovaConfig.default_*_id，
                唔系 `activeOption.{id,model}`（两者可能唔一致——
                比如用户喺 `/switch` 切咗新 model，但 activeOption
                仲系旧 supplier）。 */}
            {defaultProviderId && defaultModelId ? (
              <Typography variant="caption" sx={{ color: t.nova, fontFamily: FONT.mono }}>
                {defaultProviderId} / {defaultModelId}
              </Typography>
            ) : (
              <Typography variant="caption" sx={{ color: t.starFaint, fontFamily: FONT.mono }}>
                未设置默认模型（输入 /switch 选取或去 Settings）
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
              {switcherStep.kind !== "closed" && (
                <Box sx={{ border: `1px solid ${t.border}`, borderRadius: 1, overflow: "hidden" }}>
                  <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <SwitchIcon sx={{ fontSize: 14, color: t.nova }} />
                    <Typography variant="overline" sx={{ color: t.starFaint }}>
                      {switcherStep.kind === "pick_provider"
                        ? "切换链路 · 选择供应商"
                        : switcherStep.kind === "pick_model"
                        ? `切换链路 · ${switcherStep.providerLabel} · 选择模型`
                        : "切换链路 · 错误"}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" onClick={() => setSwitcherStep({ kind: "closed" })}>
                      关闭
                    </Button>
                  </Box>
                  {switcherStep.kind === "pick_provider" && (
                    <List dense disablePadding>
                      {options.length === 0 && (
                        <Box sx={{ px: 1.5, py: 1 }}>
                          <Typography variant="caption" sx={{ color: t.starFaint }}>
                            暂无可用供应商——去 Settings 添加
                          </Typography>
                        </Box>
                      )}
                      {options.map((option) => (
                        <ListItemButton
                          key={option.id}
                          selected={option.id === selectedId}
                          onClick={() => pickProvider(option.id, option.label)}
                        >
                          <ListItemText
                            primary={option.label}
                            secondary={`${option.family} · ${option.base_url || "(默认 URL)"}`}
                          />
                        </ListItemButton>
                      ))}
                    </List>
                  )}
                  {switcherStep.kind === "pick_model" && (
                    <Box sx={{ px: 1.5, py: 1, display: "grid", gap: 1 }}>
                      {switcherStep.loading && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <CircularProgress size={12} sx={{ color: t.nova }} />
                          <Typography variant="caption" sx={{ color: t.starFaint }}>
                            正在从供应商拉取模型…
                          </Typography>
                        </Box>
                      )}
                      {switcherStep.error && (
                        <Typography variant="caption" sx={{ color: "error.main" }}>
                          {switcherStep.error}
                        </Typography>
                      )}
                      {!switcherStep.loading && !switcherStep.error && switcherStep.models.length === 0 && (
                        <Typography variant="caption" sx={{ color: t.starFaint }}>
                          未拉到任何模型
                        </Typography>
                      )}
                      <List dense disablePadding>
                        {switcherStep.models.map((modelId) => (
                          <ListItemButton key={modelId} onClick={() => pickModel(modelId)}>
                            <ListItemText primary={modelId} />
                          </ListItemButton>
                        ))}
                      </List>
                    </Box>
                  )}
                  {switcherStep.kind === "error" && (
                    <Box sx={{ px: 1.5, py: 1 }}>
                      <Typography variant="caption" sx={{ color: "error.main" }}>
                        {switcherStep.message}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}

              <Box component="form" onSubmit={handleSend} sx={{ display: "grid", gap: 1.5 }}>
                {/* Command-line style prompt — the `>` prefix reads
                    as a terminal, signaling the chat is a side-channel
                    rather than a chat bubble. */}
                <TextField
                  multiline
                  minRows={3}
                  placeholder={
                    inProject
                      ? "例如：帮我给这篇内容起一个更像博客标题的标题，或建议 3 个标签。\n输入 /switch 切换已配置供应商。"
                      : "例如：我想做一个摄影日志，帮我起 5 个项目名字，并推荐一个模板。\n输入 /switch 切换已配置供应商。"
                  }
                  value={input}
                  onChange={(e) => {
                    // 同步两份 input state：panel 自己嘅（用于 submit
                    // guard、placeholder 逻辑）同 hook 内部嘅（hook 嘅
                    // handleSubmit 只睇自己嘅 input）。
                    const v = e.target.value;
                    setInput(v);
                    localAI.setInput(v);
                  }}
                  fullWidth
                  slotProps={{
                    input: {
                      startAdornment: (
                        <Box
                          aria-hidden
                          sx={{
                            color: t.nova,
                            fontFamily: FONT.mono,
                            fontSize: "0.95rem",
                            mr: 1,
                            alignSelf: "flex-start",
                            pt: 0.5,
                            userSelect: "none",
                          }}
                        >
                          &gt;
                        </Box>
                      ),
                    },
                  }}
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
                  {/* "发射" button — per game-design §4.2, a launch
                      control that briefly charges on hover. */}
                  <Button
                    type="submit"
                    variant="contained"
                    endIcon={localAI?.isLoading ? <CircularProgress size={14} color="inherit" /> : <SendIcon />}
                    disabled={localAI?.isLoading || !input.trim()}
                    sx={{
                      transition: "all 0.2s ease",
                      "&:hover": {
                        boxShadow: `0 0 24px ${t.novaGlow}`,
                        transform: "translateX(2px)",
                      },
                    }}
                  >
                    发射
                  </Button>
                </Box>
              </Box>

              {/* Ship's log — every exchange is a transmission. */}
              {localAI?.messages && localAI.messages.length > 0 ? (
                <Box
                  sx={{
                    border: `1px solid ${t.border}`,
                    borderRadius: 1,
                    p: 1.5,
                    color: t.star,
                    background: t.surface,
                    maxHeight: 360,
                    overflowY: "auto",
                    display: "grid",
                    gap: 1.5,
                  }}
                >
                  {localAI.messages.map((msg, i) => (
                    <Box
                      key={i}
                      sx={{
                        display: "flex",
                        gap: 1,
                        flexDirection: msg.role === "user" ? "row-reverse" : "row",
                        alignItems: "flex-start",
                      }}
                    >
                      <Box sx={{ pt: 0.5 }}>
                        <OrbitRing
                          status={msg.role === "user" ? "active" : "locked"}
                          size={8}
                        />
                      </Box>
                      <Box
                        sx={{
                          flex: 1,
                          p: 1.25,
                          borderRadius: 1,
                          background:
                            msg.role === "user" ? t.novaGlow : t.dust,
                          border: `1px solid ${
                            msg.role === "user" ? t.nova : t.border
                          }`,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            color: t.starFaint,
                            display: "block",
                            mb: 0.5,
                            fontFamily: FONT.mono,
                            fontSize: "0.65rem",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          {msg.role === "user" ? "你 · 上行链路" : "副官 · 下行链路"}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: t.star,
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.7,
                            fontSize: "0.88rem",
                          }}
                        >
                          {msg.content}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                  <div ref={messagesEndRef} />

                  {localAI?.isLoading && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, pl: 3 }}>
                      <CircularProgress size={10} sx={{ color: t.nova }} />
                      <Typography variant="caption" sx={{ color: t.starFaint, fontFamily: FONT.mono }}>
                        副官正在解码信号…
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <EmptyLog t={t} inProject={inProject} />
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

function EmptyLog({
  t,
  inProject,
}: {
  t: typeof T.dark;
  inProject: boolean;
}) {
  return (
    <Box
      sx={{
        border: `1px dashed ${t.border}`,
        borderRadius: 1,
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        background: t.dust,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: t.starFaint,
          fontFamily: FONT.mono,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        通讯日志 · 空
      </Typography>
      <Typography variant="body2" sx={{ color: t.starDim, fontSize: "0.85rem" }}>
        {inProject
          ? "输入第一条指令，副官会根据当前内容给出标题、标签或发布建议。"
          : "输入第一条指令，副官会帮你命名项目、选择模板或规划创作方向。"}
      </Typography>
      <Typography variant="caption" sx={{ color: t.starFaint, fontFamily: FONT.mono, fontSize: "0.65rem" }}>
        提示：输入 /switch 可切换已配置的通讯链路
      </Typography>
    </Box>
  );
}
