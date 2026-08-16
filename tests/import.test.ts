import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importCodexConfig } from "../src/import";

describe("importCodexConfig", () => {
  test("解析 model/provider/信任项目/MCP，跳过系统 node_repl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cxm-import-"));
    writeFileSync(
      join(dir, "config.toml"),
      [
        `model = "gpt-5.6-sol"`,
        `model_provider = "openai"`,
        `model_reasoning_effort = "high"`,
        ``,
        `[projects.'C:\\Users\\test\\proj']`,
        `trust_level = "trusted"`,
        ``,
        `[mcp_servers.node_repl]`,
        `command = 'C:\\node_repl.exe'`,
        ``,
        `[mcp_servers.robinhood]`,
        `url = "https://agent.robinhood.com/mcp/trading"`,
        ``,
        `[model_providers.deepseek]`,
        `base_url = "https://api.deepseek.com/"`,
        ``,
      ].join("\n"),
      "utf8",
    );

    const out = importCodexConfig(dir);
    expect(out.model).toBe("gpt-5.6-sol");
    expect(out.modelProvider).toBe("openai");
    expect(out.reasoningEffort).toBe("high");
    expect(out.trustProjects).toEqual(["C:\\Users\\test\\proj"]);
    expect(out.mcpServers.map((m) => m.name)).toEqual(["robinhood"]);
    expect(out.providers).toContain("deepseek");
  });

  test("缺失配置文件时返回空结构", () => {
    const dir = mkdtempSync(join(tmpdir(), "cxm-import-empty-"));
    const out = importCodexConfig(dir);
    expect(out.model).toBeUndefined();
    expect(out.trustProjects).toEqual([]);
  });
});
