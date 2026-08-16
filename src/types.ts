export type Surface = "desktop" | "cli";
export type Engine = "codex" | "opencode";

export interface ProviderConfig {
  /** provider id in config.toml, e.g. "deepseek" */
  id: string;
  name?: string;
  baseUrl?: string;
  wireApi?: "responses";
  /** env var name holding the API key (config.toml env_key) */
  envKey?: string;
}

export interface McpServerDef {
  name: string;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface Instance {
  id: string;
  label: string;
  /** Engine: codex (ChatGPT desktop app + CLI) or opencode */
  engine?: Engine;
  /** CODEX_HOME directory (the config directory for opencode instances) */
  home: string;
  /** Electron --user-data-dir (isolated desktop profile); unset for official instances (reuse the signed-in default profile) */
  profile?: string;
  /** Third-party provider; defaults to official OpenAI (ChatGPT sign-in) */
  provider?: ProviderConfig;
  model: string;
  /** Optional model pool (multi-select config); model is the currently active one */
  models?: string[];
  /** Preset key used at creation time (zen/go/deepseek), for echoing the model pool in the panel */
  preset?: string;
  /** Path to the models.json catalog */
  modelCatalog?: string;
  reasoningEffort?: string;
  preferredAuthMethod?: "apikey" | "chatgpt";
  surfaces: Surface[];
  /** Project trust inherited on clone (projects.*.trust_level) */
  trustProjects?: string[];
  /** Non-system MCP servers inherited on clone */
  mcpServers?: McpServerDef[];
  inheritFrom?: string;
  createdAt: string;
}

export interface RunningProc {
  instanceId: string;
  surface: Surface;
  pid: number;
  startedAt: string;
  /** Process fingerprint (start time + command-line digest) to avoid PID-reuse misjudgment */
  fingerprint?: string;
}

export interface InstanceRuntimeStatus {
  processes: {
    pid: number;
    surface: Surface;
    startedAt?: string;
    source: "registry" | "desktop-scan" | "tracked-fallback";
    managed: boolean;
    stale?: boolean;
  }[];
  profileInUse: boolean;
  untrackedDesktop: boolean;
}

export interface RegistryFile {
  version: 1;
  instances: Instance[];
  /** Directories removed from the registry but intentionally kept on disk. */
  ignoredInstanceIds?: string[];
}
