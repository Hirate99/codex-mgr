import { copyFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Instance, RunningProc, Surface } from "./types";
import { mgrRoot } from "./paths";
import { platform } from "./paths";
import { ensureModelCatalogCompatibility } from "./clone";
import { spawn, spawnSync } from "./proc";

export interface LaunchTarget {
  desktopAppPath?: string;
  codexCliPath?: string;
  opencodeCliPath?: string;
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export function buildLaunchEnv(
  instance: Instance,
  secrets: Record<string, string>,
): Record<string, string> {
  const env = cleanEnv();
  env.CODEX_HOME = instance.home;
  const key = instance.provider?.envKey;
  if (key && secrets[key]) env[key] = secrets[key];
  return env;
}

function logPath(instanceId: string, surface: Surface): string {
  const dir = join(mgrRoot(), "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${instanceId}-${surface}.log`);
}

function tryTerminal(cmdStr: string, env: Record<string, string>): boolean {
  if (platform.isWin) {
    const where = spawnSync("cmd", ["/c", "where", "wt.exe"], { encoding: "utf8" });
    if (where.status === 0 && (where.stdout ?? "").trim().length > 0) {
      const child = spawn(
        "wt.exe",
        ["new-tab", "--", "cmd", "/k", cmdStr],
        { env, detached: true, stdio: "ignore", windowsHide: false },
      );
      child.unref();
      return true;
    }
    return false;
  }
  if (platform.isMac) {
    const escaped = cmdStr.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const child = spawn(
      "osascript",
      ["-e", `tell application "Terminal" to do script "${escaped}"`],
      { env, detached: true, stdio: "ignore" },
    );
    child.unref();
    return true;
  }
  return false;
}

function cliArg(value: string): string {
  return JSON.stringify(value);
}

export function launchDesktop(
  instance: Instance,
  target: LaunchTarget,
  secrets: Record<string, string>,
): RunningProc {
  const app = target.desktopAppPath;
  if (!app) throw new Error("ChatGPT/Codex desktop app not found");

  const args: string[] = [];
  if (instance.profile) {
    args.push(`--user-data-dir=${instance.profile}`);
    mkdirSync(instance.profile, { recursive: true });
  }

  const env = buildLaunchEnv(instance, secrets);
  const child = spawn(app, args, {
    env,
    stdio: "ignore",
    detached: true,
    windowsHide: false,
  });
  child.unref();

  return {
    instanceId: instance.id,
    surface: "desktop",
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    fingerprint: `desktop:${instance.profile ?? "default"}`,
  };
}

export function launchCli(
  instance: Instance,
  target: LaunchTarget,
  secrets: Record<string, string>,
): RunningProc {
  const codex = target.codexCliPath;
  if (!codex) throw new Error("codex CLI not found");

  const env = buildLaunchEnv(instance, secrets);
  const log = logPath(instance.id, "cli");
  const profileName = "instance";
  const profilePath = join(instance.home, `${profileName}.config.toml`);
  const configPath = join(instance.home, "config.toml");
  if (instance.modelCatalog) ensureModelCatalogCompatibility(instance.modelCatalog);
  if (!existsSync(profilePath) && existsSync(configPath)) copyFileSync(configPath, profilePath);

  const cliArgs = ["--profile", profileName, "-C", instance.home];
  const cmdStr = `${cliArg(codex)} ${cliArgs.map(cliArg).join(" ")}`;
  if (tryTerminal(cmdStr, env)) {
    return {
      instanceId: instance.id,
      surface: "cli",
      pid: 0,
      startedAt: new Date().toISOString(),
      fingerprint: `cli-term:${instance.id}`,
    };
  }

  const logFd = openSync(log, "a");
  let cmd: string[];
  if (platform.isWin && !codex.includes("/") && !codex.includes("\\")) {
    cmd = ["cmd", "/c", codex, ...cliArgs];
  } else {
    cmd = [codex, ...cliArgs];
  }
  const child = spawn(cmd[0], cmd.slice(1), {
    env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    windowsHide: true,
    cwd: process.env.USERPROFILE ?? ".",
  });
  child.unref();

  return {
    instanceId: instance.id,
    surface: "cli",
    pid: child.pid ?? 0,
    startedAt: new Date().toISOString(),
    fingerprint: `cli:${log}`,
  };
}

export function launch(
  instance: Instance,
  surface: Surface,
  target: LaunchTarget,
  secrets: Record<string, string>,
): RunningProc {
  return surface === "desktop"
    ? launchDesktop(instance, target, secrets)
    : launchCli(instance, target, secrets);
}
