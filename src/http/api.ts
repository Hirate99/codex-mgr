import { Hono } from "hono";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { Registry } from "../registry";
import { probe, runningDesktopProcesses, isPidAlive } from "../probe";
import { importCodexConfig } from "../import";
import { createInstance, switchInstanceModel, PROVIDER_PRESETS } from "../clone";
import { launch } from "../launcher";
import { deleteSecret, loadSecrets, setSecret } from "../secrets";
import { defaultCodexHome, defaultDesktopProfile, instanceHome, instancesRoot } from "../paths";
import {
  officialModels,
  catalogModels,
  probeProviderModels,
  collectAllModelsFromProviders,
  buildProviderCatalog,
} from "../models";
import { importOpencodeAuth, opencodeKeyFor } from "../opencode";
import {
  configureOpenCodexProvider,
  opencodexPort,
  opencodexStatus,
  startOpencodex,
  stopOpencodex,
} from "../opencodex-adapter";
import { listActivity, recordActivity } from "../activity";
import { bindRuntimeRegistry, resolveInstanceRuntime, stopInstanceProcesses } from "../runtime";
import type { Instance, Surface } from "../types";

const reservedInstanceIds = new Set(["official"]);

export const registry = new Registry();
let secrets = loadSecrets();
bindRuntimeRegistry(registry);

seed();

function seed(): void {
  if (!registry.get("official") && existsSync(defaultCodexHome())) {
    const imported = importCodexConfig();
    registry.upsert({
      id: "official",
      label: "官方 OpenAI",
      home: defaultCodexHome(),
      model: imported.model ?? "gpt-5.6-sol",
      preferredAuthMethod: "chatgpt",
      surfaces: ["desktop", "cli"],
      createdAt: new Date().toISOString(),
    });
  }
  if (existsSync(instancesRoot())) {
    const dirs = readdirSync(instancesRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const d of dirs) {
      const home = `${instancesRoot()}/${d}`;
      if (!existsSync(`${home}/config.toml`)) continue;
      const id = d;
      if (registry.get(id) || registry.isIgnored(id)) continue;
      try {
        const parsed = parseToml(readFileSync(`${home}/config.toml`, "utf8")) as any;
        const providers = parsed.model_providers ?? {};
        const providerId =
          typeof parsed.model_provider === "string" ? parsed.model_provider : undefined;
        const def = providerId ? providers[providerId] : undefined;
        registry.upsert({
          id,
          label: id,
          home,
          profile: providerId ? `${home}/.desktop-profile` : undefined,
          provider: providerId
            ? {
                id: providerId,
                baseUrl: def?.base_url,
                wireApi: def?.wire_api,
                envKey: def?.env_key,
              }
            : undefined,
          model: parsed.model ?? "",
          modelCatalog: parsed.model_catalog_json,
          reasoningEffort: parsed.model_reasoning_effort,
          preferredAuthMethod: providerId ? "apikey" : "chatgpt",
          surfaces: ["desktop", "cli"],
          createdAt: new Date().toISOString(),
        });
      } catch {}
    }
  }
}

function targets() {
  const p = probe();
  return {
    desktopAppPath: p.desktopApp?.path,
    codexCliPath: p.codexCli?.path,
    opencodeCliPath: p.opencodeCli?.path,
  };
}

