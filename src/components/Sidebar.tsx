import type { Status } from "../lib/types";

export function Sidebar({ status }: { status: Status | null }) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="mark">C</span>
        <span>
          <strong>Codex Manager</strong>
          <small>Local workspace</small>
        </span>
      </div>

      <div className="environment" id="environment">
        <div className="eyebrow">Environment</div>
        <div className="environment-list">
          <div className="environment-row">
            <span className={status?.codexCli ? "status-dot online" : "status-dot"} />
            <span>Codex CLI</span>
            <small>{status?.codexCli?.version?.split(" ")[1] ?? "Not detected"}</small>
          </div>
          <div className="environment-row">
            <span className={status?.opencodeCli ? "status-dot online" : "status-dot"} />
            <span>OpenCode</span>
            <small>{status?.opencodeCli?.version ?? "Not detected"}</small>
          </div>
          <div className="environment-row">
            <span className={status?.desktopApp ? "status-dot online" : "status-dot"} />
            <span>Desktop app</span>
            <small>{status?.desktopApp ? "Ready" : "Not detected"}</small>
          </div>
        </div>
        <div className="home-path" title={status?.codexHome}>
          <span>CODEX_HOME</span>
          <code>{status?.codexHome ?? "Loading..."}</code>
        </div>
      </div>
    </aside>
  );
}
