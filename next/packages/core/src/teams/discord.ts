/** The "Copy for Discord" text: a code block with the two teams side by side (Teams, M-038). */
import type { Lane } from "@lol-viewer/protocol";
import type { Proposal } from "./balance.ts";
import { rankLabel } from "./rank.ts";

const LANE_SHORT: Record<Lane, string> = { top: "TOP", jungle: "JG", middle: "MID", bottom: "BOT", support: "SUP" };
export const DISCORD_LIMIT = 2000;

/** Width of a character in a monospace font: East Asian wide / fullwidth and emoji are 2, combining marks and joiners 0. */
function charWidth(cp: number): number {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0300 && cp <= 0x036f) || cp === 0x200b) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  if (cp >= 0x1f000) return 2; // emoji and pictographs
  if (/\p{Emoji_Presentation}/u.test(String.fromCodePoint(cp))) return 2;
  return 1;
}

/** Display width of a string (full-width, CJK and emoji count 2). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Cut to a display width, ending with `…` when something was cut. */
export function truncateToWidth(s: string, max: number): string {
  if (displayWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - displayWidth(s)));

export type DiscordOptions = {
  /** First line, e.g. `チーム分け案（ランク重視 1）`. */
  title: string;
  withRank?: boolean;
  withTag?: boolean;
  /** Main lane per person; shown as `(MID)` for 6 and 8 players, which have no lane assignment. */
  mains?: Record<string, Lane | null | undefined>;
};
export type DiscordName = { gameName: string; tagLine: string };
export type DiscordRank = { label: string; points: number | null };

function build(
  p: Proposal,
  names: Record<string, DiscordName | undefined>,
  ranks: Record<string, DiscordRank | undefined>,
  o: DiscordOptions,
  withRank: boolean,
  nameWidth: number,
): string {
  const laned = [...p.blue, ...p.red].every((s) => s.lane !== null);
  const nameOf = (id: string) => {
    const n = names[id];
    const raw = n ? (o.withTag && n.tagLine ? `${n.gameName}#${n.tagLine}` : n.gameName) : "?";
    return truncateToWidth(raw, nameWidth);
  };
  const side = (slots: Proposal["blue"]): string[] => {
    const names2 = slots.map((s) => nameOf(s.puuid));
    const w = Math.max(...names2.map(displayWidth), 1);
    return slots.map((s, i) => {
      const lead = laned ? pad(LANE_SHORT[s.lane!], 4) : "";
      const main = laned ? "" : ` ${pad(`(${LANE_SHORT[o.mains?.[s.puuid] as Lane] ?? "-"})`, 5)}`;
      const rank = withRank ? ` ${ranks[s.puuid]?.label ?? "-"}` : "";
      return `${lead}${pad(names2[i]!, w)}${main}${rank}`.trimEnd();
    });
  };
  const avg = (slots: Proposal["blue"]) => {
    const known = slots.map((s) => ranks[s.puuid]?.points).filter((x): x is number => typeof x === "number");
    return known.length ? ` (avg ${rankLabel(known.reduce((a, b) => a + b, 0) / known.length)})` : "";
  };
  const blue = side(p.blue);
  const red = side(p.red);
  const bh = `🟦 BLUE${withRank ? avg(p.blue) : ""}`;
  const rh = `🟥 RED${withRank ? avg(p.red) : ""}`;
  const colW = Math.max(displayWidth(bh), ...blue.map(displayWidth)) + 2;
  const lines = [pad(bh, colW) + rh, ...blue.map((l, i) => pad(l, colW) + (red[i] ?? "")).map((l) => l.trimEnd())];
  const diff = withRank ? ` ランク差 ${Math.round(p.rankDiff)}` : "";
  return `**${o.title}**${diff}\n\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

/**
 * Two-column code block for Discord. Names are cut at 12 columns; over 2000 characters the ranks are
 * dropped, and then the names are cut at 8.
 */
export function formatForDiscord(
  p: Proposal,
  names: Record<string, DiscordName | undefined>,
  ranks: Record<string, DiscordRank | undefined>,
  o: DiscordOptions,
): string {
  const withRank = o.withRank ?? true;
  let text = build(p, names, ranks, o, withRank, 12);
  if (text.length > DISCORD_LIMIT && withRank) text = build(p, names, ranks, o, false, 12);
  if (text.length > DISCORD_LIMIT) text = build(p, names, ranks, o, false, 8);
  return text;
}
