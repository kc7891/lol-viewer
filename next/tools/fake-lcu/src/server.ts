/**
 * Fake LCU: replays a scenario (JSONL of LCU JSON-API events) over the same
 * wire protocol the real League Client uses (Basic auth, GET endpoints, WAMP
 * events over WebSocket), so the real connector can be exercised on Linux CI.
 *
 * Differences from the real client (documented on purpose):
 *  - plain http/ws instead of https/wss (lockfile protocol field says "http")
 *  - only the endpoints in the scenario exist
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

export type ScenarioLine = { t: number; uri: string; eventType: "Create" | "Update" | "Delete"; data: unknown };

export type FakeLcuOptions = {
  lines: ScenarioLine[];
  /** Playback speed multiplier (2 = twice as fast). */
  speed?: number;
  port?: number;
  password?: string;
  /** Start playback only when POST /__fake/play is called (for step-controlled tests). */
  autoplay?: boolean;
  log?: (msg: string) => void;
};

export type FakeLcu = {
  port: number;
  password: string;
  lockfilePath: string;
  /** Requests that tried to mutate the client (must stay empty). */
  rejectedWrites: string[];
  play: () => void;
  /** Deterministic stepping: immediately emit every not-yet-emitted line with t <= ms. */
  advanceTo: (ms: number) => void;
  done: Promise<void>;
  close: () => Promise<void>;
};

const WAMP_SUBSCRIBE = 5;
const WAMP_EVENT = 8;
const CURRENT_SUMMONER_PATH = "/lol-summoner/v1/current-summoner";
/** Served on GET when the scenario has no line for the path (a scenario line wins). */
const SYNTHETIC_SUMMONER = { summonerId: 1, puuid: "player-self" };
const topicFor = (uri: string) => `OnJsonApiEvent${uri.replaceAll("/", "_")}`;

export async function startFakeLcu(opts: FakeLcuOptions): Promise<FakeLcu> {
  const password = opts.password ?? "fake-" + Math.random().toString(36).slice(2);
  const speed = opts.speed ?? 1;
  const log = opts.log ?? (() => {});
  const auth = "Basic " + Buffer.from(`riot:${password}`).toString("base64");
  const current = new Map<string, unknown>();
  const rejectedWrites: string[] = [];
  const subs = new Map<WebSocket, Set<string>>();

  const server: Server = createServer((req, res) => {
    if (req.url === "/__fake/play" && req.method === "POST") {
      play();
      res.writeHead(204).end();
      return;
    }
    const isLiveClient = (req.url ?? "").startsWith("/liveclientdata/");
    if (!isLiveClient && req.headers.authorization !== auth) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== "GET") {
      rejectedWrites.push(`${req.method} ${req.url}`);
      log(`REJECTED write ${req.method} ${req.url}`);
      res.writeHead(405).end();
      return;
    }
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!current.has(path) && path === CURRENT_SUMMONER_PATH) {
      // Synthetic: scenarios recorded before this endpoint existed have no line for it.
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(SYNTHETIC_SUMMONER));
      return;
    }
    if (!current.has(path)) {
      res.writeHead(404, { "Content-Type": "application/json" }).end('{"httpStatus":404}');
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(current.get(path)));
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.headers.authorization !== auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      subs.set(ws, new Set());
      ws.on("message", (buf) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (Array.isArray(msg) && msg[0] === WAMP_SUBSCRIBE && typeof msg[1] === "string") subs.get(ws)?.add(msg[1]);
        } catch {
          /* ignore */
        }
      });
      ws.on("close", () => subs.delete(ws));
    });
  });

  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  const dir = await mkdtemp(join(tmpdir(), "fake-lcu-"));
  const lockfilePath = join(dir, "lockfile");
  await writeFile(lockfilePath, `LeagueClient:${process.pid}:${port}:${password}:http`);

  const emit = (line: ScenarioLine) => {
    if (line.eventType === "Delete") current.delete(line.uri);
    else current.set(line.uri, line.data);
    const topic = topicFor(line.uri);
    const frame = JSON.stringify([WAMP_EVENT, topic, { uri: line.uri, eventType: line.eventType, data: line.data }]);
    for (const [ws, topics] of subs) if (topics.has(topic) || topics.has("OnJsonApiEvent")) ws.send(frame);
    log(`t=${line.t} ${line.eventType} ${line.uri}`);
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const timers: ReturnType<typeof setTimeout>[] = [];
  let next = 0; // index of the next line to emit
  const emitNext = () => {
    const line = opts.lines[next++];
    if (line) emit(line);
    if (next >= opts.lines.length) resolveDone();
  };
  let playing = false;
  function play() {
    if (playing) return;
    playing = true;
    if (opts.lines.length === 0) return resolveDone();
    for (let i = next; i < opts.lines.length; i++) {
      timers.push(setTimeout(() => next <= i && emitNext(), opts.lines[i]!.t / speed));
    }
  }
  function advanceTo(ms: number) {
    while (next < opts.lines.length && opts.lines[next]!.t <= ms) emitNext();
  }
  if (opts.autoplay !== false) play();

  return {
    port,
    password,
    lockfilePath,
    rejectedWrites,
    play,
    advanceTo,
    done,
    close: async () => {
      timers.forEach(clearTimeout);
      for (const ws of subs.keys()) ws.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
