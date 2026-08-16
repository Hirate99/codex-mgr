import { platform } from "./paths";
import { spawnSync } from "./proc";
import { isPidAlive, killProcessTree, runningDesktopProcesses } from "./probe";
import type { Instance, RunningProc, Surface } from "./types";

export interface RuntimeProcess {
  pid: number;
  surface: Surface;
  startedAt?: string;
  source: "registry" | "desktop-scan" | "tracked-fallback";
  managed: boolean;
  stale?: boolean;
}

export interface InstanceRuntime {
  processes: RuntimeProcess[];
  desktopPids: number[];
  cliPids: number[];
  profileInUse: boolean;
  untrackedDesktop: boolean;
}

function isDesktopOwner(instance: Instance, process: { userDataDir?: string }): boolean {
  if (instance.profile && process.userDataDir) {
    return resolveEqual(instance.profile, process.userDataDir);
  }
  return false;
}

function resolveEqual(left: string, right: string): boolean {
  if (platform.isWin) {
    return left.replace(/\//g, "\\").toLowerCase() === right.replace(/\//g, "\\").toLowerCase();
  }
  return left === right;
}

function processStartTime(pid: number): string | undefined {
  if (pid <= 0) return undefined;
  if (platform.isWin) {
    try {
      const result = spawnSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).StartTime.ToString('o')`],
        { encoding: "utf8", timeout: 1500 },
      );
      const value = (result.stdout ?? "").trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
    const value = (result.stdout ?? "").trim();
    return value ? new Date(value).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function trackedProcess(proc: RunningProc): RuntimeProcess {
  const alive = isPidAlive(proc.pid);
  return {
    pid: proc.pid,
    surface: proc.surface,
    startedAt: proc.startedAt,
    source: "registry",
    managed: true,
    stale: !alive && proc.pid > 0,
  };
}

export function resolveInstanceRuntime(instance: Instance): InstanceRuntime {
  const tracked = [registryProcess(instance, "desktop"), registryProcess(instance, "cli")]
    .filter((proc): proc is RunningProc => Boolean(proc));
  const processes = tracked.map(trackedProcess);
  const desktopOwners = runningDesktopProcesses().filter((process) =>
    isDesktopOwner(instance, process),
  );

  for (const process of desktopOwners) {
    if (!processes.some((candidate) => candidate.pid === process.pid)) {
      processes.push({
        pid: process.pid,
        surface: "desktop",
        startedAt: processStartTime(process.pid),
        source: "desktop-scan",
        managed: false,
      });
    }
  }

  const trackedDesktop = tracked.find((proc) => proc.surface === "desktop");
  if (
    trackedDesktop?.pid &&
    processes.some((proc) => proc.pid === trackedDesktop.pid && isPidAlive(trackedDesktop.pid)) &&
    desktopOwners.length === 0
  ) {
    processes.push({
      pid: trackedDesktop.pid,
      surface: "desktop",
      startedAt: trackedDesktop.startedAt,
          source: "tracked-fallback",
      managed: true,
    });
  }

  const desktopPids = processes.filter((p) => p.surface === "desktop" && p.pid > 0).map((p) => p.pid);
  const cliPids = processes.filter((p) => p.surface === "cli" && p.pid > 0).map((p) => p.pid);
  return {
    processes,
    desktopPids,
    cliPids,
    profileInUse: desktopOwners.length > 0,
    untrackedDesktop: desktopOwners.some((owner) => !tracked.some((p) => p.pid === owner.pid)),
  };
}

function registryProcess(instance: Instance, surface: Surface): RunningProc | undefined {
  const proc = runtimeRegistry?.getProc(instance.id, surface);
  return proc;
}

let runtimeRegistry:
  | { getProc(instanceId: string, surface: Surface): RunningProc | undefined }
  | undefined;

export function bindRuntimeRegistry(registry: {
  getProc(instanceId: string, surface: Surface): RunningProc | undefined;
}): void {
  runtimeRegistry = registry;
}

export function stopInstanceProcesses(
  instance: Instance,
  surface: Surface,
): { killed: number[]; failed: number[] } {
  const runtime = resolveInstanceRuntime(instance);
  const candidates = runtime.processes.filter(
    (process) =>
      process.surface === surface &&
      process.pid > 0 &&
      (process.managed || surface === "desktop"),
  );
  const killed: number[] = [];
  const failed: number[] = [];
  for (const process of candidates) {
    if (killProcessTree(process.pid)) killed.push(process.pid);
    else failed.push(process.pid);
  }
  return { killed, failed };
}
