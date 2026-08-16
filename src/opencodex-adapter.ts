import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_PORT = 10100;

export interface OpenCodexStatus {
  installed: boolean;
  running: boolean;
  port: number;
  healthUrl: string;
  version?: string;
  pid?: number;
  external?: boolean;
  error?: string;
}

export interface OpenCodexProviderInput {
  id: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
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

interface HealthIdentity {
  status?: string;
  service?: string;
  version?: string;
  uptime?: number;
  pid?: number;
  port?: number;
}

async function health(port: number): Promise<HealthIdentity | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!r.ok) return undefined;
    const body = (await r.json().catch(() => undefined)) as HealthIdentity | undefined;
    if (!body || body.status !== "ok" || body.service !== "opencodex") return undefined;
    return body;
  } catch {
    return undefined;
  }
}

export async function opencodexStatus(port = DEFAULT_PORT): Promise<OpenCodexStatus> {
  const cmd = command();
  const identity = await health(port);
  let version: string | undefined;
  if (cmd) {
    const r = spawnSync(cmd[0], [cmd[1], "--version"], { encoding: "utf8" });
    if (r.status === 0) version = (r.stdout ?? r.stderr ?? "").trim().split(/\r?\n/)[0];
  }
  return {
    installed: Boolean(cmd),
    running: Boolean(identity),
    port,
    pid: identity?.pid,
    external: Boolean(identity),
    healthUrl: `http://127.0.0.1:${port}/healthz`,
    version: identity?.version ?? version,
    error: !cmd ? "未找到 ocx，请先安装 @bitkyc08/opencodex" : undefined,
  };
}

export async function startOpencodex(port = DEFAULT_PORT, _apiKey?: string): Promise<OpenCodexStatus> {
  const before = await opencodexStatus(port);
  if (!before.installed) return before;
  if (before.running) return before;
  try {
    // OpenCodex is deliberately detached: it is a runtime dependency for provider-backed
    // instances, not a child owned by this panel process. Starting it through Bun keeps
    // dev (Vite/Node) and production behavior identical.
    const child = spawn(
      process.execPath,
      [
        "run",
        join(process.cwd(), "node_modules", "@bitkyc08", "opencodex", "src", "cli", "index.ts"),
        "start",
        "--port",
        String(port),
      ],
      { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
    for (let i = 0; i < 80; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const current = await opencodexStatus(port);
      if (current.running) return current;
    }
    if (child.pid) {
      try { process.kill(child.pid, 0); child.kill(); } catch { /* already exited */ }
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