function isOfficial(i: Instance): boolean {
  return !i.provider || i.home === defaultCodexHome();
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function desktopBelongsTo(i: Instance, process: { userDataDir?: string }): boolean {
  if (i.profile && process.userDataDir) return samePath(i.profile, process.userDataDir);
  if (!i.profile && i.home === defaultCodexHome()) {
    return !process.userDataDir || samePath(process.userDataDir, defaultDesktopProfile());
  }
  return false;
}

function serialize(i: Instance) {
  const runtime = resolveInstanceRuntime(i);
  const running = runtime.processes
    .filter((process) => !process.stale && process.pid > 0)
    .map((process) => process.surface);
  return {
    ...i,
    running,
    runtime,
    official: isOfficial(i),
    apiKeyConfigured: i.provider?.envKey ? Boolean(secrets[i.provider.envKey]) : undefined,
    presetRequiresAdapter:
      i.preset === "zen" || i.preset === "go" || i.preset === "opencodex-go",
  };
}

export const api = new Hono();

api.get("/api/adapters/opencodex", async (c) => {
  return c.json(await opencodexStatus());
});

api.post("/api/adapters/opencodex/start", async (c) => {
  const result = await startOpencodex();
  recordActivity({
    type: "adapter",
    level: result.running ? "info" : "error",
    message: result.running
      ? `OpenCodex 已就绪（pid ${result.pid ?? "unknown"}）`
      : `OpenCodex 启动失败：${result.error ?? "unknown"}`,
    detail: { ...result },
  });
  return c.json(result, result.running ? 200 : 409);
});

api.post("/api/adapters/opencodex/stop", async (c) => {
  const result = await stopOpencodex();
  recordActivity({
    type: "adapter",
    level: result.ok ? "info" : "error",
    message: result.ok ? "OpenCodex 已停止" : `OpenCodex 停止失败：${result.error}`,
  });
  return c.json(result, result.ok ? 200 : 500);
});

api.get("/api/status", (c) => {
  const p = probe();
  const procs = registry.listProcs().map((proc) => ({
    ...proc,
    alive: isPidAlive(proc.pid),
  }));
  return c.json({
    platform: p.platform,
    codexCli: p.codexCli,
    opencodeCli: p.opencodeCli,
    desktopApp: p.desktopApp,
    codexHome: p.codexHome,
    codexHomeExists: p.codexHomeExists,
    runningDesktop: runningDesktopProcesses(),
    procs,
    opencodeAuth: importOpencodeAuth(),
  });
});

api.get("/api/instances", (c) => {
  return c.json(registry.list().map((instance) => serialize(instance)));
});

api.get("/api/instances/:id/activity", (c) => {
  const instance = registry.get(c.req.param("id"));
  if (!instance) return c.json({ error: "实例不存在" }, 404);
  return c.json({ events: listActivity(instance.id).slice(0, 50) });
});

api.get("/api/import", (c) => {
  const codex = importCodexConfig();
  return c.json({
    codex: {
      path: codex.path,
      model: codex.model,
      modelProvider: codex.modelProvider,
      providers: codex.providers,
      trustProjectsCount: codex.trustProjects.length,
      mcpServers: codex.mcpServers.map((m) => m.name),
    },
    presets: Object.keys(PROVIDER_PRESETS),
    opencode: importOpencodeAuth(),
  });
});

api.get("/api/models", async (c) => {
  const refresh = c.req.query("refresh") === "1";
  return c.json(
    await collectAllModelsFromProviders(refresh, [
      {
        presetId: "deepseek",
        baseUrl: PROVIDER_PRESETS.deepseek.baseUrl!,
        apiKey: secrets[PROVIDER_PRESETS.deepseek.envKey!],
      },
    ]),
  );
});

api.post("/api/models/custom", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    baseUrl?: string;
    envKey?: string;
  };
  if (body.baseUrl && body.envKey && secrets[body.envKey]) {
    return c.json(await probeProviderModels(body.baseUrl, secrets[body.envKey]));
  }
  return c.json({
    source: "none",
    models: [],
    error: "自定义 provider：填写 API key 后可直接探测 /models",
  });
});

interface CreateBody {
  id?: string;
  label?: string;
  model?: string;
  models?: string[];
  providerPreset?: string;
  official?: boolean;
  provider?: {
    id: string;
    baseUrl?: string;
    wireApi?: "responses";
    envKey?: string;
    name?: string;
  };
  reasoningEffort?: string;
  apiKey?: string;
  surfaces?: Surface[];
}

