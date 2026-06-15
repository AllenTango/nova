import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * 检测 app 是否运行在 Tauri webview 里。
 *
 * 在 vite-dev / 纯浏览器模式下，`window.__TAURI_INTERNALS__` 没注入，
 * 任何 `invoke` 调用都会抛 `Cannot read properties of undefined
 * (reading 'invoke')`。我们包一层原始调用：
 *   - tauri 模式：真 invoke，错误照常透传
 *   - web 模式：invoke 抛 `NotInTauriError`，让 React Query 调用方
 *                决定渲染什么（例如 fallback 面板或"在桌面应用里打开"
 *                提示），而不是直接崩掉组件树。
 *
 * 同时导出 `isTauri()`，方便组件用它来 gate query（完全跳过浏览器
 * 里的查询）而不是先跑再 catch。
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ !== "undefined"
  );
}

export class NotInTauriError extends Error {
  constructor(public readonly command: string) {
    super(
      `Nova command "${command}" is only available inside the Tauri desktop app.`,
    );
    this.name = "NotInTauriError";
  }
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    if (typeof console !== "undefined") {
      console.warn(`[nova] invoke("${cmd}") skipped — not running in Tauri.`);
    }
    return Promise.reject(new NotInTauriError(cmd));
  }
  return tauriInvoke<T>(cmd, args);
}

export type ProjectKind = "note" | "site";

export interface ProjectInfo {
  id: string;
  name: string;
  kind: ProjectKind;
  template: string;
  path: string;
  created_at: number;
  updated_at: number;
}

// Back-compat alias for places that still say "Site" — semantically
// the model is now a Project; this alias keeps diffs small.
export type SiteInfo = ProjectInfo;

export interface Note {
  id: string;
  title: string;
  content: string;
  date: string;
  path: string;
  tags: string[];
}

// ── Post kept for site kind, where content goes in `posts/` ──────
export interface Post {
  id: string;
  title: string;
  type: string;
  content: string;
  tags: string[];
  date: string;
  path: string;
}

export interface Settings {
  nova_port: number;
  preview_port: number;
  theme: "dark" | "light";
}

export interface PreviewStatus {
  is_running: boolean;
  current_site: string | null;
  url: string | null;
}

export interface BuildResult {
  output_dir: string;
  success: boolean;
  message: string;
}

export interface ChatOverrides {
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  /// Provider id from the unified ~/.nova/config.json. When set, the
  /// Rust side resolves credentials (api_key + base_url + model) from
  /// the config with secrets + env-var fallback.
  provider_id?: string;
}

export interface AIOption {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  model: string;
}

// ── Providers (Settings page) ────────────────────────────────────
// Backed by `~/.nova/config.json` (user-added compat entries + provider
// secrets). Presets are reconstructed from Rust's static registry on
// every call so the list is always authoritative even before the user
// has configured anything. Environment variables are NOT consulted —
// credentials live exclusively in the JSON file.

export type ProviderSource = "preset" | "user";
export type FamilyKind = "preset" | "openai_compat" | "anthropic_compat";

export interface ProviderEntry {
  id: string;
  label: string;
  family: string;
  /// Whether the user can edit base_url in the UI. False for presets.
  base_url_editable: boolean;
  /// Whether api_key is required to query models. False for Ollama
  /// (local server, no key); true for every preset cloud provider.
  api_key_required: boolean;
  kind: FamilyKind;
  base_url: string;
  model: string;
  source: ProviderSource;
}

export interface NewProvider {
  id: string;
  label: string;
  family: string;
  kind: FamilyKind;
  base_url: string;
  model: string;
  api_key: string;
}

export interface UpdateProvider {
  id: string;
  label?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
}

