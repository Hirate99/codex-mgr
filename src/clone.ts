import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";
import type { Instance, ProviderConfig } from "./types";

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl?: string;
  upstreamBaseUrl?: string;
  wireApi?: "responses";
  envKey?: string;
  catalogFile?: string;
  defaultModel?: string;
  presetKey?: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    name: "deepseek",
    baseUrl: "https://api.deepseek.com/",
    wireApi: "responses",
    envKey: "DEEPSEEK_API_KEY",
    catalogFile: "deepseek.models.json",
    defaultModel: "deepseek-v4-pro",
  },
  zen: {
    id: "opencode",
    name: "opencode",
    baseUrl: "http://127.0.0.1:10100/v1",
    upstreamBaseUrl: "https://opencode.ai/zen/v1",
    wireApi: "responses",
    envKey: "OPENCODE_API_KEY",
    catalogFile: "opencode.models.json",
    defaultModel: "big-pickle",
  },
  go: {
    id: "opencode-go",
    name: "opencode-go",
    baseUrl: "http://127.0.0.1:10100/v1",
    upstreamBaseUrl: "https://opencode.ai/zen/go/v1",
    wireApi: "responses",
    envKey: "OPENCODE_GO_API_KEY",
    catalogFile: "opencode-go.models.json",
    defaultModel: "kimi-k2.7-code",
  },
  "opencodex-go": {
    id: "opencodex-go",
    name: "OpenCode Go",
    baseUrl: "http://127.0.0.1:10100/v1",
    upstreamBaseUrl: "https://opencode.ai/zen/go/v1",
    wireApi: "responses",
    envKey: "OPENCODE_GO_API_KEY",
    catalogFile: "opencode-go.models.json",
    defaultModel: "kimi-k2.7-code",
  },
};

function catalogsDir(): string {
  return join(process.cwd(), "src", "catalogs");
}

const DEL_A = ["profile", "oss_provider", "openai_base_url"];
const DEL_B = [
  "model_context_window",
  "model_auto_compact_token_limit",
  "model_auto_compact_token_limit_scope",
  "base_instructions",
  "model_instructions_file",
  "compact_prompt",
  "experimental_compact_prompt_file",
  "service_tier",
  "model_verbosity",
  "model_reasoning_summary",
  "plan_mode_reasoning_effort",
  "experimental_use_unified_exec_tool",
];

export interface ConfigureInput {
  model: string;
  provider?: ProviderConfig;
  modelCatalog?: string;
  reasoningEffort?: string;
  baseConfigPath?: string;
}

export interface ConfigureResult {
  toml: string;
  changes: string[];
  warnings: string[];
}

const DEFAULT_MODEL_INSTRUCTIONS = "You are Codex, an AI coding assistant. Follow the user's instructions and help complete software engineering tasks.";

/** Make provider catalogs accepted by the current Codex CLI. */
export function ensureModelCatalogCompatibility(path: string): void {
  if (!existsSync(path)) return;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { models?: Record<string, any>[] };
    if (!Array.isArray(data.models)) return;
    let changed = false;
    for (const model of data.models) {
      if (!model || typeof model !== "object") continue;
      if (typeof model.base_instructions !== "string" && !model.model_messages?.instructions_template) {
        model.base_instructions = DEFAULT_MODEL_INSTRUCTIONS;
        changed = true;
      }
    }
    if (changed) writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // The CLI will report malformed catalogs with the original parse error.
  }
}

export function renderInstanceConfig(input: ConfigureInput): ConfigureResult {
  const changes: string[] = [];
  const warnings: string[] = [];

  let doc: Record<string, any> = {};
  if (input.baseConfigPath && existsSync(input.baseConfigPath)) {
    try {
      doc = parse(readFileSync(input.baseConfigPath, "utf8")) as Record<string, any>;
    } catch (e: any) {
      warnings.push(`Failed to parse base config ${input.baseConfigPath}; continuing with an empty config: ${e?.message}`);
      doc = {};
    }
  }

  const report = (msg: string) => changes.push(msg);

  for (const k of DEL_A) {
    if (k in doc) {
      report(`Removed ${k} (it would shadow or hijack the target config)`);
      delete doc[k];
    }
  }
  for (const k of DEL_B) {
    if (k in doc) {
      report(`Removed ${k} (conflicts with the models.json declaration)`);
      delete doc[k];
    }
  }
  if (doc.profiles) {
    warnings.push("Removed the profiles section (profiles would shadow top-level config)");
    delete doc.profiles;
  }

  const setKey = (k: string, v: string) => {
    if (doc[k] !== v) {
      report(doc[k] === undefined ? `Set ${k} = ${v}` : `Rewrote ${k}: ${JSON.stringify(doc[k])} → ${JSON.stringify(v)}`);
      doc[k] = v;
    }
  };

  setKey("model", input.model);
  if (input.provider) {
    setKey("model_provider", input.provider.id);
    setKey("preferred_auth_method", "apikey");
    setKey("forced_login_method", "api");
  } else {
    delete doc.model_provider;
    delete doc.preferred_auth_method;
    delete doc.forced_login_method;
  }
  if (input.reasoningEffort) setKey("model_reasoning_effort", input.reasoningEffort);
  if (input.modelCatalog) setKey("model_catalog_json", resolve(input.modelCatalog));

  if (doc.model_providers && typeof doc.model_providers === "object") {
    for (const [pid, def] of Object.entries(doc.model_providers as Record<string, any>)) {
      if (def && typeof def === "object" && def.wire_api === "chat") {
        def.wire_api = "responses";
        report(`Fixed [model_providers.${pid}] wire_api: "chat" → "responses"`);
      }
    }
  }

  if (input.provider) {
    const p = input.provider;
    const prev = doc.model_providers?.[p.id];
    if (prev) report(`Rewrote [model_providers.${p.id}]`);
    else report(`Set [model_providers.${p.id}]`);
    const def: Record<string, string> = {};
    if (p.name) def.name = p.name;
    if (p.baseUrl) def.base_url = p.baseUrl;
    if (p.wireApi) def.wire_api = p.wireApi;
    if (p.envKey) def.env_key = p.envKey;
    doc.model_providers = { ...(doc.model_providers ?? {}), [p.id]: def };

    // Third-party instances must not inherit the elevated sandbox from the official config:
    // on Windows it needs UAC elevation to install low-privilege sandbox users, and failures
    // repeatedly pop up dialogs and report "file not found".
    // Note that [windows] sandbox only accepts "elevated" / "unelevated"; "workspace-write"
    // is a macOS/Linux value, and writing it into a Windows config makes the whole
    // config.toml fail to parse, so the desktop app falls back to the login screen.
    if (
      doc.windows &&
      typeof doc.windows === "object" &&
      (doc.windows as Record<string, unknown>).sandbox === "elevated"
    ) {
      (doc.windows as Record<string, unknown>).sandbox = "unelevated";
      report(`[windows] sandbox: "elevated" → "unelevated" (avoid UAC pop-ups for third-party instances)`);
    }
  }

  const toml = stringify(doc) + "\n";
  try {
    parse(toml);
  } catch (e: any) {
    throw new Error(`Generated config.toml failed TOML validation: ${e?.message}`);
  }
  return { toml, changes, warnings };
}

