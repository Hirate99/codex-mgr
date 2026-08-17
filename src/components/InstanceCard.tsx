import type { ActivityEventView, InstanceView, ModelOption, OpenCodexStatus } from "../lib/types";
import { formatTime } from "../lib/api";
import { ChevronIcon, MonitorIcon, StopIcon, TerminalIcon, TrashIcon } from "./icons";

interface InstanceCardProps {
  instance: InstanceView;
  pending: Record<string, boolean>;
  expanded: boolean;
  activity?: ActivityEventView[];
  modelPool: ModelOption[];
  openCodex: OpenCodexStatus | null;
  onLaunch: (id: string, surface: "desktop" | "cli") => void;
  onStop: (id: string, surface: "desktop" | "cli") => void;
  onRemove: (instance: InstanceView) => void;
  onSwitchModel: (instance: InstanceView, model: string) => void;
  onToggleExpand: (id: string) => void;
}

export function InstanceCard(props: InstanceCardProps) {
  const {
    instance: i,
    pending,
    expanded,
    activity,
    modelPool,
    openCodex,
    onLaunch,
    onStop,
    onRemove,
    onSwitchModel,
    onToggleExpand,
  } = props;
  const running = i.running.length > 0;
  const desktopRunning = i.running.includes("desktop");
  const cliRunning = i.running.includes("cli");

  const warnings: string[] = [];
  if (i.apiKeyConfigured === false) warnings.push("missing API key");
  if (i.presetRequiresAdapter && !openCodex?.running) warnings.push("OpenCodex not running");
  if (i.runtime?.profileInUse) warnings.push("profile in use");

  return (
    <article className={`inst${running ? " running" : ""}`}>
      <header className="inst-top">
        <div className={`instance-avatar${running ? " is-running" : ""}`}>{MonitorIcon}</div>
        <div className="instance-title">
          <div className="head">
            <span className="name" title={i.label}>{i.label}</span>
            <span className="badge provider">{i.provider ? i.provider.id : "openai"}</span>
            {i.official ? <span className="badge official">Official</span> : null}
          </div>
          <span className={`run-state${running ? " online" : ""}`}>
            <span className="status-dot" />
            {running ? `Running · ${i.running.join(" + ")}` : "Stopped"}
          </span>
        </div>
      </header>

      <div className="instance-details">
        <div className="detail-row">
          <span>Model</span>
          <code title={i.model}>{i.model}</code>
        </div>
        <div className="detail-row">
          <span>Directory</span>
          <code title={i.home}>{i.home}</code>
        </div>
        <div className="detail-row">
          <span>Config</span>
          <small>
            {i.models && i.models.length > 1 ? `${i.models.length} models` : "1 model"}
            {i.provider?.envKey ? ` · ${i.provider.envKey}` : ""}
          </small>
        </div>
        {warnings.length > 0 ? (
          <div className="detail-row">
            <span>Attention</span>
            <small className="warn-text">{warnings.join(" · ")}</small>
          </div>
        ) : null}
      </div>

      <div className="instance-actions">
        <div className="launch-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => onLaunch(i.id, "desktop")}
            disabled={pending[`${i.id}:desktop:launch`]}
          >
            {MonitorIcon}
            {pending[`${i.id}:desktop:launch`]
              ? "Starting..."
              : i.provider
                ? "Launch Codex"
                : "Open app"}
          </button>
          {cliRunning ? null : (
            <button
              type="button"
              className="btn secondary"
              onClick={() => onLaunch(i.id, "cli")}
              disabled={pending[`${i.id}:cli:launch`]}
              title="Open a Codex CLI terminal for this instance"
            >
              {TerminalIcon}
              {pending[`${i.id}:cli:launch`] ? "Starting..." : "CLI"}
            </button>
          )}
          {desktopRunning ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => onStop(i.id, "desktop")}
              disabled={pending[`${i.id}:desktop:stop`]}
            >
              {StopIcon} {pending[`${i.id}:desktop:stop`] ? "Stopping..." : "Stop desktop"}
            </button>
          ) : null}
          {cliRunning ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => onStop(i.id, "cli")}
              disabled={pending[`${i.id}:cli:stop`]}
            >
              {StopIcon} {pending[`${i.id}:cli:stop`] ? "Stopping..." : "Stop CLI"}
            </button>
          ) : null}
        </div>
        {i.official ? null : (
          <div className="manage-actions">
            <select
              className="model-switch"
              value={i.model}
              disabled={pending[`${i.id}:switch-model`]}
              onChange={(e) => onSwitchModel(i, e.target.value)}
              aria-label={`${i.label} current model`}
            >
              {modelPool.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.slug}
                  {m.slug === i.model ? " (current)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => onRemove(i)}
              disabled={pending[`${i.id}:delete`]}
              title="Delete instance"
              aria-label={`Delete ${i.label}`}
            >
              {TrashIcon}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="details-toggle"
        aria-expanded={expanded}
        onClick={() => onToggleExpand(i.id)}
      >
        {expanded ? "Hide details" : "View details"}
        <ChevronIcon open={expanded} />
      </button>

      {expanded ? (
        <div className="instance-drawer">
          <div className="drawer-grid">
            <div>
              <h4>Processes</h4>
              {i.runtime?.processes.length ? (
                <ul className="process-list">
                  {i.runtime.processes.map((process) => (
                    <li key={`${process.surface}-${process.pid}`}>
                      <span className="badge">{process.surface}</span>
                      <code>PID {process.pid}</code>
                      <small>{formatTime(process.startedAt)}</small>
                      <small>{process.managed ? "managed" : process.source}</small>
                      {process.stale ? <span className="badge stale">stale</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">No processes detected.</p>
              )}
            </div>
            <div>
              <h4>Environment</h4>
              <dl className="drawer-facts">
                <div>
                  <dt>Profile</dt>
                  <dd title={i.profile ?? "default profile"}>{i.profile ?? "default profile"}</dd>
                </div>
                <div>
                  <dt>API key</dt>
                  <dd>
                    {i.provider?.envKey
                      ? i.apiKeyConfigured
                        ? "Configured"
                        : "Not configured"
                      : "Not required"}
                  </dd>
                </div>
                <div>
                  <dt>OpenCodex</dt>
                  <dd>
                    {i.presetRequiresAdapter
                      ? openCodex?.running
                        ? `Running · port ${openCodex.port}`
                        : "Not running"
                      : "Not required"}
                  </dd>
                </div>
                <div>
                  <dt>Directory</dt>
                  <dd title={i.home}>{i.home}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div>
            <h4>Recent activity</h4>
            {activity?.length ? (
              <ul className="activity-list">
                {activity.map((event) => (
                  <li key={`${event.at}-${event.message}`} className={event.level}>
                    <small>{formatTime(event.at)}</small>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No history yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}
