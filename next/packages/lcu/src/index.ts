/**
 * @lol-viewer/lcu — read-only League Client (LCU) connector.
 *
 * Safety contract (🔴 zone, human review required):
 *  - The ONLY HTTP verb this module can issue is GET, and only to READ_ONLY_PATHS.
 *    There is deliberately no generic `request()`; adding a write path means
 *    changing this file, which CODEOWNERS routes to a human.
 *  - TLS verification is relaxed only for the loopback connection to the LCU
 *    (self-signed cert) and only on the sockets created here, never process-wide.
 *  - The auth token never leaves this module (not in events, not in logs).
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import type { ConnectionStatus } from "@lol-viewer/protocol";

const execFileAsync = promisify(execFile);

export const READ_ONLY_PATHS = [
  "/lol-gameflow/v1/gameflow-phase",
  "/lol-gameflow/v1/session",
  "/lol-champ-select/v1/session",
  "/lol-summoner/v1/current-summoner",
] as const;
export type ReadOnlyPath = (typeof READ_ONLY_PATHS)[number];

export type LcuCredentials = {
  port: number;
  password: string;
  protocol: "https" | "http";
};

/** Parse `<name>:<pid>:<port>:<password>:<protocol>` (the LCU lockfile format). */
export function parseLockfile(text: string): LcuCredentials {
  const parts = text.trim().split(":");
  if (parts.length < 5) throw new Error("malformed lockfile");
  const port = Number(parts[2]);
  const password = parts[3] ?? "";
  const protocol = parts[4] === "http" ? "http" : "https";
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !password) throw new Error("malformed lockfile");
  return { port, password, protocol };
}

export type ClientCommandLine = { port: number; password: string; installDir?: string };

/** `--install-directory=...` with or without quotes (`"--install-directory=C:\\A B"`, `--install-directory="C:\\A B"`, bare). */
export function parseInstallDirectory(cmdline: string): string | undefined {
  const m = /"--install-directory=([^"]*)"|'--install-directory=([^']*)'|--install-directory=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(cmdline);
  const dir = m?.slice(1).find((x) => x !== undefined);
  return dir || undefined;
}

