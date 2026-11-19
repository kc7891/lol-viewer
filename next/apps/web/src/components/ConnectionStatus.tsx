import type { ConnectionStatus as Status } from "@lol-viewer/protocol";

const LABEL: Record<Status, string> = {
  connecting: "Riot API: Connecting...",
  connected: "Riot API: Connected",
  disconnected: "Riot API: Disconnected",
};

export function ConnectionStatus({ status }: { status: Status }) {
  return (
    <div className="status" data-status={status} role="status">
      <span className="dot" />
      {LABEL[status]}
    </div>
  );
}
