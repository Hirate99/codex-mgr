import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Registry } from "../src/registry";

describe("Registry", () => {
  test("CRUD 与运行状态（内存态不落盘）", () => {
    const dir = mkdtempSync(join(tmpdir(), "cxm-reg-"));
    const r = new Registry(dir);

    r.upsert({
      id: "deepseek",
      label: "d",
      home: join(dir, "deepseek"),
      model: "deepseek-v4-pro",
      surfaces: ["desktop"],
      createdAt: new Date().toISOString(),
    });
    expect(r.list()).toHaveLength(1);
    expect(r.get("deepseek")?.model).toBe("deepseek-v4-pro");

    r.setProc({
      instanceId: "deepseek",
      surface: "desktop",
      pid: 99999,
      startedAt: new Date().toISOString(),
    });
    expect(r.getProc("deepseek", "desktop")?.pid).toBe(99999);

    const saved = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8"));
    expect(saved.instances).toHaveLength(1);

    expect(r.remove("deepseek")).toBe(true);
    expect(r.list()).toHaveLength(0);
    expect(r.getProc("deepseek", "desktop")).toBeUndefined();
  });
});
