import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { snapshotOf } from "@/lib/report/history";
import type { Db } from "../db";
import {
  addAlerts,
  addSite,
  countUnreadAlerts,
  deleteSite,
  DuplicateSiteError,
  getRun,
  KEEP_FULL_RESULTS,
  listAlerts,
  listRuns,
  listSiteOverviews,
  markAlertRead,
  markAllAlertsRead,
  previousRuns,
  saveRun,
  updateSite,
} from "../store";
import { fakeResult, memoryDb } from "./helpers";

let db: Db & { close: () => Promise<void> };

beforeAll(async () => {
  db = await memoryDb();
});
beforeEach(async () => {
  await db.exec(`truncate monitor_sites restart identity cascade`);
});
afterAll(async () => {
  await db.close();
});

const at = (iso: string) => new Date(iso);

async function success(siteId: number, iso: string, overall: number) {
  const result = fakeResult({ overall, fetchedAt: iso });
  return saveRun(db, {
    siteId,
    trigger: "schedule",
    startedAt: at(iso),
    finishedAt: at(iso),
    status: "success",
    snapshot: snapshotOf(result),
    result,
  });
}

describe("sites", () => {
  it("adds, updates and rejects duplicates", async () => {
    const site = await addSite(db, { url: "https://example.com/", name: "本社サイト", frequency: "daily" });
    expect(site).toMatchObject({ name: "本社サイト", frequency: "daily", enabled: true, lastRunAt: null });
    await expect(addSite(db, { url: "https://example.com/", name: "x", frequency: "weekly" })).rejects.toBeInstanceOf(
      DuplicateSiteError,
    );
    await updateSite(db, site.id, { enabled: false, frequency: "weekly" });
    const [overview] = await listSiteOverviews(db);
    expect(overview).toMatchObject({ enabled: false, frequency: "weekly", latest: null, unreadAlerts: 0 });
  });

  it("deleting a site removes its runs and alerts", async () => {
    const site = await addSite(db, { url: "https://example.com/", name: "a", frequency: "daily" });
    const runId = await success(site.id, "2026-10-01T00:00:00Z", 80);
    await addAlerts(db, site.id, runId, [{ severity: "info", title: "t", details: [] }]);
    await deleteSite(db, site.id);
    expect(await getRun(db, runId)).toBeNull();
    expect(await countUnreadAlerts(db)).toBe(0);
  });
});

describe("runs", () => {
  it("saves runs, updates last_run_at, and reports latest and previous score", async () => {
    const site = await addSite(db, { url: "https://example.com/", name: "a", frequency: "daily" });
    await success(site.id, "2026-10-01T00:00:00Z", 70);
    const id = await success(site.id, "2026-10-02T00:00:00Z", 82);

    const [overview] = await listSiteOverviews(db);
    expect(overview.latest?.id).toBe(id);
    expect(overview.latest?.overall).toBe(82);
    expect(overview.previousOverall).toBe(70);
    expect(overview.lastRunAt?.toISOString()).toBe("2026-10-02T00:00:00.000Z");

    const run = await getRun(db, id);
    expect(run?.result?.overall).toBe(82);
    expect(run?.snapshot?.overall).toBe(82);
    expect((await listRuns(db, site.id)).map((r) => r.overall)).toEqual([82, 70]);
  });

  it("finds the previous run and the previous successful run", async () => {
    const site = await addSite(db, { url: "https://example.com/", name: "a", frequency: "daily" });
    const first = await success(site.id, "2026-10-01T00:00:00Z", 70);
    const failed = await saveRun(db, {
      siteId: site.id,
      trigger: "schedule",
      startedAt: at("2026-10-02T00:00:00Z"),
      finishedAt: at("2026-10-02T00:00:00Z"),
      status: "error",
      error: "ページに接続できませんでした",
    });

    const latest = await previousRuns(db, site.id);
    expect(latest.last?.id).toBe(failed);
    expect(latest.last?.status).toBe("error");
    expect(latest.lastSuccess?.id).toBe(first);

    const beforeFailed = await previousRuns(db, site.id, { startedAt: at("2026-10-02T00:00:00Z"), id: failed });
    expect(beforeFailed.last?.id).toBe(first);

    // 最新が失敗なら前回比較は出さない
    const [overview] = await listSiteOverviews(db);
    expect(overview.latest?.status).toBe("error");
    expect(overview.previousOverall).toBeNull();
  });

  it("keeps the full report only for recent runs", async () => {
    const site = await addSite(db, { url: "https://example.com/", name: "a", frequency: "daily" });
    const ids: number[] = [];
    for (let i = 0; i < KEEP_FULL_RESULTS + 2; i++) {
      ids.push(await success(site.id, new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), 50 + i));
    }
    expect((await getRun(db, ids[0]))?.result).toBeNull();
    expect((await getRun(db, ids[0]))?.snapshot?.overall).toBe(50);
    expect((await getRun(db, ids[2]))?.result).not.toBeNull();
    expect((await getRun(db, ids.at(-1)!))?.result).not.toBeNull();
  });
});

