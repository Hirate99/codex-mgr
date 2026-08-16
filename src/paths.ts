import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "./proc";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

export const platform = { isWin, isMac };

export function homeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? ".";
}

/** The current user's official Codex home (usually signed in) */
export function defaultCodexHome(): string {
  return join(homeDir(), ".codex");
}

/** codex-mgr's own state directory */
export function mgrRoot(): string {
  return join(homeDir(), ".codex-mgr");
}

export function registryPath(): string {
  return join(mgrRoot(), "registry.json");
}

export function envFilePath(): string {
  return join(mgrRoot(), ".env");
}

/** Panel background state file */
export function panelStatePath(): string {
  return join(mgrRoot(), "panel-state.json");
}

/** Panel background log */
export function panelLogPath(): string {
  return join(mgrRoot(), "panel.log");
}

/** Instances root: one dedicated CODEX_HOME per third-party instance */
export function instancesRoot(): string {
  return join(homeDir(), ".codex-instances");
}

export function instanceHome(id: string): string {
  return join(instancesRoot(), id);
}

export function instanceProfileDir(id: string): string {
  return join(instancesRoot(), id, ".desktop-profile");
}

/** Default Electron profile (official signed-in instance) */
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

/** Desktop app candidate paths (probed in priority order) */
export function desktopAppCandidates(): string[] {
  if (isWin) {
    return [
      // ChatGPT.exe inside the MSIX package; prefer the newest version
      ...findWindowsAppsCodex(),
      // Standalone Codex desktop install
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
