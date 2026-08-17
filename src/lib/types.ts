export interface Status {
  platform: string;
  codexCli?: { path: string; version?: string };
  opencodeCli?: { path: string; version?: string };
  desktopApp?: { path: string; defaultProfile: string };
  codexHome: string;
  codexHomeExists: boolean;
  runningDesktop: { pid: number; userDataDir?: string }[];
  procs: { instanceId: string; surface: string; pid: number; alive: boolean }[];
  opencodeAuth: { path?: string; entries: { provider: string; hasKey: boolean }[] };
}

export interface InstanceView {
  id: string;
  label: string;
  home: string;
  profile?: string;
  provider?: { id: string; envKey?: string };
  model: string;
  models?: string[];
  preset?: string;
  modelCatalog?: string;
  official?: boolean;
  running: string[];
  runtime?: InstanceRuntimeView;
  apiKeyConfigured?: boolean;
  presetRequiresAdapter?: boolean;
}

export interface RuntimeProcessView {
  pid: number;
  surface: "desktop" | "cli";
  startedAt?: string;
  source: "registry" | "desktop-scan" | "tracked-fallback";
  managed: boolean;
  stale?: boolean;
}

export interface InstanceRuntimeView {
  processes: RuntimeProcessView[];
  profileInUse: boolean;
  untrackedDesktop: boolean;
}

export interface ActivityEventView {
  at: string;
  type: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ModelOption {
  slug: string;
  displayName: string;
  description?: string;
}

export interface ModelList {
  source: string;
  models: ModelOption[];
  error?: string;
}

export interface AllModels {
  official: ModelList;
  presets: Record<string, ModelList>;
  opencode: ModelList;
}

export interface OpenCodexStatus {
  installed: boolean;
  running: boolean;
  port: number;
  healthUrl: string;
  version?: string;
  error?: string;
}

export type Preset = "deepseek" | "official" | "zen" | "go" | "opencodex-go" | "custom";

export interface CreateFormState {
  preset: Preset;
  id: string;
  label: string;
  selectedModels: string[];
  pid: string;
  baseUrl: string;
  envKey: string;
  apiKey: string;
}

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
