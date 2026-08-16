import { describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderInstanceConfig, createInstance, switchInstanceModel } from "../src/clone";

describe("renderInstanceConfig", () => {
  test("基于基础配置生成 DeepSeek 配置：保留其余内容、移除冲突键、重写 provider", () => {
    const base = mkdtempSync(join(tmpdir(), "cxm-cfg-"));
    const baseToml = join(base, "base.toml");
    writeFileSync(
      baseToml,
      [
        `model = "gpt-5.6-sol"`,
        `service_tier = "default"`,
        `profile = "something"`,
        `personality = "pragmatic"`,
        ``,
        `[projects.'C:\\Users\\test\\proj']`,
        `trust_level = "trusted"`,
        ``,
        `[mcp_servers.robinhood]`,
        `url = "https://agent.robinhood.com/mcp/trading"`,
        ``,
        `[model_providers.deepseek]`,
        `base_url = "https://old.example.com/"`,
        `wire_api = "chat"`,
        `experimental_bearer_token = "old-key"`,
        ``,
      ].join("\n"),
      "utf8",
    );

    const home = "C:\\Users\\test\\.codex-instances\\deepseek";
    const r = renderInstanceConfig({
      model: "deepseek-v4-flash",
      provider: {
        id: "deepseek",
        name: "deepseek",
        baseUrl: "https://api.deepseek.com/",
        wireApi: "responses",
        envKey: "DEEPSEEK_API_KEY",
      },
      modelCatalog: join(home, "models.json"),
      reasoningEffort: "high",
      baseConfigPath: baseToml,
    });

    const parsed = Bun.TOML.parse(r.toml) as any;
    expect(parsed.model).toBe("deepseek-v4-flash");
    expect(parsed.model_provider).toBe("deepseek");
    expect(parsed.preferred_auth_method).toBe("apikey");
    expect(parsed.forced_login_method).toBe("api");
    expect(parsed.model_reasoning_effort).toBe("high");
    expect(parsed.model_catalog_json).toBe(home + "\\models.json");
    expect(parsed.personality).toBe("pragmatic");
    expect(parsed.projects["C:\\Users\\test\\proj"].trust_level).toBe("trusted");
    expect(parsed.mcp_servers.robinhood.url).toBe(
      "https://agent.robinhood.com/mcp/trading",
    );
    expect(parsed.service_tier).toBeUndefined();
    expect(parsed.profile).toBeUndefined();
    expect(parsed.model_providers.deepseek.base_url).toBe("https://api.deepseek.com/");
    expect(parsed.model_providers.deepseek.wire_api).toBe("responses");
    expect(parsed.model_providers.deepseek.env_key).toBe("DEEPSEEK_API_KEY");
    expect(parsed.model_providers.deepseek.experimental_bearer_token).toBeUndefined();
    expect(r.changes.length).toBeGreaterThan(0);
  });

  test("官方配置（无 provider）不写入 apikey 字段", () => {
    const r = renderInstanceConfig({ model: "gpt-5.6-sol" });
    const parsed = Bun.TOML.parse(r.toml) as any;
    expect(parsed.model).toBe("gpt-5.6-sol");
    expect(parsed.model_provider).toBeUndefined();
    expect(parsed.model_providers).toBeUndefined();
  });

  test("第三方实例不继承 elevated 沙箱（避免 UAC 弹窗）", () => {
    const base = mkdtempSync(join(tmpdir(), "cxm-sandbox-"));
    const baseToml = join(base, "base.toml");
    writeFileSync(
      baseToml,
      [
        `model = "gpt-5.6-sol"`,
        ``,
        `[windows]`,
        `sandbox = "elevated"`,
      ].join("\n"),
      "utf8",
    );

    const r = renderInstanceConfig({
      model: "kimi-k2.7-code",
      provider: {
        id: "opencode-go",
        name: "opencode-go",
        baseUrl: "http://127.0.0.1:10100/v1",
        wireApi: "responses",
        envKey: "OPENCODE_GO_API_KEY",
      },
      baseConfigPath: baseToml,
    });

    const parsed = Bun.TOML.parse(r.toml) as any;
    expect(parsed.windows.sandbox).toBe("unelevated");
    expect(r.changes.some((c) => c.includes("sandbox"))).toBe(true);
  });
});

describe("createInstance", () => {
  test("DeepSeek 预设：写入 config.toml + models.json，不复制 auth.json，备份目录存在", () => {
    const base = mkdtempSync(join(tmpdir(), "cxm-clone-"));
    const home = join(base, "deepseek");
    const out = createInstance(
      {
        id: "deepseek",
        label: "DeepSeek",
        model: "deepseek-v4-flash",
        providerPreset: "deepseek",
        surfaces: ["desktop"],
      },
      home,
    );

    expect(out.instance.profile).toBe(join(home, ".desktop-profile"));
    expect(existsSync(join(home, "config.toml"))).toBe(true);
    expect(existsSync(join(home, "models.json"))).toBe(true);
    expect(existsSync(join(home, "auth.json"))).toBe(false);
    expect(existsSync(join(home, "backup-codex-mgr"))).toBe(true);

    const parsed = Bun.TOML.parse(
      readFileSync(join(home, "config.toml"), "utf8"),
    ) as any;
    expect(parsed.model).toBe("deepseek-v4-flash");
    expect(parsed.model_providers.deepseek.env_key).toBe("DEEPSEEK_API_KEY");

    const catalog = JSON.parse(readFileSync(join(home, "models.json"), "utf8"));
    const slugs = (catalog.models as { slug: string }[]).map((m) => m.slug);
    expect(slugs).toContain("deepseek-v4-pro");
    expect(slugs).toContain("deepseek-v4-flash");
  });

  test("模型切换只改 model 并保留其它配置", () => {
    const base = mkdtempSync(join(tmpdir(), "cxm-switch-"));
    const home = join(base, "deepseek");
    createInstance(
      {
        id: "deepseek",
        label: "DeepSeek",
        model: "deepseek-v4-flash",
        providerPreset: "deepseek",
        surfaces: ["desktop"],
      },
      home,
    );
    const instance = {
      id: "deepseek",
      label: "DeepSeek",
      home,
      provider: { id: "deepseek", envKey: "DEEPSEEK_API_KEY" },
      model: "deepseek-v4-flash",
      modelCatalog: join(home, "models.json"),
      reasoningEffort: "high",
      surfaces: ["desktop"] as string[],
      createdAt: "x",
    } as any;

    switchInstanceModel(instance, "deepseek-v4-pro");
    const parsed = Bun.TOML.parse(
      readFileSync(join(home, "config.toml"), "utf8"),
    ) as any;
    expect(parsed.model).toBe("deepseek-v4-pro");
    expect(parsed.model_provider).toBe("deepseek");
    expect(parsed.model_providers.deepseek.env_key).toBe("DEEPSEEK_API_KEY");
  });
});
