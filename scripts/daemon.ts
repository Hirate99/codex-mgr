import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, openSync, rmSync } from "node:fs";
import { mgrRoot, panelLogPath, panelStatePath } from "../src/paths";

interface PanelState {
  version: 1;
  pid: number;
  port: number;
  startedAt: string;
  log: string;
}

const command = process.argv[2] ?? "start";

function readState(): PanelState | undefined {
  try {
    const raw = readFileSync(panelStatePath(), "utf8").trim();
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PanelState;
    if (parsed?.version !== 1 || !parsed.pid || !parsed.port) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      return spawnSync("powershell", ["-NoProfile", "-Command", `Get-Process -Id ${pid}`], { encoding: "utf8" }).status === 0;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function state(): void {
  const current = readState();
  if (current && alive(current.pid)) {
    console.log(`running pid=${current.pid} url=http://127.0.0.1:${current.port}`);
    console.log(`log=${current.log}`);
    return;
  }
  console.log("stopped");
}

function stopPanel(): void {
  const current = readState();
  if (!current || !alive(current.pid)) {
    rmSync(panelStatePath(), { force: true });
    console.log("panel is not running");
    return;
  }
  const ok = process.platform === "win32"
    ? spawnSync("taskkill", ["/PID", String(current.pid), "/T", "/F"], { encoding: "utf8" }).status === 0
    : (() => { try { process.kill(current.pid, "SIGTERM"); return true; } catch { return false; } })();
  rmSync(panelStatePath(), { force: true });
  console.log(ok ? `panel stopped (pid ${current.pid})` : `failed to stop panel pid ${current.pid}`);
  process.exit(ok ? 0 : 1);
}

function startPanel(): void {
  const current = readState();
  if (current && alive(current.pid)) {
    console.log(`already running pid=${current.pid} url=http://127.0.0.1:${current.port}`);
    return;
  }
  mkdirSync(mgrRoot(), { recursive: true });
  rmSync(panelStatePath(), { force: true });
  const entry = join(process.cwd(), "scripts", "start.ts");
  const logFd = openSync(panelLogPath(), "a");
  const child = spawn(process.execPath, ["run", entry], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: { ...process.env, CODEX_MGR_DAEMON: "1" },
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    const next = readState();
    if (next && alive(next.pid)) {
      console.log(`panel started pid=${next.pid} url=http://127.0.0.1:${next.port}`);
      console.log(`log=${panelLogPath()}`);
      return;
    }
  }
  console.error(`panel failed to start; see ${panelLogPath()}`);
  process.exit(1);
}

if (command === "start") startPanel();
else if (command === "stop") stopPanel();
else if (command === "status" || command === "state") state();
else {
  console.error("Usage: bun run daemon.ts <start|stop|status>");
  process.exit(2);
}
