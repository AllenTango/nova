import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  CircularProgress,
  IconButton,
} from "@mui/material";
import {
  ArrowBack as BackIcon,
  SatelliteAlt as BeaconIcon,
  LinkOff as DisconnectIcon,
} from "@mui/icons-material";
import OrbitRing from "../components/OrbitRing";
import {
  api,
  Settings,
  ProviderEntry,
  NewProvider,
  UpdateProvider,
  FamilyKind,
} from "../api/client";
import { T, FONT } from "../theme";
import Starfield from "../components/Starfield";

// Picker entries for the unified "Add model provider" radio dialog.
//
// The list combines the three built-in presets (OpenAI / Anthropic /
// Ollama — these are static entries in Rust `PROVIDER_REGISTRY` and
// always exist) with the two Custom user-addable categories
// (OpenAI-compatible / Anthropic-compatible, both routed through the
// Custom family — users supply their own base_url). The "保存" button
// fans out to either `add_provider` (user-addable) or `update_provider`
// (preset, since the preset row already exists) — see `submitPicker`
// for the routing.
//
// For each entry, the `id` is a baked-in attribute of the provider
// family. The user CANNOT change it in the dialog (rendered
// read-only). `baseUrl` and `apiKey` are user-supplied per entry.
type PickerKind =
  | "openai"
  | "anthropic"
  | "ollama"
  | "openai_compat"
  | "anthropic_compat";
type PickerMode = "preset" | "user";

const PICKER_OPTIONS: {
  kind: PickerKind;
  label: string;
  id: string;
  defaultBaseUrl: string;
  /// Whether the user can edit the `id` field. False for presets
  /// and for the well-known Ollama slot. True for the two
  /// user-named compat entries (so a user can add, say, two
  /// OpenAI-compatible services and distinguish them).
  idEditable: boolean;
  /// Whether the user can edit the Base URL. False for presets —
  /// their base URL is fixed in Rust's PROVIDER_REGISTRY and the
  /// picker just shows the canonical value as a read-only field.
  /// True for the two Custom user-addable categories.
  baseUrlEditable: boolean;
  apiKeyRequired: boolean;
  apiKeyHelp: string;
  /// "preset" = static Rust entry, save goes through `update_provider`.
  /// "user"   = dynamic user entry, save goes through `add_provider`.
  mode: PickerMode;
}[] = [
  {
    kind: "openai",
    label: "OpenAI",
    id: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    idEditable: false,
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyHelp: "OpenAI 平台申请的 sk-… 密钥",
    mode: "preset",
  },
  {
    kind: "anthropic",
    label: "Anthropic",
    id: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    idEditable: false,
    baseUrlEditable: false,
    apiKeyRequired: true,
    apiKeyHelp: "Anthropic Console 申请的 sk-ant-… 密钥",
    mode: "preset",
  },
  {
    kind: "ollama",
    label: "Ollama (本地)",
    id: "ollama",
    defaultBaseUrl: "http://localhost:11434",
    idEditable: false,
    baseUrlEditable: true,
    apiKeyRequired: false,
    apiKeyHelp: "本地运行无需密钥；留空即可",
    mode: "user",
  },
  {
    kind: "openai_compat",
    label: "OpenAI 兼容",
    id: "openai-compat",
    defaultBaseUrl: "https://api.openai.com/v1",
    idEditable: true,
    baseUrlEditable: true,
    apiKeyRequired: true,
    apiKeyHelp: "DeepSeek / 硅基流动 / 其他 OpenAI 兼容服务",
    mode: "user",
  },
  {
    kind: "anthropic_compat",
    label: "Anthropic 兼容",
    id: "anthropic-compat",
    defaultBaseUrl: "https://api.anthropic.com",
    idEditable: true,
    baseUrlEditable: true,
    apiKeyRequired: true,
    apiKeyHelp: "Anthropic 兼容端点（如自部署、转发服务）",
    mode: "user",
  },
];

// Optimistic defaults — page renders immediately, no spinner.
const INITIAL_SETTINGS: Settings = {
  nova_port: 3847,
  preview_port: 4321,
  theme: "dark",
};

