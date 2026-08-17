import type { CreateFormState, ModelList, OpenCodexStatus, Preset } from "../lib/types";
import { ModelPicker } from "./ModelPicker";
import { PlusIcon, RefreshIcon } from "./icons";

export const PRESET_DEFAULTS: Record<string, { id: string; label: string }> = {
  deepseek: { id: "deepseek", label: "DeepSeek" },
  official: { id: "official", label: "OpenAI" },
  zen: { id: "zen", label: "OpenCode Zen" },
  go: { id: "go", label: "OpenCode Go" },
  "opencodex-go": { id: "opencodex-go", label: "OpenCode Go" },
  custom: { id: "custom", label: "Custom" },
};

const DEFAULT_IDS = new Set(Object.values(PRESET_DEFAULTS).map((d) => d.id));
const DEFAULT_LABELS = new Set(Object.values(PRESET_DEFAULTS).map((d) => d.label));

const ADAPTER_PRESETS: ReadonlySet<Preset> = new Set(["zen", "go", "opencodex-go"]);

interface CreateFormProps {
  form: CreateFormState;
  setForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  modelList: ModelList;
  modelsState: { loading: boolean; at?: number; error?: string };
  totalModels: number;
  openCodex: OpenCodexStatus | null;
  pending: Record<string, boolean>;
  canAutoImportKey: boolean;
  onRefreshModels: () => void;
  onStartAdapter: () => void;
  onCreate: () => void;
}

export function CreateForm(props: CreateFormProps) {
  const {
    form,
    setForm,
    modelList,
    modelsState,
    totalModels,
    openCodex,
    pending,
    canAutoImportKey,
    onRefreshModels,
    onStartAdapter,
    onCreate,
  } = props;

  const set = (k: keyof CreateFormState, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }) as CreateFormState);

  const onPresetChange = (v: string) => {
    setForm((f) => {
      const d = PRESET_DEFAULTS[v] ?? { id: v, label: v };
      return {
        ...f,
        preset: v as Preset,
        id: !f.id || DEFAULT_IDS.has(f.id) ? d.id : f.id,
        label: !f.label || DEFAULT_LABELS.has(f.label) ? d.label : f.label,
        selectedModels: [],
      };
    });
  };

  const toggleModel = (slug: string) => {
    setForm((f) => ({
      ...f,
      selectedModels: f.selectedModels.includes(slug)
        ? f.selectedModels.filter((s) => s !== slug)
        : [...f.selectedModels, slug],
    }));
  };

  const needsAdapter = ADAPTER_PRESETS.has(form.preset);
  const createDisabled = pending.create || form.selectedModels.length === 0;

  return (
    <aside className="creator-card" id="create">
      <div className="creator-heading">
        <span className="creator-icon">{PlusIcon}</span>
        <div>
          <h2>New instance</h2>
          <p>Create an isolated runtime environment</p>
        </div>
      </div>

      <div className={`catalog-summary${modelsState.error ? " has-error" : ""}`}>
        <span className={`catalog-state${modelsState.error ? " error" : ""}`}>
          <span className="status-dot" />
          {modelsState.loading
            ? "Probing model catalogs..."
            : modelsState.error
              ? `Model sync failed: ${modelsState.error}`
              : modelsState.at
                ? `Catalogs synced · ${totalModels} models`
                : "Waiting for first sync..."}
        </span>
        <button
          type="button"
          className="btn sm ghost"
          onClick={onRefreshModels}
          disabled={modelsState.loading}
          title="Force re-probe model catalogs"
        >
          {RefreshIcon}
          {modelsState.loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {needsAdapter ? (
        <div className={`adapter-notice${openCodex?.running ? " ready" : ""}`}>
          <span className="status-dot" />
          <span>
            {openCodex?.running
              ? `OpenCodex connected · localhost:${openCodex.port}`
              : openCodex?.installed
                ? "OpenCodex installed but not started"
                : "OpenCodex not detected"}
          </span>
          {openCodex?.running ? null : (
            <button
              type="button"
              className="btn sm"
              onClick={onStartAdapter}
              disabled={pending["adapter:start"]}
            >
              {pending["adapter:start"] ? "Starting..." : openCodex?.installed ? "Start" : "Install guide"}
            </button>
          )}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="create-preset">Model source</label>
        <select
          id="create-preset"
          value={form.preset}
          onChange={(e) => onPresetChange(e.target.value)}
        >
          <option value="deepseek">DeepSeek</option>
          <option value="zen">OpenCode Zen</option>
          <option value="go">OpenCode Go</option>
          <option value="official">OpenAI (official)</option>
          <option value="custom">Custom provider</option>
        </select>
      </div>

      <div className="two-col">
        <div className="field">
          <label htmlFor="create-id">Instance ID</label>
          <input
            id="create-id"
            value={form.id}
            onChange={(e) => set("id", e.target.value)}
            placeholder={PRESET_DEFAULTS[form.preset]?.id ?? "deepseek"}
          />
        </div>
        <div className="field">
          <label htmlFor="create-label">Display name</label>
          <input
            id="create-label"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder={PRESET_DEFAULTS[form.preset]?.label ?? "DeepSeek Codex"}
          />
        </div>
      </div>

      <div className="field">
        <label>
          Models <span className="label-note">first selected is the default</span>
        </label>
        <ModelPicker
          models={modelList.models}
          selected={form.selectedModels}
          onToggle={toggleModel}
          onAll={() => set("selectedModels", modelList.models.map((m) => m.slug))}
          onNone={() => set("selectedModels", [])}
          error={modelList.error}
          source={modelList.source}
        />
      </div>

      {form.preset === "custom" ? (
        <>
          <div className="field">
            <label htmlFor="create-pid">Provider ID</label>
            <input
              id="create-pid"
              value={form.pid}
              onChange={(e) => set("pid", e.target.value)}
              placeholder="deepseek"
            />
          </div>
          <div className="field">
            <label htmlFor="create-baseurl">Base URL</label>
            <input
              id="create-baseurl"
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder="https://api.example.com/"
            />
          </div>
          <div className="field">
            <label htmlFor="create-envkey">API key env var name</label>
            <input
              id="create-envkey"
              value={form.envKey}
              onChange={(e) => set("envKey", e.target.value)}
              placeholder="DEEPSEEK_API_KEY"
            />
          </div>
        </>
      ) : null}

      {form.preset !== "official" ? (
        <div className="field">
          <label htmlFor="create-apikey">API key</label>
          <input
            id="create-apikey"
            type="password"
            value={form.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder="sk-... (stored in ~/.codex-mgr/.env)"
            autoComplete="off"
          />
          <div className="hint">
            {needsAdapter
              ? "Written to the project .env and automatically configured in the OpenCodex local adapter."
              : form.preset === "deepseek" && canAutoImportKey
                ? "Leave empty to auto-import DEEPSEEK_API_KEY from your opencode auth.json."
                : "Leave empty to use the existing env var / .env value."}
          </div>
        </div>
      ) : null}

      <div className="btnrow">
        <button
          type="button"
          className="btn primary create-button"
          onClick={onCreate}
          disabled={createDisabled}
          title={form.selectedModels.length === 0 ? "Select at least one model first" : undefined}
        >
          {PlusIcon} {pending.create ? "Creating..." : "Create instance"}
        </button>
      </div>
    </aside>
  );
}
