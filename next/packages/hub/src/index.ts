/**
 * @lol-viewer/hub — single source of truth for MatchState.
 *
 * dispatch(LcuEvent) -> core.reduce (DetectorState, kept private) -> notify subscribers with
 * the MatchState only (IPC, WebSocket, tests). An unchanged MatchState is not re-sent.
 * The optional WebSocket server lets browsers / phones / OBS subscribe.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { initialDetectorState, reduce, type DetectorState } from "@lol-viewer/core";
import type { HubMessage, LcuEvent, MatchState } from "@lol-viewer/protocol";

export type Listener = (state: MatchState) => void;

export class Hub {
  #detector: DetectorState = initialDetectorState();
  #listeners = new Set<Listener>();

  get state(): MatchState {
    return this.#detector.match;
  }

  dispatch(event: LcuEvent): void {
    const prev = this.#detector.match;
    this.#detector = reduce(this.#detector, event);
    const next = this.#detector.match;
    if (next === prev) return;
    for (const l of this.#listeners) l(next);
  }

  /** Calls the listener immediately with the current state, then on every change. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#detector.match);
    return () => this.#listeners.delete(listener);
  }
}

export type HubServerOptions = {
  /** Default 127.0.0.1. Anything else is the explicit LAN opt-in. */
  host?: string;
  port?: number;
  /** Shared secret clients must send as ?token=. Generated when omitted. */
  token?: string;
  /** Exact Origin values allowed (browsers always send Origin; non-browser clients may omit it). */
  allowedOrigins?: string[];
};

export type HubServer = { port: number; token: string; url: string; close: () => Promise<void> };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Exposes `GET /api/state` and `WS /api/stream`.
 * Rejects: wrong token, foreign Origin (blocks random websites / DNS rebinding),
 * and Host headers that are not the bound address.
 */
export async function startHubServer(hub: Hub, opts: HubServerOptions = {}): Promise<HubServer> {
  const host = opts.host ?? "127.0.0.1";
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const allowedOrigins = new Set(opts.allowedOrigins ?? []);
  let port = 0;

  const authorize = (req: IncomingMessage): number => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    const hostHeader = req.headers.host ?? "";
    const okHosts = [`${host}:${port}`, ...(host === "127.0.0.1" ? [`localhost:${port}`] : [])];
    if (!okHosts.includes(hostHeader)) return 421;
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) return 403;
    if (!safeEqual(url.searchParams.get("token") ?? "", token)) return 401;
    return 200;
  };

  const server: Server = createServer((req, res) => {
    const code = authorize(req);
    if (code !== 200) return void res.writeHead(code).end();
    if (req.method === "GET" && (req.url ?? "").startsWith("/api/state")) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(hub.state));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const code = authorize(req);
    if (code !== 200 || !(req.url ?? "").startsWith("/api/stream")) {
      socket.write(`HTTP/1.1 ${code === 200 ? 404 : code} Rejected\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const unsubscribe = hub.subscribe((state) => {
        const msg: HubMessage = { type: "snapshot", state };
        ws.send(JSON.stringify(msg));
      });
      ws.on("close", unsubscribe);
      ws.on("message", () => {
        /* read-only stream: client messages are ignored */
      });
    });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, host, r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    port,
    token,
    url: `http://${host}:${port}`,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