export default function SettingsPage({
  onBack,
  themeMode,
}: {
  onBack: () => void;
  themeMode: "dark" | "light";
}) {
  const t = T[themeMode];

  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);

  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [providersError, setProvidersError] = useState<string>("");
  const [portsSynced, setPortsSynced] = useState(false);

  // The page no longer keeps per-provider model caches here — the
  // "Add" dialog owns its own `pickerModels` state. The single
  // source of truth for which model is "selected" for a given
  // provider lives in `~/.nova/config.json` (via `update`
  // and `add` from the dialog) for the boot-time default.
  //
  // Picker dialog state (unified "Add model provider" flow).
  // The "+ 添加模型供应商" button at the top of the page opens
  // this dialog. Step 1: pick a family via radio. Step 2: see
  // immutable attributes (id, base url) + supply api key + fetch
  // models + pick one. Save is disabled until a model is chosen.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>("ollama");
  // Picker field state. `pickerId` is user-controlled when the
  // selected provider's `idEditable` flag is true (compat slots);
  // for presets/Ollama it's a derived read-only value (kept in
  // state so we don't have to special-case the JSX).
  const [pickerId, setPickerId] = useState("");
  const [pickerBaseUrl, setPickerBaseUrl] = useState("");
  const [pickerApiKey, setPickerApiKey] = useState("");
  const [pickerModels, setPickerModels] = useState<string[]>([]);
  const [pickerModelsLoading, setPickerModelsLoading] = useState(false);
  const [pickerModelsError, setPickerModelsError] = useState("");
  const [pickerSelectedModel, setPickerSelectedModel] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [pickerSubmitting, setPickerSubmitting] = useState(false);

  // ── Hydration ────────────────────────────────────────────────
  useEffect(() => {
    api.settings
      .get()
      .then((s) => setSettings(s))
      .catch((e) => console.error("[settings] hydrate failed:", e));
    api.providers
      .list()
      .then((list) => setProviders(list))
      .catch((e) => {
        console.error("[providers] hydrate failed:", e);
        setProvidersError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // ── Picker dialog handlers ──────────────────────────────────

  const openPicker = () => {
    const def = PICKER_OPTIONS[0];
    setPickerKind(def.kind);
    setPickerId(def.id);
    setPickerBaseUrl(def.defaultBaseUrl);
    setPickerApiKey("");
    setPickerModels([]);
    setPickerModelsError("");
    setPickerSelectedModel("");
    setPickerError("");
    setPickerOpen(true);
  };

  // When the user switches the radio, refill the default values for
  // the new provider kind and CLEAR the user-supplied inputs (api
  // key + selected model + fetched model list) — providers don't
  // share their api keys, base urls, or model lists with each other.
  // The `id` is reset to the default too so a user switching from
  // "OpenAI 兼容 (id=user-supplied-name)" back to "Ollama" doesn't
  // accidentally re-submit the old id.
  const switchPickerKind = (next: PickerKind) => {
    if (next === pickerKind) return;
    const def = PICKER_OPTIONS.find((o) => o.kind === next);
    if (!def) return;
    setPickerKind(next);
    setPickerId(def.id);
    setPickerBaseUrl(def.defaultBaseUrl);
    setPickerApiKey("");
    setPickerModels([]);
    setPickerModelsError("");
    setPickerSelectedModel("");
  };

  const fetchPickerModels = async () => {
    const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind);
    if (!opt) return;
    // Light client-side guard — full validation is server-side, but
    // an obviously-empty key (when required) is just a wasted round
    // trip to the upstream.
    if (opt.apiKeyRequired && !pickerApiKey.trim()) {
      setPickerModelsError("请先填接入密钥再扫描频段");
      return;
    }
    if (!pickerBaseUrl.trim()) {
      setPickerModelsError("请先填 Base URL 再扫描频段");
      return;
    }
    setPickerModelsLoading(true);
    setPickerModelsError("");
    setPickerModels([]);
    setPickerSelectedModel("");
    try {
      // Rust `ProviderFactory::list_models` keys on the family
      // string ("openai" / "anthropic" / "ollama"), not
      // the PickerKind. Compat picker entries map to the family
      // they delegate to.
      const fetchProvider =
        pickerKind === "openai_compat"
          ? "openai"
          : pickerKind === "anthropic_compat"
          ? "anthropic"
          : pickerKind;
      const list = await api.ai.listModels({
        provider: fetchProvider,
        api_key: pickerApiKey,
        base_url: pickerBaseUrl.trim(),
      });
      setPickerModels(list);
      if (list.length === 0) {
        setPickerModelsError("未收到信号，请检查接入密钥或 Base URL");
      }
    } catch (e) {
      setPickerModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setPickerModelsLoading(false);
    }
  };

  const submitPicker = async () => {
    setPickerError("");
    const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind);
    if (!opt) {
      setPickerError("未知的供应商类型");
      return;
    }
    if (opt.apiKeyRequired && !pickerApiKey.trim()) {
      setPickerError("请填接入密钥");
      return;
    }
    if (!pickerBaseUrl.trim()) {
      setPickerError("请填写 Base URL");
      return;
    }
    if (!pickerSelectedModel) {
      setPickerError("请先获取并选定一个模型");
      return;
    }
    setPickerSubmitting(true);
    try {
      // Validate the user-supplied id (only editable on compat
      // entries; presets/Ollama carry it in state but we still
      // run the same trim+empty check for safety).
      const finalId = pickerId.trim();
      if (!finalId) {
        setPickerError("请填写 ID");
        setPickerSubmitting(false);
        return;
      }
      if (opt.mode === "preset") {
        // Preset path: the row already exists in Rust's static
        // registry, so we UPDATE it instead of adding. `add_provider`
        // would reject us because presets use `kind=Preset`, and
        // `add_provider` only accepts OpenaiCompat / AnthropicCompat.
        // We send base_url + model + api_key; the backend ignores
        // immutable fields if we accidentally include them.
        const updated = await api.providers.update({
          id: finalId,
          base_url: pickerBaseUrl.trim(),
          model: pickerSelectedModel,
          api_key: pickerApiKey, // empty string = leave unchanged
        } as UpdateProvider);
        setProviders((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        setPickerOpen(false);
        return;
      }

      // User-addable path: fan out to `add_provider`. Compat
      // picker entries (openai_compat / anthropic_compat) carry
      // their kind qualifier in the `kind` field; the underlying
      // `family` is the openai/anthropic family they delegate to.
      // Ollama routes through the OpenAI-compatible surface
      // (`http://localhost:11434/v1/...`) and so also uses
      // `kind=openai_compat` with `family="ollama"`.
      const family =
        pickerKind === "openai_compat"
          ? "openai"
          : pickerKind === "anthropic_compat"
          ? "anthropic"
          : "ollama";
      const kind: FamilyKind =
        pickerKind === "anthropic_compat" ? "anthropic_compat" : "openai_compat";
      const created = await api.providers.add({
        id: finalId,
        label: opt.label,
        family,
        kind,
        base_url: pickerBaseUrl.trim(),
        model: pickerSelectedModel,
        api_key: pickerApiKey,
      } as NewProvider);
      setProviders((prev) => [...prev, created]);
      setPickerOpen(false);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setPickerSubmitting(false);
    }
  };

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoSave = useCallback((next: Settings) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPortsSynced(false);
    saveTimer.current = setTimeout(() => {
      api.settings
        .save(next)
        .then(() => {
          setPortsSynced(true);
          setTimeout(() => setPortsSynced(false), 1400);
        })
        .catch((e) => console.error("[settings] auto-save failed:", e));
    }, 400);
  }, []);

  const handleRemoveProvider = async (id: string) => {
    try {
      await api.providers.remove(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error("[providers] remove failed:", e);
    }
  };

  return (
    <Box sx={{ position: "relative", minHeight: "100vh" }}>
      <Starfield />

      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          maxWidth: 920,
          mx: "auto",
          px: { xs: 3, md: 6 },
          py: 4,
        }}
      >
        <Button startIcon={<BackIcon />} onClick={onBack} sx={{ mb: 3, color: t.starDim }}>
          返回星空
        </Button>

        <Typography variant="overline" sx={{ color: t.starFaint, display: "block", mb: 1 }}>
          天文台控制台
        </Typography>
        <Typography
          sx={{
            fontFamily: FONT.display,
            fontSize: "2.2rem",
            fontWeight: 400,
            color: t.star,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            mb: 1,
          }}
        >
          调谐{" "}
          <Box component="span" sx={{ color: t.nova, fontStyle: "italic" }}>
            Nova
          </Box>{" "}
          的链路
        </Typography>
        <Typography variant="body2" sx={{ color: t.starDim, mb: 4, maxWidth: 620 }}>
          配置 AI 通讯链路与本地端口坐标。所有数据写入{" "}
          <Box component="code" sx={{ fontFamily: FONT.mono, color: t.starFaint }}>
            ~/.nova/config.json
          </Box>
          ，端口变更会自动同步至星图。
        </Typography>

        {providersError && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            供应商列表读取失败：{providersError}
          </Alert>
        )}

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
          <Box>
            <Typography variant="overline" sx={{ color: t.starFaint, display: "block" }}>
              模型供应商
            </Typography>
            <Typography variant="caption" sx={{ color: t.starDim }}>
              已配置的链路列表，存储在{" "}
              <Box component="code" sx={{ fontFamily: FONT.mono, color: t.starFaint }}>
               ~/.nova/config.json
             </Box>
             。点击「调谐信标」接入新链路。
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={openPicker}
            startIcon={<BeaconIcon />}
            sx={{ flexShrink: 0, ml: 2 }}
          >
            调谐信标
          </Button>
        </Box>

        {/* ── Configured providers (list view) ───────────── */}
        {/* Source: API.providers.list() — populated from Rust static
            registry (preset) + ~/.nova/config.json (user) + env
            scan (env). One unified list, no per-source sections. Each
            row shows label / id / source chip / base_url / model. */}
        <Box sx={{ display: "grid", mb: 4 }}>
          {providers.length === 0 && !providersError && (
            <Box sx={{ py: 4, display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
              <Typography variant="body2" sx={{ color: t.starDim }}>
                天文台尚未调谐任何链路。
              </Typography>
              <Typography variant="caption" sx={{ color: t.starFaint }}>
                点击右上「调谐信标」配置第一个供应商，副官才能开始通讯。
              </Typography>
            </Box>
          )}
          {providers.map((p) => (
            <Box
              key={p.id}
              sx={{
                px: 1,
                py: 1.5,
                display: "flex",
                alignItems: "center",
                gap: 2,
                borderBottom: `1px solid ${t.border}`,
              }}
            >
              {/* Status ring — every listed provider is at minimum
                  "active" (has a configured secret in ~/.nova/config.json).
                  The `locked` state belongs to whichever provider the
                  AI 副官 is currently bound to; that decision lives in
                  AIChatPanel so we just render "active" here. */}
              <OrbitRing status="active" size={10} sx={{ ml: 0.5 }} />
              <Typography sx={{ fontWeight: 500, color: t.star, fontSize: "0.95rem" }}>
                {p.label}
              </Typography>
              <Chip
                label={p.source === "preset" ? "preset" : "user"}
                size="small"
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
              <Typography
                variant="caption"
                sx={{ color: t.starFaint, fontFamily: FONT.mono }}
              >
                {p.id}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography
                variant="caption"
                sx={{
                  color: t.starDim,
                  fontFamily: FONT.mono,
                  display: { xs: "none", md: "block" },
                }}
              >
                {p.base_url}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: t.star, fontFamily: FONT.mono }}
              >
                {p.model || "(未选模型)"}
              </Typography>
              {p.source === "user" && (
                <IconButton
                  size="small"
                  onClick={() => handleRemoveProvider(p.id)}
                  sx={{ color: t.starDim }}
                  title="断开连接"
                >
                  <DisconnectIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>

        {/* ── Port settings (auto-saved on change) ──────────── */}
        {/* Two side-by-side inputs read as "coordinate dials". On sync
            success a brief sync dot pulses to the right of each input,
            reinforcing the "已同步至星图" feedback without a sticky
            toast. */}
        <Typography variant="overline" sx={{ color: t.starFaint, display: "block", mb: 2 }}>
          应用设置
        </Typography>
        <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
          <TextField
            label="Nova API 端口"
            type="number"
            value={settings.nova_port}
            onChange={(e) => {
              const next = { ...settings, nova_port: parseInt(e.target.value) || 3847 };
              setSettings(next);
              autoSave(next);
            }}
            size="small"
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                endAdornment: <SyncDot active={portsSynced} t={t} />,
              },
            }}
          />
          <TextField
            label="预览端口"
            type="number"
            value={settings.preview_port}
            onChange={(e) => {
              const next = { ...settings, preview_port: parseInt(e.target.value) || 4321 };
              setSettings(next);
              autoSave(next);
            }}
            size="small"
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                endAdornment: <SyncDot active={portsSynced} t={t} />,
              },
            }}
          />
        </Box>
      </Box>

      {/* ── Picker dialog: "Add model provider" (Select + dynamic fields) ── */}
      <Dialog
        open={pickerOpen}
        onClose={() => !pickerSubmitting && setPickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: FONT.display, fontWeight: 400 }}>
          调谐信标
        </DialogTitle>
        <DialogContent dividers>
          {(() => {
            const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind)!;
            // Fetching models requires only: a base url, and (for
            // API-key-required providers) a non-empty key, and (for
            // user-addable entries) a non-empty id. We deliberately
            // do NOT require a model pick here — the whole point of
            // this button is to populate that list.
            const canFetch =
              pickerBaseUrl.trim().length > 0 &&
              (!opt.apiKeyRequired || pickerApiKey.trim().length > 0) &&
              pickerId.trim().length > 0;
            return (
              <>
                {pickerError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {pickerError}
                  </Alert>
                )}

                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>频段</InputLabel>
                  <Select
                    label="频段"
                    value={pickerKind}
                    onChange={(e) =>
                      switchPickerKind(e.target.value as PickerKind)
                    }
                    disabled={pickerSubmitting}
                  >
                    {PICKER_OPTIONS.map((o) => (
                      <MenuItem key={o.kind} value={o.kind}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box
                  sx={{
                    p: 2,
                    border: `1px solid ${t.border}`,
                    borderRadius: 1.5,
                    background: t.dust,
                    display: "grid",
                    gap: 1.5,
                  }}
                >
                  {opt.idEditable ? (
                    <TextField
                      label="ID *"
                      value={pickerId}
                      onChange={(e) => setPickerId(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={pickerSubmitting}
                      required
                      helperText="唯一标识（同 ~/.nova/config.json 内的 id 字段）"
                    />
                  ) : (
                    <Box>
                      <Typography
                        variant="caption"
                        sx={{ color: t.starFaint, display: "block", mb: 0.5 }}
                      >
                        ID（不可修改）
                      </Typography>
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          border: `1px solid ${t.border}`,
                          borderRadius: 1,
                          fontFamily: FONT.mono,
                          fontSize: "0.85rem",
                          color: t.starDim,
                          background: "transparent",
                        }}
                      >
                        {opt.id}
                      </Box>
                    </Box>
                  )}

                  {opt.baseUrlEditable ? (
                    <TextField
                      label="Base URL *"
                      value={pickerBaseUrl}
                      onChange={(e) => setPickerBaseUrl(e.target.value)}
                      fullWidth
                      size="small"
                      disabled={pickerSubmitting}
                      required
                    />
                  ) : (
                    <Box>
                      <Typography
                        variant="caption"
                        sx={{ color: t.starFaint, display: "block", mb: 0.5 }}
                      >
                        Base URL
                      </Typography>
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          border: `1px solid ${t.border}`,
                          borderRadius: 1,
                          fontFamily: FONT.mono,
                          fontSize: "0.85rem",
                          color: t.starDim,
                          background: "transparent",
                        }}
                      >
                        {opt.defaultBaseUrl}
                      </Box>
                    </Box>
                  )}

                  <TextField
                    label={opt.apiKeyRequired ? "接入密钥 *" : "接入密钥（可选）"}
                    type="password"
                    value={pickerApiKey}
                    onChange={(e) => setPickerApiKey(e.target.value)}
                    fullWidth
                    size="small"
                    disabled={pickerSubmitting}
                    required={opt.apiKeyRequired}
                    helperText={opt.apiKeyHelp}
                  />

                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={fetchPickerModels}
                      disabled={pickerModelsLoading || !canFetch}
                      sx={{ minWidth: 110 }}
                    >
                      {pickerModelsLoading ? (
                        <CircularProgress size={14} />
                      ) : (
                        "扫描频段"
                      )}
                    </Button>
                    {pickerModels.length > 0 && (
                      <Typography
                        variant="caption"
                        sx={{ color: t.starDim, fontFamily: FONT.mono }}
                      >
                        共 {pickerModels.length} 个信号
                      </Typography>
                    )}
                  </Box>

                  {pickerModelsError && (
                    <Alert severity="warning">{pickerModelsError}</Alert>
                  )}

                  {pickerModels.length > 0 && (
                    <Box>
                      <Typography
                        variant="caption"
                        sx={{ color: t.starFaint, display: "block", mb: 1 }}
                      >
                        信号强度 · 点击锁定一个
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, maxHeight: 200, overflowY: "auto" }}>
                        {pickerModels.map((m) => {
                          const selected = m === pickerSelectedModel;
                          return (
                            <Box
                              key={m}
                              onClick={() => !pickerSubmitting && setPickerSelectedModel(m)}
                              sx={{
                                px: 1.25,
                                py: 0.5,
                                cursor: pickerSubmitting ? "default" : "pointer",
                                border: `1px solid ${selected ? t.nova : t.border}`,
                                borderRadius: 1,
                                background: selected ? t.novaGlow : "transparent",
                                color: selected ? t.nova : t.star,
                                fontFamily: FONT.mono,
                                fontSize: "0.75rem",
                                transition: "all 0.15s ease",
                                "&:hover": pickerSubmitting
                                  ? {}
                                  : { borderColor: t.nova, color: t.nova },
                              }}
                            >
                              {m}
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  )}

                  {pickerSelectedModel && (
                    <Typography
                      variant="caption"
                      sx={{ color: t.starDim, display: "block" }}
                    >
                      已锁定：
                      <Box
                        component="span"
                        sx={{ fontFamily: FONT.mono, color: t.star, ml: 0.5 }}
                      >
                        {pickerSelectedModel}
                      </Box>
                    </Typography>
                  )}
                </Box>
              </>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setPickerOpen(false)} disabled={pickerSubmitting}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={submitPicker}
            disabled={
              pickerSubmitting ||
              pickerSelectedModel.length === 0 ||
              pickerBaseUrl.trim().length === 0 ||
              ((() => {
                const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind)!;
                return opt.apiKeyRequired && pickerApiKey.trim().length === 0;
              })()) ||
              pickerId.trim().length === 0
            }
          >
            {pickerSubmitting ? "锁定中…" : "锁定"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/// Small status dot that pulses beside a port input after a successful
/// sync. Reads as a single short beat — no toast, no flicker, just a
/// momentary confirmation. `active` is true for ~1.4s after `autoSave`
/// resolves; the keyframe runs once and the dot fades back to dim.
function SyncDot({ active, t }: { active: boolean; t: typeof T.dark }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        mr: 1.5,
        background: active ? t.nova : t.starFaint,
        boxShadow: active ? `0 0 6px ${t.novaGlow}` : "none",
        transition: "background 0.2s ease, box-shadow 0.2s ease",
        animation: active ? "syncPulse 1.4s ease-out 1" : "none",
        "@keyframes syncPulse": {
          "0%": { transform: "scale(0.6)", opacity: 0.4 },
          "20%": { transform: "scale(1.4)", opacity: 1 },
          "100%": { transform: "scale(1)", opacity: 0.85 },
        },
      }}
    />
  );
}
