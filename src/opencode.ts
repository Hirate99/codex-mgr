import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function authPathCandidates(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
  if (process.platform === "win32") {
    return [join(home, ".local", "share", "opencode", "auth.json")];
  }
  return [
    join(home, "Library", "Application Support", "opencode", "auth.json"),
    join(home, ".local", "share", "opencode", "auth.json"),
  ];
}

function parseAuthFile(): { path: string; data: Record<string, any> } | undefined {
  for (const p of authPathCandidates()) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      return { path: p, data: parsed };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface OpencodeAuthEntry {
  provider: string;
  type?: string;
  hasKey: boolean;
}

export interface OpencodeAuthSummary {
  path?: string;
  entries: OpencodeAuthEntry[];
}

export function importOpencodeAuth(): OpencodeAuthSummary {
  const found = parseAuthFile();
  if (!found) return { entries: [] };
  const entries = Object.entries(found.data)
    .filter(([, v]) => v && typeof v === "object")
    .map(([provider, v]) => ({
      provider,
      type: typeof v.type === "string" ? v.type : undefined,
      hasKey: typeof v.key === "string" && v.key.length > 0,
    }));
  return { path: found.path, entries };
}

export function opencodeKeyFor(provider: string): string | undefined {
  const found = parseAuthFile();
  if (!found) return undefined;
  const entry = found.data[provider];
  if (!entry || typeof entry !== "object") return undefined;
  if (typeof entry.key !== "string" || entry.key.length === 0) return undefined;
  return entry.key;
}

function configPathCandidates(): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
  const base = join(home, ".config", "opencode");
  return [join(base, "opencode.jsonc"), join(base, "opencode.json")];
}

export function opencodeConfigDir(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ".";
  return join(home, ".config", "opencode");
}

function parseJsonc(text: string): Record<string, any> {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return JSON.parse(stripped);
}

export interface OpencodeProviderInfo {
  id: string;
  baseURL?: string;
  models?: string[];
}

export function importOpencodeProviders(): OpencodeProviderInfo[] {
  for (const p of configPathCandidates()) {
    if (!existsSync(p)) continue;
    try {
      const parsed = parseJsonc(readFileSync(p, "utf8"));
      const providers = parsed.provider;
      if (!providers || typeof providers !== "object") return [];
      return Object.entries(providers as Record<string, any>).map(([id, def]) => ({
        id,
        baseURL: typeof def?.baseURL === "string" ? def.baseURL : undefined,
        models:
          def?.models && typeof def.models === "object"
            ? Object.keys(def.models)
            : undefined,
      }));
    } catch {
      continue;
    }
  }
  return [];
}