describe("alerts", () => {
  it("lists, counts and marks alerts as read", async () => {
    const a = await addSite(db, { url: "https://a.example/", name: "A", frequency: "daily" });
    const b = await addSite(db, { url: "https://b.example/", name: "B", frequency: "daily" });
    await addAlerts(db, a.id, null, [
      { severity: "critical", title: "重大", details: ["x", "y"] },
      { severity: "info", title: "お知らせ", details: [] },
    ]);
    await addAlerts(db, b.id, null, [{ severity: "warning", title: "警告", details: [] }]);

    expect(await countUnreadAlerts(db)).toBe(3);
    const all = await listAlerts(db);
    expect(all).toHaveLength(3);
    const critical = all.find((x) => x.severity === "critical")!;
    expect(critical).toMatchObject({ siteName: "A", details: ["x", "y"], readAt: null });

    await markAlertRead(db, critical.id);
    expect(await countUnreadAlerts(db)).toBe(2);
    expect((await listAlerts(db, { unreadOnly: true })).map((x) => x.title).sort()).toEqual(["お知らせ", "警告"]);
    expect((await listSiteOverviews(db)).map((s) => s.unreadAlerts)).toEqual([1, 1]);

    await markAllAlertsRead(db);
    expect(await countUnreadAlerts(db)).toBe(0);
    expect(await listAlerts(db, { siteId: b.id })).toHaveLength(1);
  });
});

describe("cross-site views", () => {
  it("lists recent runs across sites and the latest broken links per site", async () => {
    const { listRecentRuns, latestLinksBySite } = await import("../store");
    const a = await addSite(db, { url: "https://a.example/", name: "A", frequency: "daily" });
    const b = await addSite(db, { url: "https://b.example/", name: "B", frequency: "daily" });
    const links = (url: string) => ({ found: 3, checked: 3, unchecked: 0, durationMs: 1, broken: [{ url, status: 404, kind: "link" as const, sources: [], sourceCount: 1 }] });
    const old = fakeResult({ overall: 60, links: links("https://a.example/old") });
    const now = fakeResult({ overall: 70, links: links("https://a.example/new") });
    for (const [result, iso] of [[old, "2026-10-01T00:00:00Z"], [now, "2026-10-02T00:00:00Z"]] as const) {
      await saveRun(db, { siteId: a.id, trigger: "schedule", startedAt: at(iso), finishedAt: at(iso), status: "success", snapshot: snapshotOf(result), result });
    }
    await saveRun(db, { siteId: b.id, trigger: "manual", startedAt: at("2026-10-03T00:00:00Z"), finishedAt: at("2026-10-03T00:00:00Z"), status: "error", error: "x" });

    const runs = await listRecentRuns(db);
    expect(runs.map((r) => [r.siteName, r.status, r.overall])).toEqual([
      ["B", "error", null],
      ["A", "success", 70],
      ["A", "success", 60],
    ]);
    expect((await listRecentRuns(db, { status: "error" })).map((r) => r.siteUrl)).toEqual(["https://b.example/"]);
    expect(await listRecentRuns(db, { siteId: a.id, limit: 1 })).toHaveLength(1);

    const bySite = await latestLinksBySite(db);
    expect(bySite.map((s) => [s.site.name, s.links?.broken.map((x) => x.url) ?? null])).toEqual([
      ["A", ["https://a.example/new"]],
      ["B", null],
    ]);
  });
});