/** Extract `--app-port`, `--remoting-auth-token` and `--install-directory` from a LeagueClientUx command line. */
export function parseClientCommandLine(cmdline: string): ClientCommandLine | null {
  const portM = /--app-port=["']?(\d+)/.exec(cmdline);
  const tokenM = /--remoting-auth-token=["']?([\w-]+)/.exec(cmdline);
  if (!portM || !tokenM) return null;
  const port = Number(portM[1]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const installDir = parseInstallDirectory(cmdline);
  return { port, password: tokenM[1]!, ...(installDir ? { installDir } : {}) };
}

/** Windows only: the command line of the running League Client UX process, or null. Never throws. */
export async function readClientCommandLine(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
      ],
      { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const text = String(stdout).trim();
    return text || null;
  } catch {
    return null;
  }
}

export const DEFAULT_LOCKFILE_PATHS = [
  "C:\\Riot Games\\League of Legends\\lockfile",
  "D:\\Riot Games\\League of Legends\\lockfile",
];

async function readLockfiles(paths: readonly string[]): Promise<LcuCredentials | null> {
  for (const p of paths) {
    try {
      return parseLockfile(await readFile(p, "utf8"));
    } catch {
      // try next
    }
  }
  return null;
}

export type FindCredentialsDeps = {
  env?: Record<string, string | undefined>;
  /** Defaults to readClientCommandLine (PowerShell on Windows). */
  readCommandLine?: () => Promise<string | null>;
  defaultLockfiles?: readonly string[];
};

/**
 * Discover credentials.
 *  - `paths` given: those lockfiles only.
 *  - else env LOL_LCU_LOCKFILE: that lockfile only.
 *  - else: client process command line (https) -> <install-directory>/lockfile -> default lockfiles.
 */
export async function findCredentials(paths?: string[], deps: FindCredentialsDeps = {}): Promise<LcuCredentials | null> {
  if (paths) return readLockfiles(paths);
  const env = deps.env ?? process.env;
  if (env.LOL_LCU_LOCKFILE) return readLockfiles([env.LOL_LCU_LOCKFILE]);

  let installDir: string | undefined;
  try {
    const line = await (deps.readCommandLine ?? readClientCommandLine)();
    const parsed = line ? parseClientCommandLine(line) : null;
    if (parsed) return { port: parsed.port, password: parsed.password, protocol: "https" };
    installDir = line ? parseInstallDirectory(line) : undefined;
  } catch {
    // treat as "no process"
  }
  if (installDir) {
    const fromInstall = await readLockfiles([join(installDir, "lockfile")]);
    if (fromInstall) return fromInstall;
  }
  return readLockfiles(deps.defaultLockfiles ?? DEFAULT_LOCKFILE_PATHS);
}

export type RawLcuEvent = { uri: string; eventType: "Create" | "Update" | "Delete"; data: unknown };

export type LcuClientOptions = {
  onEvent: (e: RawLcuEvent) => void;
  onStatus: (s: ConnectionStatus) => void;
};

const WAMP_SUBSCRIBE = 5;
const WAMP_EVENT = 8;

export function topicFor(path: ReadOnlyPath): string {
  return `OnJsonApiEvent${path.replaceAll("/", "_")}`;
}

export class LcuClient {
  #creds: LcuCredentials;
  #opts: LcuClientOptions;
  #ws: WebSocket | null = null;
  #closed = false;
  #connected = false;

  constructor(creds: LcuCredentials, opts: LcuClientOptions) {
    this.#creds = creds;
    this.#opts = opts;
  }

  get #auth(): string {
    return "Basic " + Buffer.from(`riot:${this.#creds.password}`).toString("base64");
  }

  /** GET one of the allow-listed read-only paths. Resolves null on 404 / error. */
  get(path: ReadOnlyPath): Promise<unknown | null> {
    if (!(READ_ONLY_PATHS as readonly string[]).includes(path)) {
      return Promise.reject(new Error(`path not allow-listed: ${path}`));
    }
    const { port, protocol } = this.#creds;
    const req = protocol === "https" ? httpsRequest : httpRequest;
    return new Promise((resolve) => {
      const r = req(
        {
          host: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers: { Authorization: this.#auth, Accept: "application/json" },
          rejectUnauthorized: false, // loopback LCU self-signed cert; scoped to this request
          timeout: 2000,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            if (res.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        },
      );
      r.on("error", () => resolve(null));
      r.on("timeout", () => r.destroy());
      r.end();
    });
  }

  /** Connect the event socket, then emit the current value of every path as a synthetic Update. */
  async connect(): Promise<void> {
    this.#opts.onStatus("connecting");
    const { port, protocol } = this.#creds;
    const scheme = protocol === "https" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://127.0.0.1:${port}/`, "wamp", {
      headers: { Authorization: this.#auth },
      rejectUnauthorized: false,
    });
    this.#ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    ws.on("message", (buf) => {
      if (this.#closed) return;
      let msg: unknown;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!Array.isArray(msg) || msg[0] !== WAMP_EVENT) return;
      const payload = msg[2] as RawLcuEvent | undefined;
      if (payload && typeof payload.uri === "string") this.#opts.onEvent(payload);
    });
    ws.on("close", () => {
      this.#ws = null;
      this.#connected = false;
      if (!this.#closed) this.#opts.onStatus("disconnected");
    });

    if (this.#closed) return;
    for (const p of READ_ONLY_PATHS) ws.send(JSON.stringify([WAMP_SUBSCRIBE, topicFor(p)]));
    this.#connected = true;
    this.#opts.onStatus("connected");
    await this.resync();
  }

  get connected(): boolean {
    return this.#connected && !this.#closed;
  }

  /** GET every path and emit it as a synthetic Update (nothing is emitted after close()). */
  async resync(): Promise<void> {
    for (const p of READ_ONLY_PATHS) {
      const data = await this.get(p);
      if (this.#closed) return;
      if (data != null) this.#opts.onEvent({ uri: p, eventType: "Update", data });
    }
  }

  close(): void {
    this.#closed = true;
    this.#connected = false;
    const ws = this.#ws;
    this.#ws = null;
    if (!ws) return;
    ws.removeAllListeners("message");
    ws.on("error", () => {}); // a late error on a socket we abandoned must not crash
    if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    else ws.close();
  }
}

export type LcuConnectorOptions = LcuClientOptions & {
  findCredentials?: () => Promise<LcuCredentials | null>;
  /** First retry delay; doubles on every failure. Default 2000. */
  retryMs?: number;
  /** Backoff ceiling. Default 60000. */
  maxRetryMs?: number;
};

export type LcuConnector = {
  stop: () => void;
  /** Current value of every read-only path (GET), e.g. to seed a recording started mid-session. */
  snapshot: () => Promise<RawLcuEvent[]>;
  /** Drop the current connection, reset the backoff and try again right now (reports "connecting"). */
  reconnect: () => void;
  /** While connected: GET every path and emit it through onEvent again. */
  resync: () => Promise<void>;
};

/** Keeps an LcuClient connected: discover credentials, connect, back off (2s, 4s ... 60s) on failure. */
export function startLcuConnector(opts: LcuConnectorOptions): LcuConnector {
  const find = opts.findCredentials ?? (() => findCredentials());
  const base = opts.retryMs ?? 2000;
  const max = opts.maxRetryMs ?? 60000;
  let delay = base;
  let stopped = false;
  let client: LcuClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by reconnect()/stop(); an attempt that finds a newer epoch abandons itself. */
  let epoch = 0;

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, delay);
    delay = Math.min(delay * 2, max);
  };

  const attempt = async () => {
    const mine = epoch;
    const stale = () => stopped || mine !== epoch;
    let creds: LcuCredentials | null = null;
    try {
      creds = await find();
    } catch {
      creds = null;
    }
    if (stale()) return;
    if (!creds) {
      opts.onStatus("disconnected");
      return schedule();
    }
    const c: LcuClient = new LcuClient(creds, {
      // Events from a client that is no longer the current one are dropped.
      onEvent: (e) => {
        if (client === c) opts.onEvent(e);
      },
      onStatus: (s) => {
        if (client !== c) return;
        opts.onStatus(s);
        if (s === "connected") delay = base;
        if (s === "disconnected") {
          c.close();
          client = null;
          schedule();
        }
      },
    });
    client = c;
    try {
      await c.connect();
    } catch {
      if (client === c) {
        c.close();
        client = null;
        if (!stale()) {
          opts.onStatus("disconnected");
          schedule();
        }
      }
    }
  };

  void attempt();
  return {
    stop: () => {
      stopped = true;
      epoch++;
      if (timer) clearTimeout(timer);
      timer = null;
      const c = client;
      client = null;
      c?.close();
    },
    reconnect: () => {
      if (stopped) return;
      epoch++;
      if (timer) clearTimeout(timer);
      timer = null;
      const c = client;
      client = null;
      c?.close();
      delay = base;
      opts.onStatus("connecting");
      void attempt();
    },
    resync: async () => {
      const c = client;
      if (c?.connected) await c.resync();
    },
    snapshot: async () => {
      const c = client;
      if (!c) return [];
      const out: RawLcuEvent[] = [];
      for (const p of READ_ONLY_PATHS) {
        const data = await c.get(p);
        if (data != null) out.push({ uri: p, eventType: "Update", data });
      }
      return out;
    },
  };
}

// ── Live Client Data API (official, in-game, 127.0.0.1:2999, no auth) ──

export const LIVE_CLIENT_PATHS = ["/liveclientdata/playerlist"] as const;
export type LiveClientPath = (typeof LIVE_CLIENT_PATHS)[number];

export type LiveClientPollerOptions = {
  onData: (e: RawLcuEvent) => void;
  intervalMs?: number;
  /** Default https://127.0.0.1:2999 (env LOL_LIVE_CLIENT_URL overrides, for tests). */
  baseUrl?: string;
};

/**
 * Polls the in-game Live Client Data API (GET only, loopback only) and emits
 * an Update whenever a response changes. Silent while no game is running.
 */
export function startLiveClientPoller(opts: LiveClientPollerOptions): { stop: () => void } {
  const base = new URL(opts.baseUrl ?? process.env.LOL_LIVE_CLIENT_URL ?? "https://127.0.0.1:2999");
  if (base.hostname !== "127.0.0.1") throw new Error("live client API must be on 127.0.0.1");
  const req = base.protocol === "https:" ? httpsRequest : httpRequest;
  const last = new Map<string, string>();
  let stopped = false;

  const fetchOnce = (path: LiveClientPath) =>
    new Promise<string | null>((resolve) => {
      const r = req(
        { host: "127.0.0.1", port: base.port, path, method: "GET", rejectUnauthorized: false, timeout: 2000 },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve(res.statusCode === 200 ? body : null));
        },
      );
      r.on("error", () => resolve(null));
      r.on("timeout", () => r.destroy());
      r.end();
    });

  const tick = async () => {
    for (const path of LIVE_CLIENT_PATHS) {
      const body = await fetchOnce(path);
      if (stopped || body == null || last.get(path) === body) continue;
      last.set(path, body);
      try {
        opts.onData({ uri: path, eventType: "Update", data: JSON.parse(body) });
      } catch {
        /* not JSON: ignore */
      }
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 3000);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
