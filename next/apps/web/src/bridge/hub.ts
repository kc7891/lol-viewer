/** Bridge that subscribes to a running Hub over WebSocket (phone / second screen). */
import { HubMessageSchema, type LolViewerBridge, type MatchState } from "@lol-viewer/protocol";
import { initialMatchState } from "@lol-viewer/core";

export function createHubBridge(streamUrl: string): LolViewerBridge {
  let state: MatchState = initialMatchState();
  const listeners = new Set<(s: MatchState) => void>();
  let ws: WebSocket | null = null;

  const connect = () => {
    ws = new WebSocket(streamUrl);
    ws.onmessage = (ev) => {
      const parsed = HubMessageSchema.safeParse(JSON.parse(String(ev.data)));
      if (!parsed.success) return;
      state = parsed.data.state;
      listeners.forEach((l) => l(state));
    };
    ws.onclose = () => {
      state = { ...state, connection: "disconnected" };
      listeners.forEach((l) => l(state));
      setTimeout(connect, 2000);
    };
  };
  connect();

  return {
    kind: "hub",
    onState(cb) {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    },
  };
}
