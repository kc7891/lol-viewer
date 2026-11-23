/**
 * Release version rules for the new app (docs/spec/new-app-design.md §6.1). Pure functions; cli.ts adds git.
 * Bump rule: BREAKING CHANGE / "!:" -> major, "feat:" -> minor, else patch.
 */
export type Bump = "major" | "minor" | "patch";

export const TAG_PREFIX = "app-v";
export type Semver = [major: number, minor: number, patch: number];

export function parseSemver(s: string): Semver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Highest app-vX.Y.Z tag (by version, not by date); null when there is none. Other tags are ignored. */
export function latestAppTag(tags: string[]): string | null {
  let best: { tag: string; v: Semver } | null = null;
  for (const tag of tags) {
    if (!tag.startsWith(TAG_PREFIX)) continue;
    const v = parseSemver(tag.slice(TAG_PREFIX.length));
    if (v && (!best || compareSemver(v, best.v) > 0)) best = { tag, v };
  }
  return best?.tag ?? null;
}

/** `messages` are full commit messages (subject and body). */
export function bumpFromMessages(messages: string[]): Bump {
  const all = messages.join("\n");
  if (/BREAKING CHANGE|!:/i.test(all)) return "major";
  if (/^feat(\(.*\))?:/m.test(all)) return "minor";
  return "patch";
}

export function bumpVersion(base: Semver, bump: Bump): string {
  const [major, minor, patch] = base;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export type Plan = { previousTag: string | null; bump: Bump; version: string; tag: string };

export function planRelease(input: { tags: string[]; messages: string[]; manualBump?: Bump | null }): Plan {
  const previousTag = latestAppTag(input.tags);
  const base = parseSemver(previousTag ? previousTag.slice(TAG_PREFIX.length) : "0.0.0")!;
  const bump = input.manualBump ?? bumpFromMessages(input.messages);
  const version = bumpVersion(base, bump);
  return { previousTag, bump, version, tag: TAG_PREFIX + version };
}

export type NoteCommit = { subject: string; shortSha: string };

export function releaseNotes(opts: { commits: NoteCommit[]; previousTag: string | null; tag: string; repo: string }): string {
  const lines = ["## What's Changed", ""];
  if (opts.commits.length === 0) lines.push("* (no changes under next/)");
  for (const c of opts.commits) lines.push(`* ${c.subject} (${c.shortSha})`);
  if (opts.previousTag) lines.push("", `Full Changelog: https://github.com/${opts.repo}/compare/${opts.previousTag}...${opts.tag}`);
  return lines.join("\n") + "\n";
}
