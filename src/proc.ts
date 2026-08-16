import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithBufferEncoding,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";

const isWin = process.platform === "win32";

/**
 * On Windows, inject windowsHide: true for child processes that do not explicitly set it.
 * The panel runs as a detached background process (no console); without hiding, every probe
 * (powershell/cmd/bun) would open a visible console window, causing persistent pop-ups.
 */
function withHiddenWindow<O extends { windowsHide?: boolean }>(options: O): O {
  if (!isWin || options.windowsHide !== undefined) return options;
  return { ...options, windowsHide: true };
}

/** Typed spawnSync overloads mirroring node:child_process's 3-argument forms. */
export function spawnSync(
  command: string,
  args: readonly string[] | undefined,
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
export function spawnSync(
  command: string,
  args: readonly string[] | undefined,
  options: SpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer>;
export function spawnSync(
  command: string,
  args: readonly string[] | undefined,
  options?: SpawnSyncOptions,
): SpawnSyncReturns<Buffer> | SpawnSyncReturns<string> {
  return nodeSpawnSync(
    command,
    args,
    withHiddenWindow(options ?? {}),
  ) as SpawnSyncReturns<Buffer> | SpawnSyncReturns<string>;
}

/** Asynchronous wrapper around node:child_process with windowsHide: true injected on Windows. */
export function spawn(
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  // Resolve the general overload explicitly so SpawnOptions' stdio union does not
  // collapse the return type into a `never` intersection.
  const internalSpawn = nodeSpawn as (
    command: string,
    args: readonly string[] | undefined,
    options: SpawnOptions,
  ) => ChildProcess;
  return internalSpawn(command, args, withHiddenWindow(options ?? {}));
}
