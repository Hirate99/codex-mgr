import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { envFilePath, mgrRoot } from "./paths";
import { mkdirSync } from "node:fs";

export function loadSecrets(): Record<string, string> {
  const p = envFilePath();
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

export function setSecret(key: string, value: string): void {
  mkdirSync(mgrRoot(), { recursive: true });
  const secrets = loadSecrets();
  secrets[key] = value;
  const body = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(envFilePath(), body + "\n", "utf8");
}

export function deleteSecret(key: string): void {
  const secrets = loadSecrets();
  if (!(key in secrets)) return;
  delete secrets[key];
  const body = Object.entries(secrets)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(envFilePath(), body + "\n", "utf8");
}
