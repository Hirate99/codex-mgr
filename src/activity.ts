import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mgrRoot } from "./paths";

export interface ActivityEvent {
  at: string;
  type: "launch" | "stop" | "create" | "delete" | "switch-model" | "adapter" | "error";
  level: "info" | "warn" | "error";
  instanceId?: string;
  message: string;
  detail?: Record<string, unknown>;
}

const LIMIT = 100;
let cache: ActivityEvent[] | undefined;

function path(): string {
  return join(mgrRoot(), "activity.jsonl");
}

function ensureRoot(): void {
  mkdirSync(mgrRoot(), { recursive: true });
}

export function recordActivity(event: Omit<ActivityEvent, "at">): ActivityEvent {
  const entry = { ...event, at: new Date().toISOString() };
  ensureRoot();
  appendFileSync(path(), JSON.stringify(entry) + "\n", "utf8");
  cache = undefined;
  return entry;
}

export function listActivity(instanceId?: string): ActivityEvent[] {
  if (cache) {
    return instanceId ? cache.filter((event) => event.instanceId === instanceId) : cache;
  }
  const events: ActivityEvent[] = [];
  if (existsSync(path())) {
    for (const line of readFileSync(path(), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as ActivityEvent);
      } catch {
        // A partially written trailing line is not worth failing the API.
      }
    }
  }
  cache = events.slice(-LIMIT * 2);
  if (events.length > LIMIT * 4) {
    try {
      const kept = events.slice(-LIMIT).map((event) => JSON.stringify(event)).join("\n") + "\n";
      ensureRoot();
      truncateSync(path());
      writeFileSync(path(), kept, "utf8");
      cache = events.slice(-LIMIT);
    } catch {
      // Compaction is best effort.
    }
  }
  return instanceId ? cache.filter((event) => event.instanceId === instanceId) : cache.slice().reverse();
}
