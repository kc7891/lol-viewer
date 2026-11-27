import { describe, expect, it } from "vitest";
import { LANES } from "@lol-viewer/protocol";
import type { Proposal } from "./balance.ts";
import { displayWidth, DISCORD_LIMIT, formatForDiscord, truncateToWidth, type DiscordName, type DiscordRank } from "./discord.ts";
import { rankLabel } from "./rank.ts";

describe("displayWidth", () => {
  it("counts full-width, CJK and emoji as 2", () => {
    expect(displayWidth("Alice")).toBe(5);
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("ＡＢ")).toBe(4);
    expect(displayWidth("ｱｲ")).toBe(2); // half-width katakana
    expect(displayWidth("한글")).toBe(4);
    expect(displayWidth("🎮a")).toBe(3);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("")).toBe(0);
  });
  it("counts joiners and variation selectors as 0", () => {
    expect(displayWidth("a‍b️")).toBe(2);
  });
});

describe("truncateToWidth", () => {
  it("cuts with an ellipsis within the width", () => {
    expect(truncateToWidth("short", 12)).toBe("short");
    expect(truncateToWidth("abcdefghijklmnop", 12)).toBe("abcdefghijk…");
    expect(truncateToWidth("日本語のながいなまえです", 12)).toBe("日本語のな…");
    expect(displayWidth(truncateToWidth("日本語のながいなまえです", 12))).toBeLessThanOrEqual(12);
  });
});

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
function setup(n: number, nameOf: (i: number) => string = (i) => `Player${i}`) {
  const all = [...ids("b", n / 2), ...ids("r", n / 2)];
  const names: Record<string, DiscordName> = {};
  const ranks: Record<string, DiscordRank> = {};
  all.forEach((id, i) => {
    names[id] = { gameName: nameOf(i), tagLine: "JP1" };
    const pts = 1000 + i * 50;
    ranks[id] = { label: rankLabel(pts), points: pts };
  });
  const lane = (i: number) => (n === 10 ? LANES[i]! : null);
  const p: Proposal = {
    blue: ids("b", n / 2).map((puuid, i) => ({ puuid, lane: lane(i) })),
    red: ids("r", n / 2).map((puuid, i) => ({ puuid, lane: lane(i) })),
    score: 0, rankDiff: 10.4, maxMatchupDiff: null, brokenNg: 0, unknownRanks: 0,
  };
  return { p, names, ranks };
}

describe("formatForDiscord", () => {
  it("lays out two teams side by side (10 players)", () => {
    const { p, names, ranks } = setup(10, (i) => ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy"][i]!);
    expect(formatForDiscord(p, names, ranks, { title: "チーム分け案（ランク重視 1）" })).toBe(
      [
        "**チーム分け案（ランク重視 1）** ランク差 10",
        "```",
        "🟦 BLUE (avg S1)  🟥 RED (avg G3)",
        "TOP Alice S2      TOP Frank G4",
        "JG  Bob   S2      JG  Grace G3",
        "MID Carol S1      MID Heidi G3",
        "BOT Dave  S1      BOT Ivan  G2",
        "SUP Erin  G4      SUP Judy  G2",
        "```",
      ].join("\n"),
    );
  });
  it("drops ranks and tags on request, and can add the tag", () => {
    const { p, names, ranks } = setup(10);
    const plain = formatForDiscord(p, names, ranks, { title: "T", withRank: false });
    expect(plain).not.toContain("avg");
    expect(plain).not.toContain("ランク差");
    expect(plain).not.toContain("#");
    expect(formatForDiscord(p, names, ranks, { title: "T", withTag: true })).toContain("Player0#JP1");
  });
  it("shows the main lane in brackets for 6 and 8 players", () => {
    const { p, names, ranks } = setup(6);
    const out = formatForDiscord(p, names, ranks, { title: "T", mains: { b0: "middle", r1: "support" } });
    expect(out).toContain("Player0 (MID)");
    expect(out).toContain("Player4 (SUP)");
    expect(out).toContain("Player1 (-)");
    expect(out.split("\n")).toHaveLength(2 + 1 + 3 + 1);
  });
  it("aligns the red column by display width when names are full-width", () => {
    const { p, names, ranks } = setup(10, (i) => (i === 0 ? "日本語のながいなまえです" : i === 1 ? "日本" : "ab"));
    const lines = formatForDiscord(p, names, ranks, { title: "T" }).split("\n");
    expect(lines[3]).toContain("日本語のな…");
    const col = (l: string) => displayWidth(l.slice(0, l.search(/(TOP|JG|MID|BOT|SUP)\s+\S+\s+\S+$/)));
    const cols = lines.slice(3, 8).map(col);
    expect(new Set(cols).size).toBe(1);
  });
  it("stays within 2000 characters even with long names and tags", () => {
    const { p, names, ranks } = setup(10, () => "𠮷".repeat(30) + "x".repeat(30));
    for (const withRank of [true, false]) {
      expect(formatForDiscord(p, names, ranks, { title: "チーム分け案".repeat(5), withRank, withTag: true }).length).toBeLessThanOrEqual(DISCORD_LIMIT);
    }
  });
  it("shows ? for a person without a name and - without a rank", () => {
    const { p } = setup(6);
    const out = formatForDiscord(p, {}, {}, { title: "T" });
    expect(out).toContain("? (-)   -");
  });
});
