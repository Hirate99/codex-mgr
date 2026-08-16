import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { codexCliCandidates } from "./paths";
import { spawnSync } from "./proc";

export interface ModelOption {
  slug: string;
  displayName: string;
  description?: string;
  reasoningLevels?: string[];
}

export interface ModelListResult {
  source: "bundled-catalog" | "codex-cli" | "provider-api" | "opencode-cli" | "none";
  models: ModelOption[];
  error?: string;
}

export interface ModelCatalogDocument {
  models: Record<string, unknown>[];
}

function catalogsDir(): string {
  return join(process.cwd(), "src", "catalogs");
}

const CATALOG_FILES: Record<string, string> = {
  deepseek: "deepseek.models.json",
  zen: "opencode.models.json",
  go: "opencode-go.models.json",
};

export function presetCatalogFile(presetId: string): string | undefined {
  return CATALOG_FILES[presetId];
}

export function catalogModels(presetId: string): ModelListResult {
  const file = presetCatalogFile(presetId);
  if (!file) return { source: "none", models: [] };
  const p = join(catalogsDir(), file);
  if (!existsSync(p)) {
    return { source: "none", models: [], error: `缺少目录文件 ${file}` };
  }
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      models?: {
        slug?: string;
        display_name?: string;
        description?: string;
        supported_reasoning_levels?: { effort?: string }[];
      }[];
    };
    const models = (parsed.models ?? []).map((m) => ({
      slug: m.slug ?? "",
      displayName: m.display_name ?? m.slug ?? "",
      description: m.description,
      reasoningLevels: (m.supported_reasoning_levels ?? [])
        .map((r) => r.effort ?? "")
        .filter(Boolean),
    }));
    return { source: "bundled-catalog", models };
  } catch (e: any) {
    return { source: "none", models: [], error: e?.message ?? "catalog 解析失败" };
  }
}

function readCatalogDocument(presetId: string): ModelCatalogDocument {
  const file = presetCatalogFile(presetId);
  if (!file) return { models: [] };
  const p = join(catalogsDir(), file);
  if (!existsSync(p)) return { models: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { models?: unknown[] };
    return {
      models: (parsed.models ?? []).filter(
        (model): model is Record<string, unknown> => Boolean(model && typeof model === "object"),
      ),
    };
  } catch {
    return { models: [] };
  }
}

/** Convert provider /models data into the richer catalog consumed by Codex. */
export function buildProviderCatalog(
  presetId: string,
  models: ModelOption[],
): ModelCatalogDocument {
  const bundled = readCatalogDocument(presetId);
  const bySlug = new Map(
    bundled.models
      .filter((model) => typeof model.slug === "string")
      .map((model) => [model.slug as string, model]),
  );

  return {
    models: models.map((model, index) => {
      const existing = bySlug.get(model.slug);
      if (existing) {
        return {
          ...existing,
          slug: model.slug,
          display_name: model.displayName || existing.display_name || model.slug,
          ...(model.description ? { description: model.description } : {}),
          priority: index + 1,
          visibility: "list",
          supported_in_api: true,
        };
      }
      return {
        slug: model.slug,
        display_name: model.displayName || model.slug,
        description: model.description ?? "Model discovered from the provider API.",
        prefer_websockets: false,
        support_verbosity: false,
        input_modalities: ["text"],
        supports_image_detail_original: false,
        truncation_policy: { mode: "tokens", limit: 10000 },
        supports_parallel_tool_calls: true,
        tool_mode: null,
        multi_agent_version: "v2",
        use_responses_lite: false,
        include_skills_usage_instructions: false,
        context_window: 1048576,
        max_context_window: 1048576,
        effective_context_window_percent: 95,
        auto_compact_token_limit: null,
        reasoning_summary_format: "experimental",
        default_reasoning_summary: "none",
        default_reasoning_level: "high",
        supported_reasoning_levels: [
          { effort: "high", description: "Extra high reasoning depth for complex problems" },
          { effort: "max", description: "Maximum reasoning depth for the hardest problems" },
        ],
        shell_type: "shell_command",
        visibility: "list",
        supported_in_api: true,
        priority: index + 1,
        supports_search_tool: false,
        supports_reasoning_summaries: true,
      };
    }),
  };
}

let officialCache: { at: number; result: ModelListResult } | undefined;

export function officialModels(refresh = false): ModelListResult {
  if (!refresh && officialCache && Date.now() - officialCache.at < 30 * 1000) {
    return officialCache.result;
  }
  const result = probeOfficialModels();
  officialCache = { at: Date.now(), result };
  return result;
}

