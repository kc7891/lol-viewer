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
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import WebSocket from "ws";
import type { ConnectionStatus } from "@lol-viewer/protocol";

export const READ_ONLY_PATHS = [
  "/lol-gameflow/v1/gameflow-phase",
  "/lol-gameflow/v1/session",
  "/lol-champ-select/v1/session",
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

export const DEFAULT_LOCKFILE_PATHS = [
  "C:\\Riot Games\\League of Legends\\lockfile",
  "D:\\Riot Games\\League of Legends\\lockfile",
];

export async function findCredentials(
  paths: string[] = process.env.LOL_LCU_LOCKFILE ? [process.env.LOL_LCU_LOCKFILE] : DEFAULT_LOCKFILE_PATHS,
): Promise<LcuCredentials | null> {
  for (const p of paths) {
    try {
      return parseLockfile(await readFile(p, "utf8"));
    } catch {
      // try next
    }
  }
  return null;
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
      if (!this.#closed) this.#opts.onStatus("disconnected");
    });

    for (const p of READ_ONLY_PATHS) ws.send(JSON.stringify([WAMP_SUBSCRIBE, topicFor(p)]));
    this.#opts.onStatus("connected");

    for (const p of READ_ONLY_PATHS) {
      const data = await this.get(p);
      if (data != null) this.#opts.onEvent({ uri: p, eventType: "Update", data });
    }
  }

  close(): void {
    this.#closed = true;
    this.#ws?.close();
  }
}

export type LcuConnectorOptions = LcuClientOptions & {
  findCredentials?: () => Promise<LcuCredentials | null>;
  retryMs?: number;
  maxRetryMs?: number;
};

/** Keeps an LcuClient connected: discover credentials, connect, back off on failure. */
export function startLcuConnector(opts: LcuConnectorOptions): { stop: () => void } {
  const find = opts.findCredentials ?? (() => findCredentials());
  const base = opts.retryMs ?? 2000;
  const max = opts.maxRetryMs ?? 30000;
  let delay = base;
  let stopped = false;
  let client: LcuClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(attempt, delay);
    delay = Math.min(delay * 2, max);
  };

  const attempt = async () => {
    const creds = await find();
    if (stopped) return;
    if (!creds) {
      opts.onStatus("disconnected");
      return schedule();
    }
    client = new LcuClient(creds, {
      onEvent: opts.onEvent,
      onStatus: (s) => {
        opts.onStatus(s);
        if (s === "connected") delay = base;
        if (s === "disconnected") schedule();
      },
    });
    try {
      await client.connect();
    } catch {
      opts.onStatus("disconnected");
      schedule();
    }
  };

  void attempt();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      client?.close();
    },
  };
}
