import { describe, expect, test } from "bun:test";
import { buildProviderCatalog } from "../src/models";

describe("DeepSeek model catalog", () => {
  test("保留已知模型元数据，并为接口新增模型生成 Codex 目录项", () => {
    const catalog = buildProviderCatalog("deepseek", [
      { slug: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      { slug: "deepseek-next", displayName: "DeepSeek Next" },
    ]);

    expect(catalog.models).toHaveLength(2);
    expect(catalog.models[0].context_window).toBe(1048576);
    expect(catalog.models[1].slug).toBe("deepseek-next");
    expect(catalog.models[1].supported_in_api).toBe(true);
    expect(catalog.models[1].input_modalities).toEqual(["text"]);
  });
});
