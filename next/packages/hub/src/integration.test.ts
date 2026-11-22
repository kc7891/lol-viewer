/**
 * Full data path on Linux, no League Client needed:
 * scenario -> fake LCU (HTTP + WAMP) -> real read-only connector -> core -> Hub.
 */
import { readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { parseScenario, toLcuEvent } from "@lol-viewer/core";
import { findCredentials, startLcuConnector } from "@lol-viewer/lcu";
import { startFakeLcu, type FakeLcu } from "@lol-viewer/fake-lcu";
import { HubMessageSchema, type MatchState } from "@lol-viewer/protocol";
import { Hub, startHubServer, type HubServer } from "./index.ts";

const lines = parseScenario(
  readFileSync(new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url), "utf8"),
);

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function waitFor(hub: Hub, pred: (s: MatchState) => boolean, ms = 5000): Promise<MatchState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout; last state: " + JSON.stringify(hub.state))), ms);
    const off = hub.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        queueMicrotask(() => off());
        resolve(s);
      }
    });
  });
}

describe("fake LCU -> connector -> hub", () => {
  it("replays two matches and never attempts a write", async () => {
    const fake: FakeLcu = await startFakeLcu({ lines, speed: 20, autoplay: false });
    cleanups.push(() => fake.close());
    const hub = new Hub();
    const conn = startLcuConnector({
      findCredentials: () => findCredentials([fake.lockfilePath]),
      onEvent: (raw) => {
        const e = toLcuEvent(raw);
        if (e) hub.dispatch(e);
      },
      onStatus: (status) => hub.dispatch({ type: "connection", status }),
    });
    cleanups.push(() => conn.stop());

    await waitFor(hub, (s) => s.connection === "connected");
    fake.play();

    const m1 = await waitFor(hub, (s) => s.matchSeq === 1 && s.matchups.every((r) => r.enemyChampionId != null));
    expect(m1.self).toEqual({ championId: 103, lane: "middle" });

    const m2 = await waitFor(hub, (s) => s.matchSeq === 2 && s.self != null);
    expect(m2.self).toEqual({ championId: 266, lane: "top" });
    expect(fake.rejectedWrites).toEqual([]);
  });

  it("reports disconnected when no lockfile exists", async () => {
    const hub = new Hub();
    const conn = startLcuConnector({
      findCredentials: async () => null,
      onEvent: () => {},
      onStatus: (status) => hub.dispatch({ type: "connection", status }),
      retryMs: 50,
    });
    cleanups.push(() => conn.stop());
    await waitFor(hub, (s) => s.connection === "disconnected");
  });
});

describe("hub server security", () => {
  async function server(): Promise<{ hub: Hub; srv: HubServer }> {
    const hub = new Hub();
    const srv = await startHubServer(hub, { token: "t0ken", allowedOrigins: ["http://allowed.test"] });
    cleanups.push(() => srv.close());
    return { hub, srv };
  }

  it("serves state with the right token", async () => {
    const { srv } = await server();
    const res = await fetch(`${srv.url}/api/state?token=t0ken`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { protocolVersion: number }).protocolVersion).toBe(1);
  });

  it.each([
    ["missing token", "", {}, 401],
    ["wrong token", "?token=nope", {}, 401],
    ["foreign origin", "?token=t0ken", { Origin: "https://evil.example" }, 403],
  ])("rejects %s", async (_n, qs, headers, code) => {
    const { srv } = await server();
    const res = await fetch(`${srv.url}/api/state${qs}`, { headers });
    expect(res.status).toBe(code);
  });

  it("rejects a rebinding Host header", async () => {
    const { srv } = await server();
    const code = await new Promise<number>((resolve) => {
      httpGet({ host: "127.0.0.1", port: srv.port, path: "/api/state?token=t0ken", headers: { Host: `evil.example:${srv.port}` } }, (r) => resolve(r.statusCode ?? 0))
        .on("error", () => resolve(-1));
    });
    expect(code).toBe(421);
  });

  it("streams snapshots over WebSocket", async () => {
    const { hub, srv } = await server();
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/stream?token=t0ken`);
    cleanups.push(() => ws.terminate());
    const msgs: unknown[] = [];
    await new Promise<void>((resolve) => {
      ws.on("message", (b) => {
        msgs.push(HubMessageSchema.parse(JSON.parse(b.toString())));
        if (msgs.length === 2) resolve();
      });
      ws.on("open", () => hub.dispatch({ type: "connection", status: "connected" }));
    });
    expect(msgs).toHaveLength(2);
  });
});
