import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_PORT = 10100;

export interface OpenCodexStatus {
  installed: boolean;
  running: boolean;
  port: number;
  healthUrl: string;
  version?: string;
  error?: string;
}

export interface OpenCodexProviderInput {
  id: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

/** 仅记录由本进程实际启动的 opencodex server（端口被占用提前返回时不记录，避免误停别人的实例）。 */
let activeOpenCodexServer:
  | { stop: (force?: boolean) => void; port?: number }
  | undefined;

/**
 * 停止本进程内嵌启动的 opencodex 代理。返回是否确实停掉了服务；
 * 若 opencodex 由其它进程持有（端口已占用），这里不会动它。
 */
export function stopOpencodex(): boolean {
  if (!activeOpenCodexServer) return false;
  try {
    activeOpenCodexServer.stop(true);
  } catch {
    /* 忽略停止时的二次异常 */
  }
  activeOpenCodexServer = undefined;
  return true;
}

/**
 * opencodex 自己的 CLI 入口会安装 crash-guard（见其 src/lib/crash-guard.ts），
 * 拦截 Bun 流式响应被 abort/断开时抛出的已知良性错误：
 *   `TypeError: null is not an object`（native-only stack）
 * 但通过 loadBunApi() + startServer() 内嵌启动时该 guard 不会被安装，
 * 一旦 go/zen 客户端中途取消请求，Bun 默认行为会把整个面板进程带崩。
 * 这里安装等价的内嵌 guard：良性中断静默（限频记录），其余错误打印后保持进程存活。
 */
let embeddedCrashGuardInstalled = false;

function isBenignAbortTeardown(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const bareNullTeardown = err.message === "null is not an object";
  const lockedStreamTeardown =
    err.message === "Invalid state: ReadableStream is locked" &&
    (err as { code?: unknown }).code === "ERR_INVALID_STATE";
  if (!bareNullTeardown && !lockedStreamTeardown) return false;
  const stack = err.stack ?? "";
  // 真正的业务 TypeError 会带 (file:line:col) 帧；native-only 说明是 Bun 内部 teardown。
  return !/\((?!native:)[^)]*:\d+:\d+\)/.test(stack);
}

function installEmbeddedCrashGuard(): void {
  if (embeddedCrashGuardInstalled) return;
  embeddedCrashGuardInstalled = true;
  let benignSuppressed = 0;
  let benignLastLoggedAt = 0;
  const logBenign = () => {
    benignSuppressed++;
    const now = Date.now();
    if (now - benignLastLoggedAt < 5 * 60_000) return;
    benignLastLoggedAt = now;
    console.warn(
      `⚠️  opencodex 流中断 x${benignSuppressed}（Bun fetch-body abort；代理不受影响）`,
    );
    benignSuppressed = 0;
  };
  process.on("unhandledRejection", (reason) => {
    if (isBenignAbortTeardown(reason)) {
      logBenign();
      return;
    }
    console.error("⚠️  opencodex embedded unhandledRejection（代理保持运行）");
    console.error(reason);
  });
  process.on("uncaughtException", (err) => {
    if (isBenignAbortTeardown(err)) {
      logBenign();
      return;
    }
    console.error("⚠️  opencodex embedded uncaughtException（代理保持运行）");
    console.error(err);
  });
}

function command(): [string, string] | undefined {
  const bin = join(process.cwd(), "node_modules", "@bitkyc08", "opencodex", "bin", "ocx.mjs");
  if (!existsSync(bin)) return undefined;
  return [process.execPath, bin];
}

/** opencodex 管理 API 的 admin token：优先环境变量，否则读 ~/.opencodex/admin-api-token。 */
function adminToken(): string | undefined {
  const fromEnv = process.env.OPENCODEX_ADMIN_AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
  const path = join(home, ".opencodex", "admin-api-token");
  try {
    if (!existsSync(path)) return undefined;
    const token = readFileSync(path, "utf8").trim();
    return /^ocx_admin_[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

async function health(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1200),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function opencodexStatus(port = DEFAULT_PORT): Promise<OpenCodexStatus> {
  const cmd = command();
  const running = await health(port);
  let version: string | undefined;
  if (cmd) {
    const r = spawnSync(cmd[0], [cmd[1], "--version"], { encoding: "utf8" });
    if (r.status === 0) version = (r.stdout ?? r.stderr ?? "").trim().split(/\r?\n/)[0];
  }
  return {
    installed: Boolean(cmd),
    running,
    port,
    healthUrl: `http://127.0.0.1:${port}/healthz`,
    version,
    error: !cmd ? "未找到 ocx，请先安装 @bitkyc08/opencodex" : undefined,
  };
}

/**
 * 直接复用 opencodex 的进程内 server，而不是 `ocx start`。
 * `ocx start` 会把默认 ~/.codex/config.toml 改成指向代理（注入 openai_base_url），
 * 这里只启动代理本身，完全不碰默认 Codex 配置。
 */
async function loadOpencodexApi() {
  const pkg: any = await import("@bitkyc08/opencodex");
  if (typeof pkg.loadBunApi === "function") return pkg.loadBunApi();
  return pkg;
}

export async function startOpencodex(port = DEFAULT_PORT, _apiKey?: string): Promise<OpenCodexStatus> {
  const before = await opencodexStatus(port);
  if (!before.installed) return before;
  if (before.running) return before;
  try {
    installEmbeddedCrashGuard();
    const { startServer } = await loadOpencodexApi();
    const server = startServer(port) as { stop: (force?: boolean) => void; port?: number };
    activeOpenCodexServer = server;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const current = await opencodexStatus(port);
      if (current.running) return current;
    }
    return { ...before, error: `OpenCodex 未在 ${port} 端口就绪` };
  } catch (e: any) {
    return { ...before, error: e?.message ?? "OpenCodex 启动失败" };
  }
}

/**
 * 通过 opencodex 的本地管理 API 写入 provider（POST /api/providers 会同时持久化并热更新），
 * 不再走 `ocx provider add` + `ocx restart`（restart 会再次注入默认 Codex 配置）。
 */
export async function configureOpenCodexProvider(
  input: OpenCodexProviderInput,
): Promise<{ ok: boolean; error?: string }> {
  const status = await opencodexStatus();
  if (!status.installed) return { ok: false, error: "未找到项目内 OpenCodex 依赖" };
  if (!status.running) {
    return { ok: false, error: `OpenCodex 未运行（端口 ${status.port}），无法写入 provider` };
  }
  const token = adminToken();
  if (!token) {
    return {
      ok: false,
      error: "缺少 opencodex admin token（~/.opencodex/admin-api-token 或 OPENCODEX_ADMIN_AUTH_TOKEN）",
    };
  }
  try {
    const r = await fetch(`http://127.0.0.1:${status.port}/api/providers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: input.id,
        setDefault: true,
        provider: {
          adapter: "openai-chat",
          baseUrl: input.baseUrl,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.error ?? `OpenCodex provider 配置失败 (HTTP ${r.status})` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "OpenCodex provider 配置失败" };
  }
}

export const opencodexPort = DEFAULT_PORT;
