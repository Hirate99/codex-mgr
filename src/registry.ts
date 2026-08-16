import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Instance, RegistryFile, RunningProc } from "./types";
import { mgrRoot } from "./paths";

export class Registry {
  private file: RegistryFile;
  private ignored = new Set<string>();
  private procs = new Map<string, RunningProc>();
  private dir: string;
  private path: string;

  constructor(dir?: string) {
    this.dir = dir ?? mgrRoot();
    this.path = `${this.dir}/registry.json`;
    mkdirSync(this.dir, { recursive: true });
    this.file = this.load();
  }

  private load(): RegistryFile {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as RegistryFile;
      if (parsed?.version === 1 && Array.isArray(parsed.instances)) {
        this.ignored = new Set(parsed.ignoredInstanceIds ?? []);
        return parsed;
      }
    } catch {
      // 首次运行或文件损坏，重建
    }
    this.ignored = new Set();
    return { version: 1, instances: [] };
  }

  save(): void {
    this.file.ignoredInstanceIds = [...this.ignored];
    writeFileSync(this.path, JSON.stringify(this.file, null, 2), "utf8");
  }

  list(): Instance[] {
    return this.file.instances;
  }

  get(id: string): Instance | undefined {
    return this.file.instances.find((i) => i.id === id);
  }

  upsert(instance: Instance): void {
    this.ignored.delete(instance.id);
    const idx = this.file.instances.findIndex((i) => i.id === instance.id);
    if (idx >= 0) this.file.instances[idx] = instance;
    else this.file.instances.push(instance);
    this.save();
  }

  remove(id: string): boolean {
    const idx = this.file.instances.findIndex((i) => i.id === id);
    if (idx < 0) return false;
    this.file.instances.splice(idx, 1);
    this.ignored.add(id);
    this.save();
    for (const [key, proc] of this.procs) {
      if (proc.instanceId === id) this.procs.delete(key);
    }
    return true;
  }

  isIgnored(id: string): boolean {
    return this.ignored.has(id);
  }

  // ---- 运行时状态（仅内存，不落盘，避免 PID 复用误判） ----

  setProc(proc: RunningProc): void {
    this.procs.set(`${proc.instanceId}:${proc.surface}`, proc);
  }

  getProc(instanceId: string, surface: string): RunningProc | undefined {
    return this.procs.get(`${instanceId}:${surface}`);
  }

  deleteProc(instanceId: string, surface: string): boolean {
    return this.procs.delete(`${instanceId}:${surface}`);
  }

  listProcs(): RunningProc[] {
    return [...this.procs.values()];
  }
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
