"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Status {
  platform: string;
  codexCli?: { path: string; version?: string };
  opencodeCli?: { path: string; version?: string };
  desktopApp?: { path: string; defaultProfile: string };
  codexHome: string;
  codexHomeExists: boolean;
  runningDesktop: { pid: number; userDataDir?: string }[];
  procs: { instanceId: string; surface: string; pid: number; alive: boolean }[];
  opencodeAuth: { path?: string; entries: { provider: string; hasKey: boolean }[] };
}

interface InstanceView {
  id: string;
  label: string;
  home: string;
  profile?: string;
  provider?: { id: string; envKey?: string };
  model: string;
  models?: string[];
  preset?: string;
  modelCatalog?: string;
  official?: boolean;
  running: string[];
  runtime?: InstanceRuntimeView;
  apiKeyConfigured?: boolean;
  presetRequiresAdapter?: boolean;
}

interface RuntimeProcessView {
  pid: number;
  surface: "desktop" | "cli";
  startedAt?: string;
  source: "registry" | "desktop-scan" | "tracked-fallback";
  managed: boolean;
  stale?: boolean;
}

interface InstanceRuntimeView {
  processes: RuntimeProcessView[];
  profileInUse: boolean;
  untrackedDesktop: boolean;
}

interface ActivityEventView {
  at: string;
  type: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface ModelOption {
  slug: string;
  displayName: string;
  description?: string;
}

interface ModelList {
  source: string;
  models: ModelOption[];
  error?: string;
}

interface AllModels {
  official: ModelList;
  presets: Record<string, ModelList>;
  opencode: ModelList;
}

interface OpenCodexStatus {
  installed: boolean;
  running: boolean;
  port: number;
  healthUrl: string;
  version?: string;
  error?: string;
}

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const PlayIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.5v11l9-5.5-9-5.5z" /></svg>
);
const StopIcon = (
  <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
);
const MonitorIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2.5" width="12" height="8.5" rx="1.5" /><path d="M5.5 13.5h5M8 11v2.5" /></svg>
);
const TerminalIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M5 6.5l2.5 2-2.5 2M9 10.5h2.5" /></svg>
);
const TrashIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 4h11M6.5 2h3M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 7v4M9.5 7v4" /></svg>
);
const PlusIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3v10M3 8h10" /></svg>
);
const LayersIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m8 2 6 3-6 3-6-3 6-3Z" /><path d="m2 8 6 3 6-3M2 11l6 3 6-3" /></svg>
);
const ActivityIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 8h3l1.5-4 3 8L11 8h3" /></svg>
);
const ImportIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" /></svg>
);

