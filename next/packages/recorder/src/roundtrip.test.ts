/**
 * Record a session from the fake LCU exactly like the app does, then check the
 * recording (1) replays to the same match states and (2) leaks no identities.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseScenario, reduceAll, scenarioEvents, type ScenarioLine } from "@lol-viewer/core";
import { startFakeLcu } from "@lol-viewer/fake-lcu";
import { findCredentials, startLcuConnector, startLiveClientPoller } from "@lol-viewer/lcu";
import { findUnmaskedPii } from "./mask.ts";
import { SessionRecorder } from "./recorder.ts";

const source = parseScenario(readFileSync(new URL("../../../scenarios/ranked-two-matches.jsonl", import.meta.url), "utf8"));

/** Same scenario with real-looking identities added, plus an in-game player list. */
function withIdentities(lines: ScenarioLine[]): ScenarioLine[] {
  const out = lines.map((l) => {
    if (l.uri !== "/lol-champ-select/v1/session" || !l.data) return l;
    const d = structuredClone(l.data) as { myTeam: Record<string, unknown>[]; theirTeam: Record<string, unknown>[] };
    d.myTeam.forEach((p, i) => Object.assign(p, { summonerId: 5000 + i, puuid: `puuid-ally-${i}`, gameName: `Ally${i}`, tagLine: "JP1" }));
    d.theirTeam.forEach((p, i) => Object.assign(p, { puuid: `puuid-enemy-${i}` }));
    return { ...l, data: d };
  });
  const t = lines.find((l) => l.data === "InProgress")!.t;
  out.push({
    t: t + 1,
    uri: "/liveclientdata/playerlist",
    eventType: "Update",
    data: [{ championName: "Ahri", riotId: "Ally2#JP1", riotIdGameName: "Ally2", riotIdTagLine: "JP1", summonerName: "Ally2", team: "ORDER", level: 6 }],
  });
  return out.sort((a, b) => a.t - b.t);
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe("record -> replay round trip", () => {
  it("reproduces the same match states and masks every identity", async () => {
    const fake = await startFakeLcu({ lines: withIdentities(source), autoplay: false });
    cleanups.push(() => fake.close());

    const recorded: string[] = [];
    const rec = new SessionRecorder((l) => recorded.push(l), { app: "test", version: "0" });
    let connected = false;
    const conn = startLcuConnector({
      findCredentials: () => findCredentials([fake.lockfilePath]),
      onEvent: (e) => rec.record(e),
      onStatus: (s) => (connected = s === "connected"),
    });
    cleanups.push(() => conn.stop());
    const live = startLiveClientPoller({ onData: (e) => rec.record(e), intervalMs: 50, baseUrl: `http://127.0.0.1:${fake.port}` });
    cleanups.push(() => live.stop());

    await expect.poll(() => connected).toBe(true);
    // Feed the scenario step by step so every event is delivered (and the poller sees the player list).
    for (const l of withIdentities(source)) {
      fake.advanceTo(l.t);
      await new Promise((r) => setTimeout(r, l.uri.startsWith("/liveclientdata") ? 150 : 5));
    }
    await expect.poll(() => recorded.some((l) => l.includes("/liveclientdata/playerlist"))).toBe(true);
    await new Promise((r) => setTimeout(r, 100));

    expect(recorded[0]).toMatch(/^\/\/ recorded by test 0 at .*personal data masked/);
    const replayed = parseScenario(recorded.join("\n"));

    // 1) Same match state at the end as the source scenario.
    const want = reduceAll(scenarioEvents(source));
    const got = reduceAll(scenarioEvents(replayed));
    expect(got.matchSeq).toBe(want.matchSeq);
    expect(got.self).toEqual(want.self);
    expect(got.matchups).toEqual(want.matchups);

    // 2) No identity survived.
    const text = recorded.join("\n");
    for (const s of ["puuid-ally", "puuid-enemy", "Ally0", "Ally2#JP1", "JP1"]) expect(text).not.toContain(s);
    expect(replayed.flatMap((l) => findUnmaskedPii(l.data))).toEqual([]);
    expect(fake.rejectedWrites).toEqual([]);
  });
});
