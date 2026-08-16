import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

export const platform = { isWin, isMac };

export function homeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? ".";
}

/** 当前用户的官方 codex home（通常已登录） */
export function defaultCodexHome(): string {
  return join(homeDir(), ".codex");
}

/** codex-mgr 自身状态目录 */
export function mgrRoot(): string {
  return join(homeDir(), ".codex-mgr");
}

export function registryPath(): string {
  return join(mgrRoot(), "registry.json");
}

export function envFilePath(): string {
  return join(mgrRoot(), ".env");
}

/** 实例根目录：每个第三方实例一个独立 CODEX_HOME */
export function instancesRoot(): string {
  return join(homeDir(), ".codex-instances");
}

export function instanceHome(id: string): string {
  return join(instancesRoot(), id);
}

export function instanceProfileDir(id: string): string {
  return join(instancesRoot(), id, ".desktop-profile");
}

/** Electron 默认 profile（官方已登录实例） */
export function defaultDesktopProfile(): string {
  if (isWin) return join(process.env.APPDATA ?? "", "Codex", "web", "Codex");
  if (isMac)
    return join(
      homeDir(),
      "Library",
      "Application Support",
      "Codex",
      "web",
      "Codex",
    );
  return join(homeDir(), ".config", "Codex", "web", "Codex");
}

/** 桌面客户端候选路径（按优先级探测） */
export function desktopAppCandidates(): string[] {
  if (isWin) {
    return [
      // MSIX 包内 ChatGPT.exe，优先找最新版本
      ...findWindowsAppsCodex(),
      // 独立安装的 Codex 桌面版
      join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "Codex",
        "Codex.exe",
      ),
      join(
        process.env.LOCALAPPDATA ?? "",
        "Programs",
        "ChatGPT",
        "ChatGPT.exe",
      ),
    ];
  }
  if (isMac) {
    return [
      "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      "/Applications/Codex.app/Contents/MacOS/Codex",
      join(homeDir(), "Applications", "ChatGPT.app", "Contents", "MacOS", "ChatGPT"),
    ];
  }
  return [];
}

function findWindowsAppsCodex(): string[] {
  const base = "C:\\Program Files\\WindowsApps";
  try {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1 -ExpandProperty InstallLocation",
      ],
      { encoding: "utf8" },
    );
    if (r.status === 0) {
      const loc = (r.stdout ?? "").trim();
      if (loc) return [join(loc, "app", "ChatGPT.exe"), join(loc, "app", "Codex.exe")];
    }
  } catch {}
  try {
    const dirs = readdirSync(base).filter((d) => d.startsWith("OpenAI.Codex_"));
    const list: string[] = [];
    for (const d of dirs.sort().reverse()) {
      const p = join(base, d, "app", "ChatGPT.exe");
      if (existsSync(p)) list.push(p);
    }
    if (list.length > 0) return list;
  } catch {}
  return [];
}

export function codexCliCandidates(): string[] {
  const base: string[] = [];
  if (isWin) {
    try {
      const root = process.env.LOCALAPPDATA ?? "";
      const binDir = join(root, "OpenAI", "Codex", "bin");
      if (existsSync(binDir)) {
        const versions = readdirSync(binDir)
          .filter((d) => existsSync(join(binDir, d, "codex.exe")))
          .sort()
          .reverse();
        for (const v of versions) base.push(join(binDir, v, "codex.exe"));
      }
    } catch {}
    base.push("codex.cmd", "codex.exe", "codex");
  } else {
    base.push("/usr/local/bin/codex", "/opt/homebrew/bin/codex", "codex");
  }
  return base;
}

export function opencodeCliCandidates(): string[] {
  return isWin ? ["opencode.exe", "opencode.cmd", "opencode"] : ["opencode"];
}