api.post("/api/instances", async (c) => {
  const body = (await c.req.json()) as CreateBody;
  const id = (body.id ?? body.label ?? "").trim().replace(/[^\w.-]+/g, "-").toLowerCase();
  if (!id) return c.json({ error: "缺少 id 或 label" }, 400);
  if (registry.get(id)) return c.json({ error: `实例 ${id} 已存在` }, 409);
  if (reservedInstanceIds.has(id)) return c.json({ error: `${id} 是保留实例 ID` }, 409);
  if (existsSync(instanceHome(id))) {
    return c.json(
      { error: `实例目录已存在：${instanceHome(id)}。请使用其他 ID，或先删除/导入该目录` },
      409,
    );
  }

  const imported = importCodexConfig();

  if (body.official) {
    const instance: Instance = {
      id,
      label: body.label ?? "官方 OpenAI",
      home: defaultCodexHome(),
      model: body.model ?? imported.model ?? "gpt-5.6-sol",
      preferredAuthMethod: "chatgpt",
      surfaces: body.surfaces ?? ["desktop", "cli"],
      createdAt: new Date().toISOString(),
    };
    registry.upsert(instance);
    return c.json({ instance: serialize(instance), changes: [], warnings: [], secretNote: "" });
  }

  const preset = body.providerPreset ? PROVIDER_PRESETS[body.providerPreset] : undefined;
  const envKey = preset?.envKey ?? body.provider?.envKey;
  let secretNote = "";
  if (envKey) {
    const providedKey = body.apiKey?.trim();
    if (providedKey) {
      setSecret(envKey, providedKey);
      secrets = loadSecrets();
      secretNote = `API key 已更新 .env (${envKey})`;
    } else if (!secrets[envKey]) {
      const opencodeKey =
        opencodeKeyFor(preset?.id ?? "") ?? opencodeKeyFor(body.providerPreset ?? "");
      if (opencodeKey) {
        setSecret(envKey, opencodeKey);
        secrets = loadSecrets();
        secretNote = `已自动从 opencode auth.json 导入 ${envKey}`;
      } else {
        secretNote = `警告：未配置 ${envKey}，桌面客户端会回退到登录界面`;
      }
    }
  }

  if (body.providerPreset === "zen" || body.providerPreset === "go" || body.providerPreset === "opencodex-go") {
    const adapter = await startOpencodex(
      opencodexPort,
      secrets["OPENCODE_GO_API_KEY"] ?? secrets["OPENCODE_API_KEY"],
    );
    if (!adapter.running) {
      return c.json(
        {
          error:
            adapter.error ??
            "OpenCodex 未运行，请检查项目依赖和本地端口 10100",
          adapter,
        },
        409,
      );
    }
    if (preset?.upstreamBaseUrl) {
      const configured = await configureOpenCodexProvider({
        id: preset.id,
        baseUrl: preset.upstreamBaseUrl,
        apiKey: envKey ? secrets[envKey] : undefined,
        defaultModel: body.model,
      });
      if (!configured.ok) return c.json({ error: configured.error ?? "OpenCodex provider 配置失败" }, 409);
    }
  }

  let liveDeepSeekModels: Awaited<ReturnType<typeof probeProviderModels>> | undefined;
  const activeApiKey = envKey ? secrets[envKey] : undefined;
  if (body.providerPreset === "deepseek" && preset?.baseUrl && activeApiKey) {
    liveDeepSeekModels = await probeProviderModels(preset.baseUrl, activeApiKey, true);
  }

  const liveSlugs = liveDeepSeekModels?.models.map((item) => item.slug) ?? [];
  const requestedModels = body.models?.filter(
    (item) => liveSlugs.length === 0 || liveSlugs.includes(item),
  );
  const models = requestedModels?.length
    ? requestedModels
    : liveSlugs.length
      ? liveSlugs
      : body.models;
  const model = models?.[0] ?? body.model ?? preset?.defaultModel;
  if (liveDeepSeekModels?.models.length) {
    secretNote = `${secretNote ? `${secretNote}；` : ""}DeepSeek 模型目录已从 /models 同步`;
  } else if (body.providerPreset === "deepseek" && activeApiKey) {
    secretNote = `${secretNote ? `${secretNote}；` : ""}DeepSeek /models 探测失败，使用内置目录`;
  }
  if (!model) return c.json({ error: "缺少模型" }, 400);

  try {
    const out = createInstance(
      {
        id,
        label: body.label ?? id,
        model,
        models,
        providerPreset: body.providerPreset,
        provider: body.provider,
        reasoningEffort: body.reasoningEffort ?? "high",
        surfaces: body.surfaces ?? ["desktop", "cli"],
        inheritFrom: "official",
        baseConfigPath: `${defaultCodexHome()}/config.toml`,
        modelCatalogData:
          body.providerPreset === "deepseek" && liveDeepSeekModels?.models.length
            ? buildProviderCatalog("deepseek", liveDeepSeekModels.models)
            : undefined,
      },
      instanceHome(id),
    );
    registry.upsert(out.instance);
    recordActivity({
      type: "create",
      level: out.warnings.length ? "warn" : "info",
      instanceId: id,
      message: `实例已创建，${out.changes.length} 处配置变更`,
      detail: { changes: out.changes, warnings: out.warnings, secretNote },
    });
    return c.json(
      { instance: serialize(out.instance), changes: out.changes, warnings: out.warnings, secretNote },
      201,
    );
  } catch (e: any) {
    return c.json({ error: e?.message ?? "创建失败" }, 500);
  }
});

api.post("/api/instances/:id/switch-model", async (c) => {
  const instance = registry.get(c.req.param("id"));
  if (!instance) return c.json({ error: "实例不存在" }, 404);
  const body = (await c.req.json()) as { model?: string };
  if (!body.model) return c.json({ error: "缺少 model" }, 400);
  try {
    const r = switchInstanceModel(instance, body.model);
    instance.model = body.model;
    registry.upsert(instance);
    recordActivity({
      type: "switch-model",
      level: r.warnings.length ? "warn" : "info",
      instanceId: instance.id,
      message: `模型已切换到 ${body.model}`,
      detail: { changes: r.changes, warnings: r.warnings },
    });
    return c.json({ changes: r.changes, warnings: r.warnings });
  } catch (e: any) {
    return c.json({ error: e?.message ?? "切换失败" }, 500);
  }
});

