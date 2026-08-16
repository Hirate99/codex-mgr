import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  codexCliCandidates,
  defaultCodexHome,
  defaultDesktopProfile,
  desktopAppCandidates,
  opencodeCliCandidates,
  platform,
} from "./paths";

export interface ProbeResult {
  platform: string;
  codexCli?: { path: string; version?: string };
  opencodeCli?: { path: string; version?: string };
  desktopApp?: { path: string; defaultProfile: string };
  codexHome: string;
  codexHomeExists: boolean;
}

function tryRun(bin: string, args: string[]): { code: number; out: string } {
  if (bin.includes("/") || bin.includes("\\")) {
    const r = spawnSync(bin, args, { encoding: "utf8" });
    return { code: r.status ?? 1, out: r.stdout ?? "" };
  }
  let r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0 && platform.isWin) {
    r = spawnSync("cmd", ["/c", bin, ...args], { encoding: "utf8" });
  }
  return { code: r.status ?? 1, out: r.stdout ?? "" };
}

function resolveCli(candidates: string[]): { path: string; version?: string } | undefined {
  for (const c of candidates) {
    const r = tryRun(c, ["--version"]);
    if (r.code === 0) {
      return { path: c, version: r.out.trim().split("\n")[0]?.slice(0, 80) };
    }
  }
  return undefined;
}

export function probe(): ProbeResult {
  const out: ProbeResult = {
    platform: process.platform,
    codexHome: defaultCodexHome(),
    codexHomeExists: existsSync(defaultCodexHome()),
  };

  out.codexCli = resolveCli(codexCliCandidates());
  out.opencodeCli = resolveCli(opencodeCliCandidates());

  const app = desktopAppCandidates().find(
    (p) => p.includes("WindowsApps") || existsSync(p),
  );
  if (app) out.desktopApp = { path: app, defaultProfile: defaultDesktopProfile() };
  return out;
}

/** 列出当前运行的桌面客户端主进程（不含 --type 子进程） */
export function runningDesktopProcesses(): {
  pid: number;
  cmd: string;
  userDataDir?: string;
}[] {
  if (platform.isWin) {
    try {
      const r = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' or Name='Codex.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
        ],
        { encoding: "utf8" },
      );
      if (r.status !== 0) return [];
      const parsed = JSON.parse(r.stdout || "[]");
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((p) => p?.ProcessId)
        .map((p) => {
          const cmd: string = String(p.CommandLine ?? "");
          const m = cmd.match(/--user-data-dir="?([^"\s]+)"?/);
          return { pid: Number(p.ProcessId), cmd, userDataDir: m?.[1] };
        });
    } catch {
      return [];
    }
  }
  if (platform.isMac) {
    try {
      const r = spawnSync(
        "bash",
        ["-c", `ps -axo pid=,command= | grep -E 'ChatGPT|Codex' | grep -v grep`],
        { encoding: "utf8" },
      );
      const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
      return lines.map((l) => {
        const m = l.match(/^\s*(\d+)\s+(.*)$/);
        const cmd = m?.[2] ?? "";
        const ud = cmd.match(/--user-data-dir="?([^"\s]+)"?/);
        return { pid: Number(m?.[1]), cmd, userDataDir: ud?.[1] };
      });
    } catch {
      return [];
    }
  }
  return [];
}

export function isPidAlive(pid: number): boolean {
  try {
    if (platform.isWin) {
      const r = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -First 1 Id | ConvertTo-Json -Compress`,
        ],
        { encoding: "utf8" },
      );
      return (r.stdout ?? "").trim().length > 0;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessTree(pid: number): boolean {
  if (platform.isWin) {
    const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
    });
    return r.status === 0;
  }
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
