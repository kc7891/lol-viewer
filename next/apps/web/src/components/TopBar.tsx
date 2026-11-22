import type { ConnectionStatus } from "@lol-viewer/protocol";
import { phaseLabel } from "../ui/labels.ts";

export type Page = "viewers" | "live" | "settings";

const PAGES: { page: Page; label: string }[] = [
  { page: "viewers", label: "Viewers" },
  { page: "live", label: "Live Game" },
  { page: "settings", label: "Settings" },
];

const CONN_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected",
};

export type TopBarProps = {
  page: Page;
  onPage: (p: Page) => void;
  connection: ConnectionStatus;
  phase: string;
  /** Red dot on Settings (a newer version exists). */
  updateAvailable?: boolean;
  /** Click on the connection status: go to Settings -> League Client. */
  onConnectionClick: () => void;
  extra?: React.ReactNode;
};

export function TopBar({ page, onPage, connection, phase, updateAvailable = false, onConnectionClick, extra }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">LoL Viewer</div>
      <nav className="tabs" aria-label="Pages">
        {PAGES.map((p) => (
          <button key={p.page} type="button" className="tab" aria-current={page === p.page ? "page" : undefined} onClick={() => onPage(p.page)}>
            {p.label}
            {p.page === "settings" && updateAvailable && <span className="update-dot" role="img" aria-label="Update available" />}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      {extra}
      {connection === "connected" && <span className="phase">{phaseLabel(phase)}</span>}
      <button type="button" className="conn" data-status={connection} title="League Client connection (open Settings)" onClick={onConnectionClick}>
        <span className="dot" />
        {CONN_LABEL[connection]}
      </button>
    </header>
  );
}
