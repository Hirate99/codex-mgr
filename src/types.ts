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
  /** 引擎：codex（ChatGPT 桌面客户端 + CLI）或 opencode */
  engine?: Engine;
  /** CODEX_HOME 目录（opencode 实例为其配置目录） */
  home: string;
  /** Electron --user-data-dir（桌面客户端隔离 profile）；官方实例不填（复用已登录默认 profile） */
  profile?: string;
  /** 第三方 provider；缺省 = 官方 OpenAI（ChatGPT 登录） */
  provider?: ProviderConfig;
  model: string;
  /** 可选模型池（多选配置），model 为当前激活项 */
  models?: string[];
  /** 创建时使用的预设 key（zen/go/deepseek），用于面板回显模型池 */
  preset?: string;
  /** models.json 模型目录路径 */
  modelCatalog?: string;
  reasoningEffort?: string;
  preferredAuthMethod?: "apikey" | "chatgpt";
  surfaces: Surface[];
  /** 克隆时继承的项目信任（projects.*.trust_level） */
  trustProjects?: string[];
  /** 克隆时继承的非系统 MCP server */
  mcpServers?: McpServerDef[];
  inheritFrom?: string;
  createdAt: string;
}

export interface RunningProc {
  instanceId: string;
  surface: Surface;
  pid: number;
  startedAt: string;
  /** 进程指纹（创建时间+命令行摘要），防止 PID 复用误判 */
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