function probeOfficialModels(): ModelListResult {
  let out = "";
  for (const cand of codexCliCandidates()) {
    const cmd =
      cand.includes("/") || cand.includes("\\")
        ? [cand, "debug", "models", "--bundled"]
        : ["cmd", "/c", cand, "debug", "models", "--bundled"];
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
    if (r.status === 0 && r.stdout && r.stdout.length > 0) {
      out = r.stdout;
      break;
    }
  }
  if (!out) {
    return { source: "none", models: [], error: "codex debug models --bundled 探测失败" };
  }
  try {
    const parsed = JSON.parse(out) as {
      models?: {
        slug?: string;
        display_name?: string;
        description?: string;
        visibility?: string;
      }[];
    };
    const models = (parsed.models ?? [])
      .filter((m) => m.slug && m.visibility !== "hidden")
      .map((m) => ({
        slug: m.slug!,
        displayName: m.display_name ?? m.slug!,
        description: m.description,
      }));
    return { source: "codex-cli", models };
  } catch (e: any) {
    return { source: "none", models: [], error: `catalog JSON 解析失败: ${e?.message}` };
  }
}

const providerCache = new Map<string, { at: number; result: ModelListResult }>();

export async function probeProviderModels(
  baseUrl: string,
  apiKey: string,
  refresh = false,
): Promise<ModelListResult> {
  if (!baseUrl || !apiKey) {
    return { source: "none", models: [], error: "需要 base_url 与 API key" };
  }
  const cacheKey = `${baseUrl}\u0000${apiKey.slice(-8)}`;
  const cached = providerCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < 30 * 1000) return cached.result;
  try {
    const url = new URL("models", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const result = { source: "none" as const, models: [], error: `HTTP ${r.status}` };
      providerCache.set(cacheKey, { at: Date.now(), result });
      return result;
    }
    const parsed = (await r.json()) as { data?: { id?: string }[] };
    const models = (parsed.data ?? [])
      .map((m) => m.id ?? "")
      .filter(Boolean)
      .map((slug) => ({ slug, displayName: slug }));
    const result = { source: "provider-api" as const, models };
    providerCache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (e: any) {
    return { source: "none", models: [], error: e?.message ?? "探测失败" };
  }
}

export async function collectAllModelsFromProviders(
  refresh = false,
  providers: { presetId: string; baseUrl: string; apiKey?: string }[] = [],
): Promise<AllModels> {
  const all = collectAllModels(refresh);
  for (const provider of providers) {
    if (!provider.apiKey || !all.presets[provider.presetId]) continue;
    const live = await probeProviderModels(provider.baseUrl, provider.apiKey, refresh);
    if (live.models.length > 0) all.presets[provider.presetId] = live;
  }
  return all;
}

let opencodeCache: { at: number; result: ModelListResult } | undefined;

export function opencodeModels(refresh = false): ModelListResult {
  if (!refresh && opencodeCache && Date.now() - opencodeCache.at < 60 * 1000) {
    return opencodeCache.result;
  }
  const result = probeOpencodeModels();
  opencodeCache = { at: Date.now(), result };
  return result;
}

function probeOpencodeModels(): ModelListResult {
  let out = "";
  for (const cand of ["opencode.exe", "opencode.cmd", "opencode", "/usr/local/bin/opencode", "/opt/homebrew/bin/opencode"]) {
    const cmd =
      cand.includes("/") || cand.includes("\\")
        ? [cand, "models"]
        : process.platform === "win32"
          ? ["cmd", "/c", cand, "models"]
          : [cand, "models"];
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: 8000 });
    if (r.status === 0 && r.stdout) {
      out = r.stdout;
      break;
    }
  }
  if (!out) return { source: "none", models: [], error: "opencode models 探测失败" };
  const models = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/[\w.-]+$/.test(l))
    .map((slug) => ({ slug, displayName: slug }));
  return { source: "opencode-cli", models };
}

export interface AllModels {
  official: ModelListResult;
  presets: Record<string, ModelListResult>;
  opencode: ModelListResult;
}

export function collectAllModels(refresh = false): AllModels {
  const presets: Record<string, ModelListResult> = {};
  for (const p of Object.keys(CATALOG_FILES)) presets[p] = catalogModels(p);
  return {
    official: officialModels(refresh),
    presets,
    opencode: opencodeModels(refresh),
  };
}