export const api = {
  projects: {
    list: () => invoke<ProjectInfo[]>("list_projects"),
    get: (id: string) => invoke<ProjectInfo | null>("get_project", { id }),
    create: (vars: {
      name: string;
      kind: ProjectKind;
      template: string;
    }) =>
      invoke<ProjectInfo>("create_project", {
        name: vars.name,
        kind: vars.kind,
        template: vars.template,
      }),
    upgradeToSite: (id: string, template: string) =>
      invoke<ProjectInfo>("upgrade_to_site", { id, template }),
    delete: (id: string) => invoke<void>("delete_project", { id }),
  },

  // Legacy alias so existing call sites still work
  sites: {
    list: () => invoke<ProjectInfo[]>("list_projects"),
    get: (id: string) => invoke<ProjectInfo | null>("get_project", { id }),
    create: (
      name: string,
      template: string,
      kind: ProjectKind = "site"
    ) =>
      invoke<ProjectInfo>("create_project", {
        name,
        template,
        kind,
      }),
    delete: (id: string) => invoke<void>("delete_project", { id }),
  },

  preview: {
    status: () => invoke<PreviewStatus>("get_preview_status"),
    start: (sitePath: string, port: number) =>
      invoke<string>("start_preview", { sitePath, port }),
    stop: () => invoke<void>("stop_preview"),
  },

  // Notes: for kind=note projects, content lives in <project>/notes/*.md
  notes: {
    list: (projectPath: string) =>
      invoke<Note[]>("list_notes", { projectPath }),
    create: (vars: {
      projectPath: string;
      title: string;
      content: string;
      tags: string[];
    }) =>
      invoke<Note>("create_note", {
        projectPath: vars.projectPath,
        title: vars.title,
        content: vars.content,
        tags: vars.tags,
      }),
    update: (vars: {
      path: string;
      title: string;
      content: string;
      tags: string[];
    }) =>
      invoke<void>("update_note", {
        path: vars.path,
        title: vars.title,
        content: vars.content,
        tags: vars.tags,
      }),
    delete: (path: string) => invoke<void>("delete_note", { path }),
  },

  // Posts: for kind=site projects, content lives in <project>/content/posts/*.md
  content: {
    list: (sitePath: string) => invoke<Post[]>("get_posts", { sitePath }),
    create: (
      sitePath: string,
      title: string,
      type: string,
      content: string,
      tags: string[]
    ) =>
      invoke<Post>("create_post", {
        sitePath,
        title,
        postType: type,
        content,
        tags,
      }),
    update: (
      path: string,
      title: string,
      content: string,
      tags: string[]
    ) => invoke<void>("update_post", { path, title, content, tags }),
    delete: (path: string) => invoke<void>("delete_post", { path }),
  },

  ai: {
    chat: (prompt: string, systemPrompt?: string, overrides?: ChatOverrides) =>
      invoke<string>("ai_chat", {
        prompt,
        systemPrompt,
        overrides,
      }),
    listModels: (overrides?: ChatOverrides) =>
      invoke<string[]>("list_models", { overrides }),
  },

  settings: {
    get: () => invoke<Settings>("get_settings"),
    save: (settings: Settings) => invoke<void>("save_settings", { settings }),
    getConfiguredAIOptions: () => invoke<AIOption[]>("get_configured_ai_options"),
    getSessionToken: () => invoke<string>("get_session_token"),
  },

  providers: {
    list: () => invoke<ProviderEntry[]>("list_providers"),
    add: (provider: NewProvider) =>
      invoke<ProviderEntry>("add_provider", { provider }),
    update: (patch: UpdateProvider) =>
      invoke<ProviderEntry>("update_provider", { patch }),
    remove: (id: string) => invoke<void>("remove_provider", { id }),
    resolveKey: (id: string) =>
      invoke<string | null>("resolve_provider_key", { id }),
    listModels: (providerId: string) =>
      invoke<string[]>("list_models", { overrides: { provider_id: providerId } }),
  },

  deploy: {
    buildSite: (sitePath: string) =>
      invoke<BuildResult>("build_site", { sitePath }),
  },
};