function formatTime(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ModelPicker({
  models,
  selected,
  onToggle,
  onAll,
  onNone,
  error,
  source,
}: {
  models: ModelOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  onAll: () => void;
  onNone: () => void;
  error?: string;
  source?: string;
}) {
  return (
    <div>
      <div className="model-box-head">
        <button type="button" className="btn sm" onClick={onAll}>全选</button>
        <button type="button" className="btn sm" onClick={onNone}>清空</button>
        <span className="hint">
          {selected.length}/{models.length} 已选 · 第一个为默认模型 · {source ?? "未知来源"}
        </span>
      </div>
      <div className="model-list">
        {models.length === 0 && (
          <div className="hint" style={{ padding: 8 }}>
            {error ?? "暂无模型"}
          </div>
        )}
        {models.map((m) => {
          const idx = selected.indexOf(m.slug);
          return (
            <label key={m.slug} className="model-item">
              <input
                type="checkbox"
                aria-label={`选择模型 ${m.displayName}`}
                checked={idx >= 0}
                onChange={() => onToggle(m.slug)}
              />
              <span className="model-item-name">
                {m.displayName} · {m.slug}
              </span>
              {idx === 0 && <span className="badge live">默认</span>}
              {idx > 0 && <span className="model-item-order">#{idx + 1}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [toast, setToast] = useState("");
  const [importInfo, setImportInfo] = useState<string>("（未导入）");
  const [allModels, setAllModels] = useState<AllModels | null>(null);
  const [openCodex, setOpenCodex] = useState<OpenCodexStatus | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [activityByInstance, setActivityByInstance] = useState<Record<string, ActivityEventView[]>>({});
  const [modelsState, setModelsState] = useState<{
    loading: boolean;
    at?: number;
    error?: string;
  }>({ loading: false });
  const [form, setForm] = useState({
    preset: "deepseek" as "deepseek" | "official" | "zen" | "go" | "opencodex-go" | "custom",
    id: "",
    label: "",
    selectedModels: [] as string[],
    pid: "deepseek",
    baseUrl: "https://api.deepseek.com/",
    envKey: "DEEPSEEK_API_KEY",
    apiKey: "",
  });

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const runAction = useCallback(async (
    key: string,
    action: () => Promise<void>,
  ) => {
    if (pending[key]) return;
    setPending((current) => ({ ...current, [key]: true }));
    try {
      await action();
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, [pending]);

  const loadModels = useCallback(async (force = false) => {
    setModelsState((s) => ({ ...s, loading: true }));
    try {
      const r = await api(force ? "/api/models?refresh=1" : "/api/models");
      if (r.ok) {
        setAllModels(r.body);
        setModelsState({ loading: false, at: Date.now() });
      } else {
        setModelsState((s) => ({ ...s, loading: false, error: "HTTP " + r.status }));
      }
    } catch (e: any) {
      setModelsState((s) => ({ ...s, loading: false, error: e?.message ?? "失败" }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [st, li, mo, adapter] = await Promise.all([
        api("/api/status"),
        api("/api/instances"),
        api("/api/models"),
        api("/api/adapters/opencodex"),
      ]);
      if (st.ok) setStatus(st.body);
      if (li.ok) setInstances(li.body);
      if (mo.ok) {
        setAllModels(mo.body);
        setModelsState((s) => ({ ...s, at: Date.now(), error: undefined }));
      }
      if (adapter.ok) setOpenCodex(adapter.body);
    } catch (e: any) {
      notify("刷新失败: " + (e?.message ?? e));
    }
  }, [notify]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const currentModelList = useMemo((): ModelList => {
    if (!allModels) return { source: "none", models: [] };
    if (form.preset === "official") return allModels.official;
    if (form.preset === "deepseek" || form.preset === "zen" || form.preset === "go" || form.preset === "opencodex-go") {
      const source = form.preset === "opencodex-go" ? "go" : form.preset;
      return allModels.presets[source] ?? { source: "none", models: [] };
    }
    return { source: "custom", models: [] };
  }, [allModels, form.preset]);

  useEffect(() => {
    const slugs = currentModelList.models.map((m) => m.slug);
    if (slugs.length === 0) return;
    setForm((f) => {
      const valid = f.selectedModels.filter((s) => slugs.includes(s));
      if (valid.length > 0) return f;
      return { ...f, selectedModels: slugs };
    });
  }, [currentModelList.models, form.preset]);

  const toggleModel = (slug: string) => {
    setForm((f) => ({
      ...f,
      selectedModels: f.selectedModels.includes(slug)
        ? f.selectedModels.filter((s) => s !== slug)
        : [...f.selectedModels, slug],
    }));
  };

  const create = async () => {
    await runAction("create", async () => {
    const selected = form.selectedModels;
    if (selected.length === 0) {
      notify("请至少选择一个模型");
      return;
    }
    const body: any = {
      id: form.id.trim() || form.label.trim() || (form.preset === "official" ? "official" : form.preset),
      label: form.label.trim() || form.preset,
      models: selected,
      surfaces: ["desktop", "cli"],
    };
    if (form.preset === "deepseek" || form.preset === "zen" || form.preset === "go" || form.preset === "opencodex-go") {
      body.model = selected[0];
      body.providerPreset = form.preset;
      body.apiKey = form.apiKey.trim() || undefined;
    } else if (form.preset === "official") {
      body.model = selected[0];
      body.official = true;
    } else {
      body.model = selected[0];
      body.provider = {
        id: form.pid.trim() || "custom",
        baseUrl: form.baseUrl.trim() || undefined,
        envKey: form.envKey.trim() || undefined,
      };
      body.apiKey = form.apiKey.trim() || undefined;
    }
    const r = await api("/api/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const notes = [r.body.secretNote, `${r.body.changes?.length ?? 0} 处配置变更`]
        .filter(Boolean)
        .join("；");
      notify(`实例已创建：${r.body.instance.id}（${notes}）`);
    } else {
      notify(r.body.error ?? "创建失败");
    }
    await refresh();
    });
  };

  const doImport = async () => {
    await runAction("import", async () => {
      const r = await api("/api/import");
      if (r.ok) {
        setImportInfo(JSON.stringify(r.body, null, 2));
        notify("导入完成");
      } else notify(r.body.error ?? "导入失败");
      await refresh();
    });
  };

  const launch = async (id: string, surface: string) => {
    await runAction(`${id}:${surface}:launch`, async () => {
      const r = await api(`/api/instances/${id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface }),
      });
      notify(
        r.ok
          ? `已启动 ${surface === "cli" ? "Codex CLI" : "桌面客户端"}（${r.body.fingerprint ?? "pid " + r.body.pid}）`
          : r.body.error ?? "启动失败",
      );
      await refresh();
    });
  };

  const stop = async (id: string, surface: string) => {
    await runAction(`${id}:${surface}:stop`, async () => {
      const r = await api(`/api/instances/${id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface }),
      });
      notify(r.ok ? "已停止" : r.body.error ?? "停止失败");
      await refresh();
    });
  };

  const remove = async (i: InstanceView) => {
    if (!confirm(`删除实例 ${i.id} 及其全部目录？\n\nconfig、模型和本地会话都会被永久删除。`)) return;
    await runAction(`${i.id}:delete`, async () => {
      const r = await api(`/api/instances/${i.id}`, { method: "DELETE" });
      notify(
        r.ok
          ? `已删除实例及其目录${r.body.removedSecret ? "，同时清理 API key" : ""}`
          : r.body.error ?? "删除失败",
      );
      await refresh();
    });
  };

  const switchModel = async (i: InstanceView, model: string) => {
    await runAction(`${i.id}:switch-model`, async () => {
      const r = await api(`/api/instances/${i.id}/switch-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      notify(r.ok ? `已切换模型 → ${model}` : r.body.error ?? "切换失败");
      await refresh();
    });
  };

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const PRESET_DEFAULTS: Record<string, { id: string; label: string }> = {
    deepseek: { id: "deepseek", label: "DeepSeek" },
    official: { id: "official", label: "OpenAI" },
    zen: { id: "zen", label: "OpenCode Zen" },
    go: { id: "go", label: "OpenCode Go" },
    "opencodex-go": { id: "opencodex-go", label: "OpenCode Go" },
    custom: { id: "custom", label: "自定义" },
  };
  const DEFAULT_IDS = new Set(Object.values(PRESET_DEFAULTS).map((d) => d.id));
  const DEFAULT_LABELS = new Set(Object.values(PRESET_DEFAULTS).map((d) => d.label));

  const onPresetChange = (v: string) => {
    setForm((f) => {
      const d = PRESET_DEFAULTS[v] ?? { id: v, label: v };
      return {
        ...f,
        preset: v as typeof f.preset,
        id: !f.id || DEFAULT_IDS.has(f.id) ? d.id : f.id,
        label: !f.label || DEFAULT_LABELS.has(f.label) ? d.label : f.label,
        selectedModels: [],
      };
    });
  };

  const startOpenCodex = async () => {
    await runAction("adapter:start", async () => {
      const r = await api("/api/adapters/opencodex/start", { method: "POST" });
      if (r.ok) {
        setOpenCodex(r.body);
        notify("OpenCodex 已启动");
      } else {
        notify(r.body.error ?? "OpenCodex 启动失败");
      }
      await refresh();
    });
  };

  const opencodeKeyForProvider = status?.opencodeAuth?.entries.find(
    (e) => e.provider === "deepseek" && e.hasKey,
  );

  const modelPoolFor = (i: InstanceView): ModelOption[] => {
    if (!allModels) return [];
    const list = i.provider
      ? allModels.presets[i.preset ?? i.provider.id] ?? { models: [] }
      : allModels.official;
    const pool = i.models ?? [];
    const seen = new Set<string>();
    const merged: ModelOption[] = [];
    for (const slug of pool) {
      const m = list.models.find((x) => x.slug === slug);
      if (m) {
        merged.push(m);
        seen.add(slug);
      }
    }
    for (const m of list.models) {
      if (!seen.has(m.slug)) merged.push(m);
    }
    return merged;
  };

  const runningInstances = instances.filter((i) => i.running.length > 0).length;
  const totalModels =
    (allModels?.official.models.length ?? 0) +
    Object.values(allModels?.presets ?? {}).reduce((n, p) => n + p.models.length, 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="mark">C</span>
          <span>
            <strong>Codex Manager</strong>
            <small>Local workspace</small>
          </span>
        </div>

        <div className="environment" id="environment">
          <div className="eyebrow">运行环境</div>
          <div className="environment-list">
            <div className="environment-row">
              <span className={status?.codexCli ? "status-dot online" : "status-dot"} />
              <span>Codex CLI</span>
              <small>{status?.codexCli?.version?.split(" ")[1] ?? "未检测"}</small>
            </div>
            <div className="environment-row">
              <span className={status?.opencodeCli ? "status-dot online" : "status-dot"} />
              <span>OpenCode</span>
              <small>{status?.opencodeCli?.version ?? "未检测"}</small>
            </div>
            <div className="environment-row">
              <span className={status?.desktopApp ? "status-dot online" : "status-dot"} />
              <span>桌面客户端</span>
              <small>{status?.desktopApp ? "就绪" : "未检测"}</small>
            </div>
          </div>
          <div className="home-path" title={status?.codexHome}>
            <span>CODEX_HOME</span>
            <code>{status?.codexHome ?? "正在读取…"}</code>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <div className="eyebrow">工作区 / 控制台</div>
            <h1>实例控制台</h1>
            <p>统一管理本机的 Codex 与 OpenCode 独立实例。</p>
          </div>
          <button type="button" className="btn secondary header-action" onClick={doImport}>
            {ImportIcon} {pending.import ? "导入中…" : "导入本机配置"}
          </button>
        </header>

        <section className="stats" aria-label="运行概览">
          <div className="stat-card">
            <div className="stat-icon violet">{LayersIcon}</div>
            <div><span>全部实例</span><strong>{instances.length}</strong><small>个已配置实例</small></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">{ActivityIcon}</div>
            <div><span>正在运行</span><strong>{runningInstances}</strong><small>{status?.runningDesktop.length ?? 0} 个桌面窗口</small></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">{TerminalIcon}</div>
            <div><span>可用模型</span><strong>{totalModels}</strong><small>来自 4 个模型源</small></div>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="content-section" id="instances">
            <div className="section-heading">
              <div>
                <h2>实例</h2>
                <p>启动客户端、打开 CLI 或切换当前模型。</p>
              </div>
              <span className="count-badge">{instances.length} 个实例</span>
            </div>

            {instances.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{LayersIcon}</div>
                <strong>还没有实例</strong>
                <p>从右侧创建第一个独立实例，它会显示在这里。</p>
                <a className="btn primary" href="#create">{PlusIcon} 新建实例</a>
              </div>
            ) : (
              <div className="inst-grid">
                {instances.map((i) => (
                  <article key={i.id} className={`inst${i.running.length ? " running" : ""}`}>
                    <div className="inst-top">
                      <div className={`instance-avatar ${i.running.length ? "is-running" : ""}`}>
                        {MonitorIcon}
                      </div>
                      <div className="instance-title">
                        <div className="head">
                          <span className="name">{i.label}</span>
                          <span className="badge provider">{i.provider ? i.provider.id : "openai"}</span>
                          {i.official && <span className="badge official">官方</span>}
                        </div>
                        <span className={i.running.length ? "run-state online" : "run-state"}>
                          <span className="status-dot" />
                          {i.running.length ? `运行中 · ${i.running.join(" + ")}` : "当前未运行"}
                        </span>
                      </div>
                    </div>

                    <div className="instance-details">
                      <div className="detail-row">
                        <span>当前模型</span>
                        <code>{i.model}</code>
                      </div>
                      <div className="detail-row">
                        <span>实例目录</span>
                        <code title={i.home}>{i.home}</code>
                      </div>
                      {(i.models && i.models.length > 1) || i.provider?.envKey ? (
                        <div className="detail-row compact">
                          <span>配置</span>
                          <small>
                            {i.models && i.models.length > 1 ? `${i.models.length} 个模型` : ""}
                            {i.models && i.models.length > 1 && i.provider?.envKey ? " · " : ""}
                            {i.provider?.envKey ?? ""}
                          </small>
                        </div>
                      ) : null}
                      <div className="detail-row compact">
                        <span>状态</span>
                        <small className="status-summary">
                          {i.running.includes("desktop") ? "桌面运行" : "桌面停止"}
                          {" · "}
                          {i.running.includes("cli") ? "CLI 运行" : "CLI 停止"}
                          {i.runtime?.profileInUse ? " · profile 占用" : ""}
                          {i.apiKeyConfigured === false ? " · 缺 API key" : ""}
                          {i.presetRequiresAdapter && !openCodex?.running ? " · 依赖未就绪" : ""}
                        </small>
                      </div>
                    </div>

                    <div className="instance-actions">
                      <div className="launch-actions">
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => launch(i.id, "desktop")}
                          disabled={pending[`${i.id}:desktop:launch`]}
                        >
                          {MonitorIcon}{" "}
                          {pending[`${i.id}:desktop:launch`]
                            ? "启动中…"
                            : i.provider
                              ? "启动 Codex"
                              : "打开客户端"}
                        </button>
                        {i.running.includes("desktop") && (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => stop(i.id, "desktop")}
                            disabled={pending[`${i.id}:desktop:stop`]}
                          >
                            {StopIcon} {pending[`${i.id}:desktop:stop`] ? "停止中…" : "停桌面"}
                          </button>
                        )}
                        {i.running.includes("cli") && (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => stop(i.id, "cli")}
                            disabled={pending[`${i.id}:cli:stop`]}
                          >
                            {StopIcon} {pending[`${i.id}:cli:stop`] ? "停止中…" : "停 CLI"}
                          </button>
                        )}
                      </div>
                      {!i.official && (
                        <div className="manage-actions">
                          <select
                            className="model-switch"
                            value={i.model}
                            disabled={pending[`${i.id}:switch-model`]}
                            onChange={(e) => switchModel(i, e.target.value)}
                            aria-label={`${i.label} 当前模型`}
                          >
                            {modelPoolFor(i).map((m) => (
                              <option key={m.slug} value={m.slug}>{m.slug}{m.slug === i.model ? "（当前）" : ""}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => remove(i)}
                            disabled={pending[`${i.id}:delete`]}
                            title="删除实例"
                            aria-label={`删除 ${i.label}`}
                          >
                            {TrashIcon}
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="details-toggle"
                      aria-expanded={expandedInstance === i.id}
                      onClick={() => {
                        const next = expandedInstance === i.id ? null : i.id;
                        setExpandedInstance(next);
                        if (next) {
                          api(`/api/instances/${i.id}/activity`).then((r) => {
                            if (r.ok) {
                              setActivityByInstance((current) => ({
                                ...current,
                                [i.id]: r.body.events ?? [],
                              }));
                            }
                          });
                        }
                      }}
                    >
                      {expandedInstance === i.id ? "收起详情" : "查看详情"}
                    </button>

                    {expandedInstance === i.id && (
                      <div className="instance-drawer">
                        <div className="drawer-grid">
                          <div>
                            <h4>进程</h4>
                            {i.runtime?.processes.length ? (
                              <ul className="process-list">
                                {i.runtime.processes.map((process) => (
                                  <li key={`${process.surface}-${process.pid}`}>
                                    <span className="badge">{process.surface}</span>
                                    <code>PID {process.pid}</code>
                                    <small>{formatTime(process.startedAt)}</small>
                                    <small>{process.managed ? "managed" : process.source}</small>
                                    {process.stale && <span className="badge">stale</span>}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="hint">没有检测到进程。</p>
                            )}
                          </div>
                          <div>
                            <h4>环境</h4>
                            <dl className="drawer-facts">
                              <div><dt>Profile</dt><dd title={i.profile ?? "默认 profile"}>{i.profile ?? "默认 profile"}</dd></div>
                              <div><dt>API key</dt><dd>{i.provider?.envKey ? (i.apiKeyConfigured ? "已配置" : "未配置") : "不需要"}</dd></div>
                              <div><dt>OpenCodex</dt><dd>{i.presetRequiresAdapter ? (openCodex?.running ? `运行中 · ${openCodex.port}` : "未运行") : "不依赖"}</dd></div>
                              <div><dt>启动目录</dt><dd title={i.home}>{i.home}</dd></div>
                            </dl>
                          </div>
                        </div>
                        <div>
                          <h4>最近操作</h4>
                          {activityByInstance[i.id]?.length ? (
                            <ul className="activity-list">
                              {activityByInstance[i.id].map((event) => (
                                <li key={`${event.at}-${event.message}`} className={event.level}>
                                  <small>{formatTime(event.at)}</small>
                                  <span>{event.message}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="hint">暂无历史记录。</p>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}

            <details className="import-result" open={importInfo !== "（未导入）"}>
              <summary>最近一次导入结果</summary>
              <pre>{importInfo}</pre>
            </details>
          </section>

          <aside className="creator-card" id="create">
            <div className="creator-heading">
              <span className="creator-icon">{PlusIcon}</span>
              <div><h2>新建实例</h2><p>创建隔离的运行环境</p></div>
            </div>
            <div className="catalog-summary">
              <span className={modelsState.error ? "catalog-state error" : "catalog-state"}>
                <span className="status-dot" style={{ background: modelsState.error ? "var(--red)" : "var(--green)" }} />
                {modelsState.loading
                  ? "正在探测模型…"
                  : modelsState.error
                    ? `模型同步失败：${modelsState.error}`
                    : modelsState.at
                      ? `${Math.max(0, Math.round((Date.now() - modelsState.at) / 1000))} 秒前更新`
                      : "等待首次同步…"}
              </span>
              <span>{totalModels} 个模型可用</span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => loadModels(true)}
                disabled={modelsState.loading}
                title="强制重新探测模型目录"
              >
                {modelsState.loading ? "刷新中…" : "立即刷新"}
              </button>
            </div>
            {(form.preset === "zen" || form.preset === "go" || form.preset === "opencodex-go") && (
              <div className={`adapter-notice ${openCodex?.running ? "ready" : ""}`}>
                <span className="status-dot" />
                <span>
                  {openCodex?.running
                    ? `OpenCodex 已连接 · localhost:${openCodex.port}`
                    : openCodex?.installed
                      ? "OpenCodex 尚未启动"
                      : "未检测到 OpenCodex"}
                </span>
                {!openCodex?.running && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={startOpenCodex}
                    disabled={pending["adapter:start"]}
                  >
                    {pending["adapter:start"] ? "启动中…" : openCodex?.installed ? "启动" : "安装说明"}
                  </button>
                )}
              </div>
            )}
            <div className="field">
              <label>模型来源</label>
              <select
                value={form.preset}
                aria-label="模型来源"
                onChange={(e) => onPresetChange(e.target.value)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="zen">OpenCode Zen</option>
                <option value="go">OpenCode Go</option>
                <option value="official">OpenAI</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div className="two-col">
              <div className="field">
                <label>实例名</label>
                <input
                  aria-label="实例名"
                  value={form.id}
                  onChange={(e) => set("id", e.target.value)}
                  placeholder={PRESET_DEFAULTS[form.preset]?.id ?? "deepseek"}
                />
              </div>
              <div className="field">
                <label>显示名</label>
                <input
                  aria-label="显示名"
                  value={form.label}
                  onChange={(e) => set("label", e.target.value)}
                  placeholder={PRESET_DEFAULTS[form.preset]?.label ?? "DeepSeek Codex"}
                />
              </div>
            </div>
            <div className="field">
              <label>模型 <span className="label-note">第一个选项作为默认</span></label>
              <ModelPicker
                models={currentModelList.models}
                selected={form.selectedModels}
                onToggle={toggleModel}
                onAll={() => set("selectedModels", currentModelList.models.map((m) => m.slug))}
                onNone={() => set("selectedModels", [])}
                error={currentModelList.error}
                source={currentModelList.source}
              />
            </div>
            {form.preset === "custom" && (
              <>
            <div className="field">
              <label>provider id</label>
              <input aria-label="provider id" value={form.pid} onChange={(e) => set("pid", e.target.value)} placeholder="deepseek" />
            </div>
            <div className="field">
              <label>base_url</label>
              <input aria-label="base_url" value={form.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
            </div>
            <div className="field">
              <label>env_key（API key 环境变量名）</label>
              <input aria-label="env_key（API key 环境变量名）" value={form.envKey} onChange={(e) => set("envKey", e.target.value)} />
            </div>
              </>
            )}
            {form.preset !== "official" && (
              <div className="field">
                <label>API Key</label>
                <input
                  type="password"
                  aria-label="API Key"
                  value={form.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                  placeholder="sk-…（写入 ~/.codex-mgr/.env，经 env_key 注入）"
                />
                <div className="hint">
                  {form.preset === "zen" || form.preset === "go" || form.preset === "opencodex-go"
                    ? "会写入项目 .env，并自动配置到 OpenCodex 本地适配层"
                    : form.preset === "deepseek" && opencodeKeyForProvider
                    ? "未填写时自动从 opencode auth.json 导入 DEEPSEEK_API_KEY"
                    : "留空则使用已有环境变量 / .env 中的值"}
                </div>
              </div>
            )}
            <div className="btnrow">
              <button type="button" className="btn primary create-button" onClick={create}>
                {PlusIcon} {pending.create ? "创建中…" : "创建实例"}
              </button>
            </div>
          </aside>
        </div>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
