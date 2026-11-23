import { describe, expect, it } from "vitest";
import { bumpFromMessages, bumpVersion, latestAppTag, planRelease, releaseNotes } from "./version.ts";

describe("latestAppTag", () => {
  it("takes the highest app-v tag by version and ignores the Python app's tags", () => {
    expect(latestAppTag(["v0.33.1", "app-v0.0.9", "app-v0.0.10", "app-v0.1.0", "app-latest", "app-vfoo"])).toBe("app-v0.1.0");
    expect(latestAppTag(["app-v0.0.9", "app-v0.0.10"])).toBe("app-v0.0.10");
    expect(latestAppTag(["v1.0.0", "app-latest"])).toBeNull();
  });
});

describe("bumpFromMessages", () => {
  it("follows the Python app's rules", () => {
    expect(bumpFromMessages(["fix: x", "chore(next): y"])).toBe("patch");
    expect(bumpFromMessages(["fix: x", "feat(next): y"])).toBe("minor");
    expect(bumpFromMessages(["feat: y\n\nBREAKING CHANGE: z"])).toBe("major");
    expect(bumpFromMessages(["refactor!: drop"])).toBe("major");
    expect(bumpFromMessages(["breaking change in body"])).toBe("major");
    expect(bumpFromMessages(["fix: mentions feat: in the middle"])).toBe("patch");
    expect(bumpFromMessages(["Merge\n\nfeat: in body line"])).toBe("minor");
    expect(bumpFromMessages([])).toBe("patch");
  });
});

describe("planRelease", () => {
  it("starts from app-v0.0.0", () => {
    expect(planRelease({ tags: ["v9.9.9"], messages: ["chore: x"] })).toEqual({ previousTag: null, bump: "patch", version: "0.0.1", tag: "app-v0.0.1" });
    expect(planRelease({ tags: [], messages: ["feat: x"] }).version).toBe("0.1.0");
  });
  it("bumps from the latest app tag; a manual bump wins", () => {
    expect(planRelease({ tags: ["app-v1.2.3"], messages: ["feat: x"] }).version).toBe("1.3.0");
    expect(planRelease({ tags: ["app-v1.2.3"], messages: ["feat: x"], manualBump: "patch" }).version).toBe("1.2.4");
    expect(planRelease({ tags: ["app-v1.2.3"], messages: [], manualBump: "major" }).version).toBe("2.0.0");
    expect(bumpVersion([1, 2, 3], "minor")).toBe("1.3.0");
  });
});

describe("releaseNotes", () => {
  it("lists commits and links the comparison", () => {
    const t = releaseNotes({ commits: [{ subject: "feat: a", shortSha: "abc1234" }], previousTag: "app-v0.0.1", tag: "app-v0.0.2", repo: "o/r" });
    expect(t).toBe("## What's Changed\n\n* feat: a (abc1234)\n\nFull Changelog: https://github.com/o/r/compare/app-v0.0.1...app-v0.0.2\n");
    expect(releaseNotes({ commits: [], previousTag: null, tag: "app-v0.0.1", repo: "o/r" })).not.toContain("Full Changelog");
  });
});