// ---------- Instance creation / model switching ----------

export interface CloneInput {
  id: string;
  label: string;
  model: string;
  models?: string[];
  providerPreset?: string;
  provider?: ProviderConfig;
  reasoningEffort?: string;
  surfaces: Instance["surfaces"];
  inheritFrom?: string;
  baseConfigPath?: string;
  modelCatalogData?: { models: Record<string, unknown>[] };
}

export interface CloneOutput {
  instance: Instance;
  changes: string[];
  warnings: string[];
}

export function createInstance(input: CloneInput, home: string): CloneOutput {
  const preset = input.providerPreset ? PROVIDER_PRESETS[input.providerPreset] : undefined;
  const provider: ProviderConfig | undefined = preset
    ? {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        wireApi: preset.wireApi,
        envKey: preset.envKey,
      }
    : input.provider;

  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "backup-codex-mgr"), { recursive: true });

  const existing = join(home, "config.toml");
  if (existsSync(existing)) {
    copyFileSync(existing, join(home, "backup-codex-mgr", `config.toml.${Date.now()}.bak`));
  }

  const modelCatalog = preset?.catalogFile ? join(home, "models.json") : undefined;

  const r = renderInstanceConfig({
    model: input.model,
    provider,
    modelCatalog,
    reasoningEffort: input.reasoningEffort ?? "high",
    baseConfigPath: input.baseConfigPath,
  });

  const tmp = `${existing}.tmp-${process.pid}`;
  writeFileSync(tmp, r.toml, "utf8");
  renameSync(tmp, existing);

  if (preset?.catalogFile && input.modelCatalogData) {
    writeFileSync(modelCatalog!, JSON.stringify(input.modelCatalogData, null, 2) + "\n", "utf8");
  } else if (preset?.catalogFile) {
    const src = join(catalogsDir(), preset.catalogFile);
    if (existsSync(src)) copyFileSync(src, modelCatalog!);
  }
  if (modelCatalog) ensureModelCatalogCompatibility(modelCatalog);

  const instance: Instance = {
    id: input.id,
    label: input.label,
    home,
    profile: provider ? join(home, ".desktop-profile") : undefined,
    provider,
    model: input.model,
    models: input.models?.length ? input.models : undefined,
    preset: input.providerPreset,
    modelCatalog,
    reasoningEffort: input.reasoningEffort ?? "high",
    preferredAuthMethod: provider ? "apikey" : "chatgpt",
    surfaces: input.surfaces,
    inheritFrom: input.inheritFrom,
    createdAt: new Date().toISOString(),
  };

  return { instance, changes: r.changes, warnings: r.warnings };
}

export function switchInstanceModel(instance: Instance, newModel: string): ConfigureResult {
  const existing = join(instance.home, "config.toml");
  if (!existsSync(existing)) {
    throw new Error(`Instance ${instance.id} is missing config.toml`);
  }
  copyFileSync(
    existing,
    join(instance.home, "backup-codex-mgr", `config.toml.${Date.now()}.bak`),
  );
  const r = renderInstanceConfig({
    model: newModel,
    provider: instance.provider,
    modelCatalog: instance.modelCatalog,
    reasoningEffort: instance.reasoningEffort,
    baseConfigPath: existing,
  });
  const tmp = `${existing}.tmp-${process.pid}`;
  writeFileSync(tmp, r.toml, "utf8");
  renameSync(tmp, existing);
  return r;
}

export function readCatalogSlugs(home: string): string[] {
  const p = join(home, "models.json");
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      models?: { slug?: string }[];
    };
    return (parsed.models ?? []).map((m) => m.slug ?? "").filter(Boolean);
  } catch {
    return [];
  }
}
