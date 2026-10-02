import { describe, expect, it } from "vitest";
import { checkBasicAuth, isAuthorizedCron, safeEqual } from "../auth";
import { splitBudget } from "../run";
import { dueSites, isDue } from "../schedule";

const now = new Date("2026-10-02T18:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe("schedule", () => {
  it("runs never-diagnosed sites and respects the interval with some slack", () => {
    expect(isDue({ enabled: true, frequency: "daily", lastRunAt: null }, now)).toBe(true);
    expect(isDue({ enabled: true, frequency: "daily", lastRunAt: hoursAgo(23) }, now)).toBe(true);
    expect(isDue({ enabled: true, frequency: "daily", lastRunAt: hoursAgo(12) }, now)).toBe(false);
    expect(isDue({ enabled: true, frequency: "weekly", lastRunAt: hoursAgo(24 * 6) }, now)).toBe(false);
    expect(isDue({ enabled: true, frequency: "weekly", lastRunAt: hoursAgo(24 * 7 - 1) }, now)).toBe(true);
    expect(isDue({ enabled: false, frequency: "daily", lastRunAt: null }, now)).toBe(false);
  });

  it("orders due sites oldest first", () => {
    const sites = [
      { id: 1, enabled: true, frequency: "daily" as const, lastRunAt: hoursAgo(30) },
      { id: 2, enabled: true, frequency: "daily" as const, lastRunAt: null },
      { id: 3, enabled: true, frequency: "daily" as const, lastRunAt: hoursAgo(50) },
      { id: 4, enabled: true, frequency: "daily" as const, lastRunAt: hoursAgo(1) },
    ];
    expect(dueSites(sites, now).map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it("splits the time budget between crawling and link checks", () => {
    expect(splitBudget(270_000)).toEqual({ crawlMs: 210_000, linkMs: 45_000 });
    const small = splitBudget(60_000);
    expect(small.crawlMs + small.linkMs).toBeLessThanOrEqual(60_000);
  });
});

describe("auth", () => {
  const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("checks basic auth, including non-ASCII passwords and colons", () => {
    expect(checkBasicAuth(basic("admin:pass"), "admin", "pass")).toBe(true);
    expect(checkBasicAuth(basic("admin:pa:ss"), "admin", "pa:ss")).toBe(true);
    expect(checkBasicAuth(basic("admin:パスワード"), "admin", "パスワード")).toBe(true);
    expect(checkBasicAuth(basic("admin:wrong"), "admin", "pass")).toBe(false);
    expect(checkBasicAuth(basic("root:pass"), "admin", "pass")).toBe(false);
    expect(checkBasicAuth(basic("nocolon"), "admin", "pass")).toBe(false);
    expect(checkBasicAuth("Bearer x", "admin", "pass")).toBe(false);
    expect(checkBasicAuth("Basic !!!", "admin", "pass")).toBe(false);
    expect(checkBasicAuth(null, "admin", "pass")).toBe(false);
  });

  it("authorizes cron calls with the shared secret", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret", true)).toBe(true);
    expect(isAuthorizedCron("Bearer wrong", "s3cret", true)).toBe(false);
    expect(isAuthorizedCron(null, "s3cret", true)).toBe(false);
    // 秘密が未設定なら本番では断り、開発では通す
    expect(isAuthorizedCron(null, undefined, true)).toBe(false);
    expect(isAuthorizedCron(null, undefined, false)).toBe(true);
  });
});
