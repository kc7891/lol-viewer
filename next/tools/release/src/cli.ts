/**
 * Used by .github/workflows/next-release.yml (run from the repo checkout with full history):
 *   tsx tools/release/src/cli.ts plan  [--bump patch|minor|major]   -> key=value lines on stdout (append to $GITHUB_OUTPUT)
 *   tsx tools/release/src/cli.ts notes --tag app-vX.Y.Z --repo owner/name [--out file]
 * Only commits that touched next/ count, from the latest app-v* tag up to HEAD.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { planRelease, releaseNotes, latestAppTag, type Bump } from "./version.ts";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const tags = () => git("tag", "--list", "app-v*").split("\n").filter(Boolean);
const range = (prev: string | null) => (prev ? [`${prev}..HEAD`] : []);

function messages(prev: string | null): string[] {
  return git("log", "--format=%B%x00", ...range(prev), "--", ":(top)next/").split("\0").map((m) => m.trim()).filter(Boolean);
}

const cmd = process.argv[2];
if (cmd === "plan") {
  const manual = arg("bump");
  if (manual && !["major", "minor", "patch"].includes(manual)) throw new Error(`bad --bump ${manual}`);
  const prev = latestAppTag(tags());
  const plan = planRelease({ tags: tags(), messages: messages(prev), manualBump: (manual as Bump | undefined) ?? null });
  const exists = tags().includes(plan.tag);
  console.log(`version=${plan.version}\ntag=${plan.tag}\nbump=${plan.bump}\nprevious_tag=${plan.previousTag ?? ""}\ntag_exists=${exists}`);
} else if (cmd === "notes") {
  const tag = arg("tag");
  const repo = arg("repo");
  if (!tag || !repo) throw new Error("notes needs --tag and --repo");
  const prev = latestAppTag(tags().filter((t) => t !== tag));
  const commits = git("log", "--format=%s%x09%h", ...range(prev), "--", ":(top)next/")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [subject, shortSha] = l.split("\t");
      return { subject: subject ?? "", shortSha: shortSha ?? "" };
    });
  const text = releaseNotes({ commits, previousTag: prev, tag, repo });
  const out = arg("out");
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
} else {
  console.error("usage: cli.ts plan [--bump X] | notes --tag T --repo R [--out F]");
  process.exit(2);
}
