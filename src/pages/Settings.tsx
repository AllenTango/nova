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
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import {
  ArrowBack as BackIcon,
  SatelliteAlt as BeaconIcon,
  LinkOff as DisconnectIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import OrbitRing from "../components/OrbitRing";
import {
  api,
  Settings,
  ProviderEntry,
  NewProvider,
  UpdateProvider,
  FamilyKind,
  ChatOverrides,
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
  // ADR 0003 §3.7：当前 default provider / model。`None` 即未配置。
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  // Stage 3：「设为默认」对话框状态——点击 row 嘅「设为默认」按钮后
  // 弹 dialog，实时拉 list_models 让用户选 model，写入 default 字段。
  const [defaultPickerOpen, setDefaultPickerOpen] = useState(false);
  const [defaultPickerProviderId, setDefaultPickerProviderId] = useState<string | null>(null);
  const [defaultPickerModels, setDefaultPickerModels] = useState<string[]>([]);
  const [defaultPickerModelsLoading, setDefaultPickerModelsLoading] = useState(false);
  const [defaultPickerError, setDefaultPickerError] = useState<string>("");
  const [defaultPickerSubmitting, setDefaultPickerSubmitting] = useState(false);
  const [portsSynced, setPortsSynced] = useState(false);
  // ADR 0003 Stage 4 fix：初始 picker「扫描频段」前先临时保存 provider
  //（persist api_key），然后用 `api.providers.listModels(providerId)` 拉模型。
  // 保存后若用户取消，需要回滚。
  const [pickerScanTempId, setPickerScanTempId] = useState<string | null>(null);
  // ADR 0003 + 波士反馈：供应商需要「编辑」入口（改 base_url / api_key）。
  // 复用 picker dialog：当 `pickerEditProviderId` 非 null 时，dialog
  // 处于 edit 模式——直接 `api.providers.update` 现有 entry，跳过
  // add + scan 模型流程。`id` 字段对 preset provider 系不可改嘅
  // （preset registry 锁住 id），但 base_url / api_key 可改。
  const [pickerEditProviderId, setPickerEditProviderId] = useState<string | null>(null);
  // 一致性原则 v2：「验证」按钮成功 = 配置可用。Edit 模式点击「验证」
  // 会 fetch model list（逻辑同新建嘅「扫描频段」），但不显示 model chips
  // ——只有 `pickerVerified = true` 才 enable Save button。
  // 新建模式沿用 `pickerSelectedModel` 选择流程（pickerModels.length > 0 + pick 一个）。
  const [pickerVerified, setPickerVerified] = useState(false);
  // 一致性原则 v4：edit 模式时记住原 masked key（用于判断「用户有冇改过
  // api_key 字段」）。如果 `pickerApiKey === pickerOriginalApiKeyMasked`，
  // save 时**唔传** api_key 字段（避免误将「••••xxxx」mask 当新 key 写入）。
  // 用户改动（输入新 key）→ 唔相等 → 传新值覆盖。
  // **冇原 masked**（即 `null`）→ 一定传用户输入嘅值（user 必填新 key）。
  const [pickerOriginalApiKeyMasked, setPickerOriginalApiKeyMasked] = useState<
    string | null
  >(null);

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
    // ADR 0003 §3.7：拉 default 字段用于 row 嘅 default chip 渲染。
    // wire format snake_case（Bug A fix）。
    api.ai
      .getDefault()
      .then((d) => {
        if (d) {
          setDefaultProviderId(d.provider_id);
          setDefaultModelId(d.model_id);
        }
      })
      .catch((e) => console.error("[default] hydrate failed:", e));
  }, []);

  // 编辑模式下，base_url / api_key 变动应让验证失效，用户必须重新点
  // 「验证」通过先可以保存。id 变动允许唔重新验证（用户要求），但
  // submit 时会检查重复。每次打开 edit dialog 时 `pickerEditProviderId`
  // 由 null 变非 null，也会触发一次重置——确保「再被唤起」时处于未验证状态。
  useEffect(() => {
    if (pickerEditProviderId) {
      setPickerVerified(false);
    }
  }, [pickerBaseUrl, pickerApiKey, pickerEditProviderId]);

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
    setPickerScanTempId(null);
    setPickerEditProviderId(null);
    setPickerVerified(false);
    setPickerOriginalApiKeyMasked(null); // 新建模式冇「原」key
    setPickerOpen(true);
  };

  // 波士反馈：供应商需要「编辑」入口——复用 picker dialog。
  // 一致性原则 v2 → v3：
  //   1. **数据保留**——edit 唔清空任何原数据（base_url 预填，api_key 留空=保持不变）
  //   2. **UI 唔显示模型列表**——但**内部逻辑同新建一致**：
  //        - 「验证」按钮 = 新建嘅「扫描频段」内部逻辑（调 `list_models`）
  //        - 但 UI **不显示** model list chips（隐藏结果区）
  //   3. **「数据」= 模型列表数据**——能用「验证」成功拉到 model list = 配置可用
  //   4. **允许使用原数据验证**（v3 新增）——edit 模式冇改任何字段时也
  //        可直接点「验证」（apiKey required 留空 = 视为用原 key，
  //        backend 收到 None = 保持原值不变）。
  //   5. **可用则可以更新**——Save button 嘅 enable 条件 = `pickerVerified === true`
  //        （经过验证且成功）。未验证过 → Save 按钮 disabled。
  // 唯一区别（vs 新建）：
  //   - save 走 `api.providers.update`（唔重命名 id，不带 model 字段）
  //   - UI 唔显示「信号强度」chip 区（只显示「验证成功」状态）
  //   - 唔动 default model
    const openEditProvider = (p: ProviderEntry) => {
      // 推断 pickerKind：基于 FamilyKind + family。
      // **wire format snake_case**——Rust `#[serde(rename_all = "snake_case")]`
      // 把 `Preset/OpenaiCompat/AnthropicCompat` serialize 成
      // `"preset" / "openai_compat" / "anthropic_compat"`。
      // 注意：Ollama 在 backend 存储为 `kind: "openai_compat", family: "ollama"`，
      // 但前端 picker 有独立 `ollama` 频段（UI 语义更清晰），编辑时要 map 返去。
      let kind: PickerKind;
      if (p.kind === "preset") {
        // preset 进一步按 family 区分
        if (p.family === "openai") kind = "openai";
        else if (p.family === "anthropic") kind = "anthropic";
        else kind = "ollama";
      } else if (p.kind === "openai_compat") {
        // Ollama 用户条目特殊：family 为 ollama，但 kind 复用 openai_compat。
        // 编辑时显示为独立 Ollama 频段，令 api_key 可选、base_url 可编辑。
        kind = p.family === "ollama" ? "ollama" : "openai_compat";
      } else {
        // "anthropic_compat"
        kind = "anthropic_compat";
      }
      const opt = PICKER_OPTIONS.find((o) => o.kind === kind);
      if (!opt) return;
    setPickerKind(kind);
    setPickerId(p.id);
    setPickerBaseUrl(p.base_url);
    // **波士反馈 2026-06-17 v4**：apiKey 依赖 backend 返回嘅掩码值——
    //   - `p.api_key_masked` 存在（如 `"••••xxxx"`）→ 预填到输入框
    //     （user 改动就覆盖；唔动 = 保留原值，Save 时 skip api_key 字段）
    //   - `p.api_key_masked` 不存在 → 空白输入框，user 必填新 key
    // 永远唔神秘清空输入框。
    setPickerApiKey(p.api_key_masked ?? "");
    setPickerModels([]);
    setPickerModelsError("");
    setPickerSelectedModel("");
    setPickerError("");
    setPickerScanTempId(null);
    setPickerEditProviderId(p.id);
    setPickerVerified(false); // edit 开启时未验证，需用户点「验证」
    // 记下原 masked key——save 时用于判断 api_key 字段有冇被改动。
    setPickerOriginalApiKeyMasked(p.api_key_masked ?? null);
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

  // 一致性原则 v4：edit 模式判断 api_key 字段需唔需要传去 backend。
  // 规则：
  //   - 冇原 key（pickerOriginalApiKeyMasked === null）→ 一定要传
  //   - pickerApiKey 仲系 masked value（=== pickerOriginalApiKeyMasked）→ 唔传
  //   - pickerApiKey 唔同 masked value（user 改过）→ 传
  // 新建模式（一律 `pickerOriginalApiKeyMasked === null`）→ 传
  const shouldUpdateApiKey = (): boolean => {
    // 新建模式：原 masked 系 null → 传
    if (pickerOriginalApiKeyMasked === null) return true;
    // Edit 模式：值等同 mask → 唔传
    if (pickerApiKey === pickerOriginalApiKeyMasked) return false;
    // Edit 模式：值唔同 → 传
    return true;
  };

  const fetchPickerModels = async () => {
    const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind);
    if (!opt) return;
    // Edit 模式 apiKey 留空 = 用原值验证（唔阻塞「验证」按钮）。
    // 新建模式 apiKey required + 留空 = 阻塞。
    if (opt.apiKeyRequired && !pickerApiKey.trim() && !pickerEditProviderId) {
      setPickerModelsError("请先填接入密钥再扫描频段");
      return;
    }
    if (!pickerBaseUrl.trim()) {
      setPickerModelsError("请先填 Base URL 再扫描频段");
      return;
    }
    const finalId = pickerId.trim();
    if (!finalId) {
      setPickerModelsError("请填写 ID");
      return;
    }

    setPickerModelsLoading(true);
    setPickerModelsError("");
    setPickerModels([]);
    setPickerSelectedModel("");
    setPickerScanTempId(null);
    try {
      // ADR 0003 Stage 4 fix：「扫描频段」前先临时保存 provider
      //（persist api_key/base_url），然后用 `api.providers.listModels`
      // 正确拉模型——之前的 `api.ai.listModels({ api_key, base_url })`
      // 传入的 override 字段被 Rust `resolve_credentials` 完全忽略
      //（只看 provider_id fallback to default_pid）。
      //
      // **Bug fix 2026-06-17**：Edit 模式唔应该先落盘再验证。现在 backend
      // `list_models` 已支持 `provider_id` + `base_url` + `api_key` overrides，
      // edit 验证时直接传临时值，验证失败唔会污染 config.json。
      let savedId: string;
      if (pickerEditProviderId) {
        // Edit 模式：用 overrides 做只读验证，唔落盘。
        // 注意用 `pickerEditProviderId`（原始 ID）而非 `finalId`——如果用户
        // 同时改了 ID，新 ID 尚未落盘，backend 查唔到 entry。原始 ID 始终存在。
        const overrides: ChatOverrides = {
          provider_id: pickerEditProviderId,
          base_url: pickerBaseUrl.trim(),
        };
        // 只有在 api_key 真系被用户改动过（或原本冇 key）先传 override。
        // 如果传 masked value，backend 会误把掩码当 key 用。
        if (shouldUpdateApiKey()) {
          overrides.api_key = pickerApiKey;
        }
        const list = await api.ai.listModels(overrides);
        setPickerModels(list);
        if (list.length === 0) {
          setPickerModelsError("未收到信号，请检查接入密钥或 Base URL");
          setPickerVerified(false);
        } else {
          setPickerModelsError("");
          setPickerVerified(true);
        }
        return;
      } else if (opt.mode === "preset") {
        // 新建 preset：用只读 override 验证，不落盘（同 edit 模式）。
        // Preset 在 backend 始终存在（静态注册表），无需先 save。
        const overrides: ChatOverrides = {
          provider_id: finalId,
          base_url: pickerBaseUrl.trim(),
        };
        if (pickerApiKey) {
          overrides.api_key = pickerApiKey;
        }
        const list = await api.ai.listModels(overrides);
        setPickerModels(list);
        if (list.length === 0) {
          setPickerModelsError("未收到信号，请检查接入密钥或 Base URL");
        } else {
          setPickerModelsError("");
        }
        return;
      } else {
        // 新建 user 行（ollama / openai_compat / anthropic_compat）：
        // add 新 entry，idEditable=true 所以 finalId 系用户填的
        await api.providers.add({
          id: finalId,
          label: opt.label,
          family:
            pickerKind === "openai_compat"
              ? "openai"
              : pickerKind === "anthropic_compat"
              ? "anthropic"
              : pickerKind,
          kind:
            pickerKind === "anthropic_compat" ? "anthropic_compat" : "openai_compat",
          base_url: pickerBaseUrl.trim(),
          model: "",
          api_key: pickerApiKey,
        } as NewProvider);
        savedId = finalId;
        setPickerScanTempId(savedId); // 取消时回滚删除
      }

      // 用正确保存的 api_key 拉模型列表
      const list = await api.providers.listModels(savedId);
      setPickerModels(list);
      if (list.length === 0) {
        setPickerModelsError("未收到信号，请检查接入密钥或 Base URL");
        // 验证/扫描失败 → 重置 verified 状态
        if (pickerEditProviderId) setPickerVerified(false);
      } else {
        setPickerModelsError("");
        // Edit 模式：成功拉到 model list = 「配置可用」→ enable Save
        // 新建模式：仍需用户点选其中一个 model（pickerSelectedModel 验证）
        if (pickerEditProviderId) {
          setPickerVerified(true);
        }
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
      // 公共验证：baseUrl + id 必填
      // （**注意**：edit 模式唔需要 pickerSelectedModel——「验证」按钮成功
      //   即 `pickerVerified = true`，已经满足「配置可用」嘅判断信号；
      //   同新建逻辑一致：两者皆由「成功拉 model list」触发，UI 表现不同）
      // ── Edit 模式：update 现有 entry ───────────────────────
      if (pickerEditProviderId) {
        const newId = finalId;
        const oldId = pickerEditProviderId;

        // 自定义 provider（idEditable）允许改 ID，但需检查重复
        if (opt.idEditable && newId !== oldId) {
          if (providers.some((p) => p.id === newId)) {
            setPickerError("该 ID 已被其他供应商使用");
            setPickerSubmitting(false);
            return;
          }
        }

        const updatePatch: UpdateProvider = {
          id: oldId,
          base_url: pickerBaseUrl.trim(),
        };
        // ID 变动时传 new_id，backend 会移动 entry 同 secret
        if (newId !== oldId) {
          updatePatch.new_id = newId;
        }
        // api_key 字段判断同 fetchPickerModels 一致
        if (shouldUpdateApiKey()) {
          updatePatch.api_key = pickerApiKey;
        }
        const updated = await api.providers.update(updatePatch);
        setProviders((prev) =>
          prev.map((p) => (p.id === oldId ? updated : p))
        );
        // 如果重命名嘅系当前 default provider，同步更新前端 default 指针
        if (defaultProviderId === oldId && newId !== oldId) {
          setDefaultProviderId(newId);
        }
        setPickerOpen(false);
        setPickerEditProviderId(null);
        return;
      }
      // ── 新建：必须先 scan 并选定 model（验证 base_url + api_key 配对）──
      if (!pickerSelectedModel) {
        setPickerError("请先扫描频段并选定一个模型（验证配置正确）");
        setPickerSubmitting(false);
        return;
      }
      // ── 新建：preset 路径 ──────────────────────────────
      if (opt.mode === "preset") {
        // Preset path: the row already exists in Rust's static
        // registry, so we UPDATE it instead of adding. `add_provider`
        // would reject us because presets use `kind=Preset`, and
        // `add_provider` only accepts OpenaiCompat / AnthropicCompat.
        // ADR 0003 Stage 2 cleanup：`model` 字段从 update 移除——
        // 改 default 走独立 `api.ai.setDefault` 调用，避免 silent
        // override 当前 default 状态。
        const updated = await api.providers.update({
          id: finalId,
          base_url: pickerBaseUrl.trim(),
          api_key: pickerApiKey, // empty string = leave unchanged
        } as UpdateProvider);
        // ADR 0003：preset 路径保存后若 default 未初始化，自动
        // set_default 到新选定嘅 model（同 `add` 路径初始化语义）。
        // 已有 default 时唔动——用户可后续手动 /switch 切换。
        await maybeInitDefaultFromPreset(finalId, pickerSelectedModel);
        setProviders((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        setPickerOpen(false);
        return;
      }

      // User-addable path: fetchPickerModels 已经 add 过 provider
      //（persist api_key），此处不再重复 add——直接 update api_key/base_url
      //（用户可能改过），然后 re-fetch provider 列表刷新 UI。
      // ADR 0003 Stage 4 fix：修复了之前的「扫描后重复 add」报错。
      if (pickerScanTempId) {
        // provider 已在 scan 时 add，直接 update（更新可能改过的 key/url）
        await api.providers.update({
          id: finalId,
          base_url: pickerBaseUrl.trim(),
          api_key: pickerApiKey,
        } as UpdateProvider);
        // 若 default 未初始化，自动设为选定模型
        await maybeInitDefaultFromPreset(finalId, pickerSelectedModel);
        // 重新拉列表以拿到最新 entry（含 label 等）
        const list = await api.providers.list();
        setProviders(list);
        setPickerScanTempId(null);
        setPickerOpen(false);
        return;
      }
      // Fallback：pickerScanTempId 为 null（用户直接点保存，没扫过模型）
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
      // ADR 0003：如果删除嘅系 default provider，清 default state
      // （保持 uninitialized 显式状态——Q3 决定避免 silent 切换）
      if (id === defaultProviderId) {
        setDefaultProviderId(null);
        setDefaultModelId(null);
      }
    } catch (e) {
      console.error("[providers] remove failed:", e);
    }
  };

  // ADR 0003 Stage 2 cleanup：preset 路径保存后，若 default 未初始化
  // 自动 set_default 到新选定嘅 model（初始化语义）；已有 default
  // 时唔动——保持 user 显式控制。
  const maybeInitDefaultFromPreset = async (
    providerId: string,
    modelId: string
  ) => {
    if (!modelId.trim()) return;
    if (defaultProviderId) return; // 已有 default，唔覆盖
    try {
      await api.ai.setDefault(providerId, modelId);
      setDefaultProviderId(providerId);
      setDefaultModelId(modelId);
    } catch (e) {
      console.error("[default] preset init failed:", e);
    }
  };

  // ADR 0003 Stage 3：副官「设为默认」交互——打开 dialog 实时拉
  // list_models 让用户选 model，写入 NovaConfig default 字段。
  const openDefaultPicker = async (providerId: string) => {
    setDefaultPickerProviderId(providerId);
    setDefaultPickerOpen(true);
    setDefaultPickerModels([]);
    setDefaultPickerModelsLoading(true);
    setDefaultPickerError("");
    try {
      const models = await api.providers.listModels(providerId);
      setDefaultPickerModels(models);
      if (models.length === 0) {
        setDefaultPickerError("未拉到任何模型——请检查供应商状态");
      }
    } catch (e) {
      setDefaultPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setDefaultPickerModelsLoading(false);
    }
  };

  const submitDefaultPicker = async (modelId: string) => {
    if (!defaultPickerProviderId) return;
    setDefaultPickerSubmitting(true);
    setDefaultPickerError("");
    try {
      await api.ai.setDefault(defaultPickerProviderId, modelId);
      setDefaultProviderId(defaultPickerProviderId);
      setDefaultModelId(modelId);
      setDefaultPickerOpen(false);
      setDefaultPickerProviderId(null);
    } catch (e) {
      setDefaultPickerError(e instanceof Error ? e.message : String(e));
    } finally {
      setDefaultPickerSubmitting(false);
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
              {/* Status ring — `locked` 表示当前 default provider（ADR 0003 §3.7），
                  `active` 表示有配置但非 default，`inactive` 留作未来扩展。 */}
              <OrbitRing
                status={p.id === defaultProviderId ? "locked" : "active"}
                size={10}
                sx={{ ml: 0.5 }}
              />
              {/* 波士反馈：ID 系核心标识，排最前（大 mono 醒目）。
                  label 缩小放后面作为辅助信息。 */}
              <Typography
                sx={{
                  fontWeight: 500,
                  color: t.star,
                  fontFamily: FONT.mono,
                  fontSize: "0.95rem",
                }}
              >
                {p.id}
              </Typography>
              <Chip
                label={p.source === "preset" ? "preset" : "user"}
                size="small"
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
              <Typography
                variant="caption"
                sx={{ color: t.starFaint }}
              >
                {p.label}
              </Typography>
              {p.id === defaultProviderId && (
                <Chip
                  label="副官默认"
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: "0.65rem",
                    bgcolor: t.novaGlow,
                    color: t.nova,
                    border: `1px solid ${t.nova}`,
                  }}
                />
              )}
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
              {defaultModelId && p.id === defaultProviderId ? (
                // 当前默认 provider：模型 chip 可点击改模型
                <Typography
                  variant="caption"
                  sx={{
                    color: t.nova,
                    fontFamily: FONT.mono,
                    cursor: "pointer",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  title="点击改模型"
                  onClick={() => openDefaultPicker(p.id)}
                >
                  {defaultModelId}
                </Typography>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => openDefaultPicker(p.id)}
                  sx={{ fontSize: "0.7rem" }}
                >
                  设为默认
                </Button>
              )}
              {/* Edit button：preset + user 都有（preset 改 base_url 走 PresetOverride 持久化）。
                  按波士要求：内置 id 唔改（preset 嘅 family / kind / id 锁住），
                  base_url / api_key 可改。 */}
              <IconButton
                size="small"
                onClick={() => openEditProvider(p)}
                sx={{ color: t.starDim }}
                title="校准频段（改 Base URL / 接入密钥）"
              >
                <EditIcon fontSize="small" />
              </IconButton>
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
          {pickerEditProviderId ? "校准频段" : "调谐信标"}
        </DialogTitle>
        <DialogContent dividers>
          {(() => {
            const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind)!;
            // Fetching models requires: base url + id 非空。
            // **Edit 模式 apiKey 留空 = 使用原值**（唔阻塞「验证」按钮——
            // 用户可能只想改 base_url 或 id，唔想重新输入 api_key）。
            // 新建模式：apiKey required 时必须填。
            // 行为：fetchPickerModels 会先调 `api.providers.update`
            // （empty api_key → undefined → backend 视为 None = 保持原值）。
            const canFetch =
              pickerBaseUrl.trim().length > 0 &&
              pickerId.trim().length > 0 &&
              // apiKey required + 已填 → OK（新建+edit 都用呢个）
              (!opt.apiKeyRequired ||
                pickerApiKey.trim().length > 0 ||
                // edit 模式：apiKey 留空 = 用原值（允许验证）
                pickerEditProviderId !== null);
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
                    // 编辑模式下频段由现有 entry 决定，唔允许重新选择——
                    // 避免 user 将 Ollama 改成 OpenAI 兼容等跨 family 操作。
                    disabled={pickerSubmitting || pickerEditProviderId !== null}
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
                      onChange={(e) => {
                        setPickerBaseUrl(e.target.value);
                        // Edit 模式：用户改 URL 后，旧验证失效，需重新验证。
                        if (pickerEditProviderId) setPickerVerified(false);
                      }}
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
                    onChange={(e) => {
                      setPickerApiKey(e.target.value);
                      // Edit 模式：用户改 key 后，旧验证失效，需重新验证。
                      if (pickerEditProviderId) setPickerVerified(false);
                    }}
                    fullWidth
                    size="small"
                    disabled={pickerSubmitting}
                    required={opt.apiKeyRequired && !pickerEditProviderId}
                    helperText={opt.apiKeyHelp}
                  />

                  {/* 验证区域：edit / 新建 走同一 `fetchPickerModels` 内部逻辑，
                      但 UI 表现不同——
                        - **新建**：显示「扫描频段」+「信号强度」chip 区
                        - **edit**：显示「测试」按钮 + 「✓ 已验证」状态 chip
                          （唔显示 model list chips）
                      两者皆调用同一后端 list_models——edit 模式成功拉到
                      list 即 `pickerVerified = true`，允许 Save。 */}
                  {pickerEditProviderId ? (
                    // Edit 模式：「测试」按钮 + 验证状态
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
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
                          pickerVerified ? "重新验证" : "验证"
                        )}
                      </Button>
                      {pickerVerified && (
                        <Chip
                          icon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                          label={`已验证 · ${pickerModels.length} 个模型`}
                          size="small"
                          sx={{
                            height: 22,
                            fontSize: "0.7rem",
                            bgcolor: t.novaGlow,
                            color: t.nova,
                            border: `1px solid ${t.nova}`,
                            "& .MuiChip-icon": { color: t.nova, ml: 0.5 },
                          }}
                        />
                      )}
                    </Box>
                  ) : (
                    // 新建模式：「扫描频段」+「信号强度」chip 区
                    <>
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
                    </>
                  )}

                  {pickerModelsError && pickerEditProviderId && (
                    <Alert severity="warning">{pickerModelsError}</Alert>
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
          <Button
            onClick={async () => {
              // 回滚「扫描频段」期间临时创建的 user provider
              if (pickerScanTempId) {
                try {
                  await api.providers.remove(pickerScanTempId);
                  setProviders((prev) => prev.filter((p) => p.id !== pickerScanTempId));
                } catch {
                  // 回滚失败不影响取消
                }
                setPickerScanTempId(null);
              }
              setPickerEditProviderId(null);
              setPickerOpen(false);
            }}
            disabled={pickerSubmitting}
          >
            取消
          </Button>
          <Button
            variant="contained"
            onClick={submitPicker}
            disabled={
              pickerSubmitting ||
              pickerBaseUrl.trim().length === 0 ||
              pickerId.trim().length === 0 ||
              // 新建模式：必须先 scan 并选定一个 model（同新建逻辑）
              // edit 模式：必须经过「测试」验证（pickerVerified = true）
              // 两者皆由「成功拉到 model list」触发——一致嘅判断信号。
              (pickerEditProviderId
                ? !pickerVerified
                : pickerSelectedModel.length === 0) ||
              ((() => {
                const opt = PICKER_OPTIONS.find((o) => o.kind === pickerKind)!;
                // apiKey required 但用户冇填 → disable
                // edit 模式：apiKey 留空=保持不变，所以唔强制 required
                return (
                  opt.apiKeyRequired &&
                  !pickerEditProviderId &&
                  pickerApiKey.trim().length === 0
                );
              })())
            }
          >
            {pickerSubmitting ? "锁定中…" : "锁定"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ADR 0003 §3.7：副官「设为默认」对话框。点 row 嘅「设为默认」
          按钮后弹 dialog，实时拉 list_models 让用户选 model，写入
          NovaConfig default 字段。 */}
      <Dialog
        open={defaultPickerOpen}
        onClose={() => {
          if (!defaultPickerSubmitting) {
            setDefaultPickerOpen(false);
            setDefaultPickerProviderId(null);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: FONT.display, fontWeight: 400 }}>
          设副官默认
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" sx={{ color: t.starFaint, display: "block", mb: 1.5 }}>
            从 <strong>{defaultPickerProviderId}</strong> 拉取模型列表，选择一个设为副官默认大脑。
          </Typography>
          {defaultPickerModelsLoading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
              <CircularProgress size={14} sx={{ color: t.nova }} />
              <Typography variant="caption" sx={{ color: t.starFaint }}>
                正在从供应商拉取模型…
              </Typography>
            </Box>
          )}
          {defaultPickerError && (
            <Typography variant="caption" sx={{ color: "error.main", display: "block", mb: 1 }}>
              {defaultPickerError}
            </Typography>
          )}
          {!defaultPickerModelsLoading && defaultPickerModels.length === 0 && !defaultPickerError && (
            <Typography variant="caption" sx={{ color: t.starFaint }}>
              暂无可用模型
            </Typography>
          )}
          <List dense disablePadding>
            {defaultPickerModels.map((m) => (
              <ListItemButton
                key={m}
                disabled={defaultPickerSubmitting}
                onClick={() => submitDefaultPicker(m)}
              >
                <ListItemText
                  primary={m}
                  secondary={
                    m === defaultModelId && defaultPickerProviderId === defaultProviderId
                      ? "当前默认"
                      : undefined
                  }
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => {
              setDefaultPickerOpen(false);
              setDefaultPickerProviderId(null);
            }}
            disabled={defaultPickerSubmitting}
          >
            取消
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
