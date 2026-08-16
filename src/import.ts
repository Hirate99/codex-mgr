import { readFileSync, existsSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import type { McpServerDef } from "./types";
import { defaultCodexHome } from "./paths";

export interface ImportedConfig {
  path: string;
  model?: string;
  modelProvider?: string;
  modelCatalog?: string;
  reasoningEffort?: string;
  personality?: string;
  providers: string[];
  trustProjects: string[];
  mcpServers: McpServerDef[];
}

const SYSTEM_MCP = new Set(["node_repl"]);

export function importCodexConfig(home: string = defaultCodexHome()): ImportedConfig {
  const path = `${home}/config.toml`;
  const out: ImportedConfig = {
    path,
    providers: [],
    trustProjects: [],
    mcpServers: [],
  };
  if (!existsSync(path)) return out;

  const parsed = parseToml(readFileSync(path, "utf8")) as Record<string, any>;

  out.model = typeof parsed.model === "string" ? parsed.model : undefined;
  out.modelProvider =
    typeof parsed.model_provider === "string" ? parsed.model_provider : undefined;
  out.modelCatalog =
    typeof parsed.model_catalog_json === "string" ? parsed.model_catalog_json : undefined;
  out.reasoningEffort =
    typeof parsed.model_reasoning_effort === "string"
      ? parsed.model_reasoning_effort
      : undefined;
  out.personality = typeof parsed.personality === "string" ? parsed.personality : undefined;

  const providers = parsed.model_providers;
  if (providers && typeof providers === "object") {
    out.providers = Object.keys(providers);
  }

  const projects = parsed.projects;
  if (projects && typeof projects === "object") {
    for (const [p, v] of Object.entries(projects as Record<string, any>)) {
      if (v && typeof v === "object" && (v as any).trust_level) {
        out.trustProjects.push(p);
      }
    }
  }

  const mcp = parsed.mcp_servers;
  if (mcp && typeof mcp === "object") {
    for (const [name, def] of Object.entries(mcp as Record<string, any>)) {
      if (SYSTEM_MCP.has(name)) continue;
      const d = def as any;
      if (!d) continue;
      out.mcpServers.push({
        name,
        command: typeof d.command === "string" ? d.command : undefined,
        url: typeof d.url === "string" ? d.url : undefined,
        args: Array.isArray(d.args) ? d.args : undefined,
        env: d.env && typeof d.env === "object" ? d.env : undefined,
      });
    }
  }

  return out;
}
