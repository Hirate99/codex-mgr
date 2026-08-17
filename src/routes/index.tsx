"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type {
  ActivityEventView,
  AllModels,
  CreateFormState,
  InstanceView,
  ModelList,
  ModelOption,
  OpenCodexStatus,
  Status,
  ToastItem,
  ToastKind,
} from "../lib/types";
import { Sidebar } from "../components/Sidebar";
import { InstanceCard } from "../components/InstanceCard";
import { CreateForm } from "../components/CreateForm";
import { Toasts } from "../components/Toasts";
import { ActivityIcon, ImportIcon, LayersIcon, PlusIcon, TerminalIcon } from "../components/icons";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const INITIAL_FORM: CreateFormState = {
  preset: "deepseek",
  id: "",
  label: "",
  selectedModels: [],
  pid: "deepseek",
  baseUrl: "https://api.deepseek.com/",
  envKey: "DEEPSEEK_API_KEY",
  apiKey: "",
};

function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [allModels, setAllModels] = useState<AllModels | null>(null);
  const [openCodex, setOpenCodex] = useState<OpenCodexStatus | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [activityByInstance, setActivityByInstance] = useState<Record<string, ActivityEventView[]>>({});
  const [modelsState, setModelsState] = useState<{ loading: boolean; at?: number; error?: string }>({
    loading: false,
  });
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);
  const toastId = useRef(0);

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, kind, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
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
    },
    [pending],
  );

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
      setModelsState((s) => ({ ...s, loading: false, error: e?.message ?? "Failed" }));
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
    } catch {
      // Transient polling failures are ignored; the next tick retries.
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 4000);
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
  }, [currentModelList.models]);

  const create = async () => {
    await runAction("create", async () => {
      const selected = form.selectedModels;
      if (selected.length === 0) {
        notify("Select at least one model", "error");
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
        const notes = [r.body.secretNote, `${r.body.changes?.length ?? 0} config change(s)`]
          .filter(Boolean)
          .join("; ");
        notify(`Instance created: ${r.body.instance.id} (${notes})`, "success");
        setForm((f) => ({ ...INITIAL_FORM, preset: f.preset, selectedModels: f.selectedModels }));
      } else {
        notify(r.body.error ?? "Create failed", "error");
      }
      await refresh();
    });
  };

  const doImport = async () => {
    await runAction("import", async () => {
      const r = await api("/api/import");
      if (r.ok) {
        setImportInfo(JSON.stringify(r.body, null, 2));
        notify("Import complete", "success");
      } else {
        notify(r.body.error ?? "Import failed", "error");
      }
      await refresh();
    });
  };

  const launch = async (id: string, surface: "desktop" | "cli") => {
    await runAction(`${id}:${surface}:launch`, async () => {
      const r = await api(`/api/instances/${id}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface }),
      });
      notify(
        r.ok
          ? `Started ${surface === "cli" ? "Codex CLI" : "Desktop app"} (${r.body.fingerprint ?? "pid " + r.body.pid})`
          : r.body.error ?? "Start failed",
        r.ok ? "success" : "error",
      );
      await refresh();
    });
  };

  const stop = async (id: string, surface: "desktop" | "cli") => {
    await runAction(`${id}:${surface}:stop`, async () => {
      const r = await api(`/api/instances/${id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface }),
      });
      notify(r.ok ? "Stopped" : r.body.error ?? "Stop failed", r.ok ? "success" : "error");
      await refresh();
    });
  };

  const remove = async (i: InstanceView) => {
    if (
      !confirm(
        `Delete instance ${i.id} and all its directories?\n\nConfig, models, and local sessions will be permanently deleted.`,
      )
    ) {
      return;
    }
    await runAction(`${i.id}:delete`, async () => {
      const r = await api(`/api/instances/${i.id}`, { method: "DELETE" });
      notify(
        r.ok
          ? `Deleted instance and its directories${r.body.removedSecret ? ", and cleaned up the API key" : ""}`
          : r.body.error ?? "Delete failed",
        r.ok ? "success" : "error",
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
      notify(r.ok ? `Model switched to ${model}` : r.body.error ?? "Switch failed", r.ok ? "success" : "error");
      await refresh();
    });
  };

  const startOpenCodex = async () => {
    await runAction("adapter:start", async () => {
      const r = await api("/api/adapters/opencodex/start", { method: "POST" });
      if (r.ok) {
        setOpenCodex(r.body);
        notify("OpenCodex started", "success");
      } else {
        notify(r.body.error ?? "Failed to start OpenCodex", "error");
      }
      await refresh();
    });
  };

  const toggleExpand = useCallback((id: string) => {
    setExpandedInstance((current) => {
      const next = current === id ? null : id;
      if (next) {
        api(`/api/instances/${id}/activity`).then((r) => {
          if (r.ok) {
            setActivityByInstance((prev) => ({ ...prev, [id]: r.body.events ?? [] }));
          }
        });
      }
      return next;
    });
  }, []);

  const canAutoImportKey = Boolean(
    status?.opencodeAuth?.entries.find((e) => e.provider === "deepseek" && e.hasKey),
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
  const modelSourceCount =
    (allModels ? 1 : 0) + Object.keys(allModels?.presets ?? {}).length;
  const totalModels =
    (allModels?.official.models.length ?? 0) +
    Object.values(allModels?.presets ?? {}).reduce((n, p) => n + p.models.length, 0);

  return (
    <div className="app-shell">
      <Sidebar status={status} />

      <main className="main-content">
        <header className="page-header">
          <div>
            <div className="eyebrow">Workspace / Console</div>
            <h1>Instance Console</h1>
            <p>Manage independent Codex and OpenCode instances on this machine.</p>
          </div>
          <button type="button" className="btn secondary header-action" onClick={doImport} disabled={pending.import}>
            {ImportIcon} {pending.import ? "Importing..." : "Import local config"}
          </button>
        </header>

        <section className="stats" aria-label="Runtime overview">
          <div className="stat-card">
            <div className="stat-icon violet">{LayersIcon}</div>
            <div>
              <span>Total instances</span>
              <strong>{instances.length}</strong>
              <small>configured instances</small>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green">{ActivityIcon}</div>
            <div>
              <span>Running</span>
              <strong>{runningInstances}</strong>
              <small>{status?.runningDesktop.length ?? 0} desktop windows</small>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">{TerminalIcon}</div>
            <div>
              <span>Available models</span>
              <strong>{totalModels}</strong>
              <small>from {modelSourceCount} model sources</small>
            </div>
          </div>
        </section>

        <div className="workspace-grid">
          <section className="content-section" id="instances">
            <div className="section-heading">
              <div>
                <h2>Instances</h2>
                <p>Launch apps, open CLIs, or switch models.</p>
              </div>
              <span className="count-badge">{instances.length} total</span>
            </div>

            {instances.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{LayersIcon}</div>
                <strong>No instances yet</strong>
                <p>Create your first isolated instance on the right; it will appear here.</p>
                <a className="btn primary" href="#create">
                  {PlusIcon} New instance
                </a>
              </div>
            ) : (
              <div className="inst-grid">
                {instances.map((i) => (
                  <InstanceCard
                    key={i.id}
                    instance={i}
                    pending={pending}
                    expanded={expandedInstance === i.id}
                    activity={activityByInstance[i.id]}
                    modelPool={modelPoolFor(i)}
                    openCodex={openCodex}
                    onLaunch={launch}
                    onStop={stop}
                    onRemove={remove}
                    onSwitchModel={switchModel}
                    onToggleExpand={toggleExpand}
                  />
                ))}
              </div>
            )}

            {importInfo ? (
              <details className="import-result" open>
                <summary>Latest import result</summary>
                <pre>{importInfo}</pre>
              </details>
            ) : null}
          </section>

          <CreateForm
            form={form}
            setForm={setForm}
            modelList={currentModelList}
            modelsState={modelsState}
            totalModels={totalModels}
            openCodex={openCodex}
            pending={pending}
            canAutoImportKey={canAutoImportKey}
            onRefreshModels={() => loadModels(true)}
            onStartAdapter={startOpenCodex}
            onCreate={create}
          />
        </div>
      </main>

      <Toasts items={toasts} />
    </div>
  );
}
