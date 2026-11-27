import { describe, expect, it } from "vitest";
import type { TeamPlayerPref } from "../settings.ts";
import { clearLane, cycleLane, hasPref, laneState } from "./lanePrefs.ts";

describe("laneState", () => {
  it("reads one lane of a preference", () => {
    const pref: TeamPlayerPref = { lock: "jungle", mains: ["middle"], ng: ["support"], rankOverride: 1200 };
    expect(laneState(pref, "jungle")).toBe("lock");
    expect(laneState(pref, "middle")).toBe("prefer");
    expect(laneState(pref, "support")).toBe("avoid");
    expect(laneState(pref, "top")).toBe("none");
    expect(laneState(undefined, "top")).toBe("none");
  });
});

describe("cycleLane", () => {
  it("goes none -> prefer -> lock -> avoid -> none", () => {
    let p = cycleLane(undefined, "middle");
    expect(p).toEqual({ mains: ["middle"] });
    p = cycleLane(p, "middle");
    expect(p).toEqual({ lock: "middle" });
    p = cycleLane(p, "middle");
    expect(p).toEqual({ ng: ["middle"] });
    p = cycleLane(p, "middle");
    expect(p).toEqual({});
  });
  it("keeps other lanes and the rank override", () => {
    const p = cycleLane({ mains: ["top"], ng: ["support"], rankOverride: 1500 }, "jungle");
    expect(p).toEqual({ mains: ["top", "jungle"], ng: ["support"], rankOverride: 1500 });
  });
  it("a third star pushes out the oldest one", () => {
    let p = cycleLane(undefined, "top");
    p = cycleLane(p, "jungle");
    p = cycleLane(p, "middle");
    expect(p.mains).toEqual(["jungle", "middle"]);
    expect(laneState(p, "top")).toBe("none");
  });
  it("only one lane is locked: locking another sets the first back to none", () => {
    let p = cycleLane(cycleLane(undefined, "top"), "top"); // lock top
    expect(p).toEqual({ lock: "top" });
    p = cycleLane(cycleLane(p, "jungle"), "jungle"); // lock jungle
    expect(p).toEqual({ lock: "jungle" });
    expect(laneState(p, "top")).toBe("none");
  });
  it("the same lane is never starred and avoided at once", () => {
    const p = cycleLane({ mains: ["top"], ng: ["top"] }, "top"); // a hand-edited, inconsistent state reads as lock-first / avoid-second
    expect(laneState(p, "top")).not.toBe("prefer");
    const q = cycleLane({ ng: ["top"] }, "jungle");
    expect(q.mains).toEqual(["jungle"]);
    expect(q.ng).toEqual(["top"]);
  });
  it("does not change its input", () => {
    const input: TeamPlayerPref = { mains: ["top"] };
    cycleLane(input, "jungle");
    expect(input).toEqual({ mains: ["top"] });
  });
});

describe("clearLane", () => {
  it("sets one lane back to none whatever it was", () => {
    expect(clearLane({ lock: "top", ng: ["support"] }, "top")).toEqual({ ng: ["support"] });
    expect(clearLane({ mains: ["top", "jungle"] }, "top")).toEqual({ mains: ["jungle"] });
    expect(clearLane({ ng: ["top"], rankOverride: 100 }, "top")).toEqual({ rankOverride: 100 });
    expect(clearLane(undefined, "top")).toEqual({});
  });
  it("hasPref is false for an empty preference", () => {
    expect(hasPref({})).toBe(false);
    expect(hasPref({ mains: [] })).toBe(false);
    expect(hasPref({ rankOverride: 0 })).toBe(true);
  });
});