api.post("/api/instances/:id/launch", async (c) => {
  const instance = registry.get(c.req.param("id"));
  if (!instance) return c.json({ error: "实例不存在" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { surface?: Surface };
  const surface = body.surface ?? "desktop";
  const key = instance.provider?.envKey;
  if (surface === "desktop" && key && !secrets[key]) {
    return c.json(
      { error: `缺少 ${key}（~/.codex-mgr/.env 未配置），桌面客户端会退回登录界面；请先在面板填写 API key` },
      409,
    );
  }
  const runtime = resolveInstanceRuntime(instance);
  if (runtime.processes.some((process) => process.surface === surface && !process.stale && process.pid > 0)) {
    return c.json({ error: `实例已在该 surface 运行`, runtime }, 409);
  }
  registry.deleteProc(instance.id, surface);
  try {
    const proc = launch(instance, surface, targets(), secrets);
    registry.setProc(proc);
    recordActivity({
      type: "launch",
      level: "info",
      instanceId: instance.id,
      message: `${surface === "desktop" ? "桌面客户端" : "Codex CLI"} 已启动（pid ${proc.pid}）`,
      detail: { surface, pid: proc.pid, fingerprint: proc.fingerprint },
    });
    return c.json(proc, 201);
  } catch (e: any) {
    recordActivity({
      type: "error",
      level: "error",
      instanceId: instance.id,
      message: `启动 ${surface} 失败：${e?.message ?? "unknown"}`,
    });
    return c.json({ error: e?.message ?? "启动失败" }, 500);
  }
});

api.post("/api/instances/:id/stop", async (c) => {
  const instance = registry.get(c.req.param("id"));
  if (!instance) return c.json({ error: "实例不存在" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { surface?: Surface };
  const surface = body.surface ?? "desktop";
  const result = stopInstanceProcesses(instance, surface);
  registry.deleteProc(instance.id, surface);
  const ok = result.failed.length === 0 && result.killed.length > 0;
  recordActivity({
    type: "stop",
    level: ok ? "info" : "error",
    instanceId: instance.id,
    message: ok
      ? `${surface} 已停止（pid ${result.killed.join(", ")}）`
      : `停止 ${surface} 失败（killed=${result.killed.join(", ") || "none"}, failed=${result.failed.join(", ") || "none"}）`,
    detail: { ...result },
  });
  if (!ok) {
    return c.json(
      {
        error: result.killed.length > 0
          ? `部分进程已停止，但 pid ${result.failed.join(", ")} 停止失败`
          : `未找到可停止的 ${surface} 进程`,
        ...result,
      },
      result.killed.length > 0 ? 500 : 404,
    );
  }
  return c.json({ ok, ...result });
});

api.delete("/api/instances/:id", (c) => {
  const instance = registry.get(c.req.param("id"));
  if (!instance) return c.json({ error: "实例不存在" }, 404);
  if (isOfficial(instance)) {
    return c.json({ error: "官方实例不可删除（共享已登录客户端与 ~/.codex）" }, 403);
  }
  stopInstanceProcesses(instance, "desktop");
  stopInstanceProcesses(instance, "cli");
  registry.deleteProc(instance.id, "desktop");
  registry.deleteProc(instance.id, "cli");
  const envKey = instance.provider?.envKey;
  let removedFiles = false;
  let removedSecret = false;
  const root = resolve(instancesRoot());
  const home = resolve(instance.home);
  const rel = relative(root, home);
  const insideInstancesRoot = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (insideInstancesRoot && existsSync(home)) {
    rmSync(home, { recursive: true, force: true });
    removedFiles = true;
  }
  registry.remove(instance.id);
  // API keys are shared by env var name. Remove the secret only when no
  // remaining instance references it.
  if (envKey && !registry.list().some((other) => other.provider?.envKey === envKey)) {
    deleteSecret(envKey);
    secrets = loadSecrets();
    removedSecret = true;
  }
  recordActivity({
    type: "delete",
    level: "info",
    instanceId: instance.id,
    message: `实例已删除${removedFiles ? "及其实例目录" : ""}${removedSecret ? "，并清理 API key" : ""}`,
  });
  return c.json({ ok: true, removedFiles, removedSecret });
});

api.post("/api/secrets", async (c) => {
  const body = (await c.req.json()) as { key?: string; value?: string };
  if (!body.key) return c.json({ error: "缺少 key" }, 400);
  setSecret(body.key, body.value ?? "");
  secrets = loadSecrets();
  return c.json({ ok: true });
});
