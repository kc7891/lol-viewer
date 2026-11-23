import { describe, expect, it } from "vitest";
import { createLiveGate } from "./live-core.ts";

function setup() {
  const calls = { start: 0, stop: 0, clear: 0 };
  const gate = createLiveGate({
    start: () => {
      calls.start++;
      return { stop: () => void calls.stop++ };
    },
    clear: () => void calls.clear++,
  });
  return { gate, calls };
}

describe("live gate (flag off => no polling)", () => {
  it("never starts without the flag, whatever the phase", () => {
    const { gate, calls } = setup();
    gate.setPhase("InProgress");
    expect(calls.start).toBe(0);
    expect(gate.polling).toBe(false);
    expect(gate.enabled).toBe(false);
  });

  it("never starts outside InProgress", () => {
    const { gate, calls } = setup();
    gate.setEnabled(true);
    expect(calls.start).toBe(0);
    gate.setPhase("ChampSelect");
    expect(calls.start).toBe(0);
  });

  it("starts once when enabled during InProgress", () => {
    const { gate, calls } = setup();
    gate.setEnabled(true);
    gate.setPhase("InProgress");
    gate.setPhase("InProgress");
    gate.setEnabled(true);
    expect(calls.start).toBe(1);
    expect(gate.polling).toBe(true);
  });

  it("starts when the flag is turned on in a running game", () => {
    const { gate, calls } = setup();
    gate.setPhase("InProgress");
    gate.setEnabled(true);
    expect(calls.start).toBe(1);
  });

  it("stops when the game ends, without clearing", () => {
    const { gate, calls } = setup();
    gate.setEnabled(true);
    gate.setPhase("InProgress");
    gate.setPhase("EndOfGame");
    expect(calls.stop).toBe(1);
    expect(calls.clear).toBe(0);
    expect(gate.polling).toBe(false);
  });

  it("turning the flag off stops and clears once", () => {
    const { gate, calls } = setup();
    gate.setEnabled(true);
    gate.setPhase("InProgress");
    gate.setEnabled(false);
    gate.setEnabled(false);
    expect(calls).toEqual({ start: 1, stop: 1, clear: 1 });
  });

  it("dispose stops polling", () => {
    const { gate, calls } = setup();
    gate.setEnabled(true);
    gate.setPhase("InProgress");
    gate.dispose();
    expect(calls.stop).toBe(1);
    expect(gate.polling).toBe(false);
  });
});
