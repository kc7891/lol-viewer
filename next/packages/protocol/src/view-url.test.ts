import { describe, expect, it } from "vitest";
import { isAllowedViewUrl, isTrustedNavigation, ViewUrlSchema } from "./index.js";

describe("isAllowedViewUrl", () => {
  it("accepts any https host, rejects other schemes and garbage", () => {
    expect(isAllowedViewUrl("https://lolalytics.com/lol/ahri/build/")).toBe(true);
    expect(isAllowedViewUrl("https://op.gg/champions/ahri")).toBe(true);
    expect(isAllowedViewUrl("https://example.com/x")).toBe(true);
    expect(isAllowedViewUrl("http://op.gg/x")).toBe(false);
    expect(isAllowedViewUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedViewUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedViewUrl("not a url")).toBe(false);
    expect(ViewUrlSchema.safeParse("https://example.com/").success).toBe(true);
    expect(ViewUrlSchema.safeParse("http://example.com/").success).toBe(false);
  });
});

describe("isTrustedNavigation", () => {
  const home = "https://example.com/lol/ahri";
  it("keeps known analytics sites and the view's own site in the view", () => {
    expect(isTrustedNavigation(home, "https://www.op.gg/x")).toBe(true);
    expect(isTrustedNavigation(home, "https://lolalytics.com/x")).toBe(true);
    expect(isTrustedNavigation(home, "https://u.gg/x")).toBe(true);
    expect(isTrustedNavigation(home, "https://example.com/other")).toBe(true);
    expect(isTrustedNavigation(home, "https://cdn.example.com/other")).toBe(true);
  });
  it("sends everything else to the browser", () => {
    expect(isTrustedNavigation(home, "https://evil.test/")).toBe(false);
    expect(isTrustedNavigation(home, "http://op.gg/")).toBe(false);
    expect(isTrustedNavigation("", "https://evil.test/")).toBe(false);
  });
});
