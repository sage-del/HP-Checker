import { describe, expect, it } from "vitest";
import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import type { Ga4OrganicReport, GscSearchReport } from "@/lib/google/types";
import { buildSeoOpportunities, resolveSeoDateRange } from "../report";

const scores = {
  crawlers: 50,
  structuredData: 80,
  meta: 50,
  headings: 80,
  content: 80,
  trust: 80,
  contact: 80,
  performance: 80,
  security: 80,
  mobile: 80,
};

const audit: SiteAnalysisResult = {
  entryUrl: "https://example.com/",
  origin: "https://example.com",
  pages: [
    {
      url: "https://example.com/",
      overall: 72,
      scores,
      page: {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        title: "Example",
        description: null,
        lang: "ja",
        mainTextLength: 1000,
        rawTextLength: 1200,
        jsonLdTypes: [],
        h1Count: 1,
        fetchedAt: "2026-09-30T00:00:00.000Z",
      },
    },
  ],
  excluded: [],
  failures: [],
  overall: 72,
  categories: Object.entries(scores).map(([id, score]) => ({
    id: id as keyof typeof scores,
    label: id,
    score,
    min: score,
    max: score,
    worstUrl: "https://example.com/",
  })),
  checks: [
    {
      id: "meta-description",
      category: "meta",
      label: "meta description がありません",
      advice: "検索意図が伝わる説明文を追加してください",
      counts: { pass: 0, warn: 0, fail: 1, info: 0 },
      spread: "uniform",
      affected: [{ url: "https://example.com/", status: "fail", evidence: "未設定" }],
    },
  ],
  discovery: "entry-only",
  crawl: {
    discovered: 1,
    fetched: 1,
    analyzed: 1,
    excluded: 0,
    failed: 0,
    skipped: 0,
    durationMs: 100,
    truncated: null,
    sitemapCount: 0,
    linkCount: 0,
    maxPages: 10,
  },
  notes: [],
  fetchedAt: "2026-09-30T00:00:00.000Z",
};

const range = { startDate: "2026-09-01", endDate: "2026-09-28" };
const ga4: Ga4OrganicReport = {
  propertyId: "123",
  dateRange: range,
  totals: { sessions: 40, activeUsers: 30, engagedSessions: 10, keyEvents: 1, engagementRate: 0.25 },
  landingPages: [
    { path: "/service", sessions: 40, activeUsers: 30, engagedSessions: 10, keyEvents: 1, engagementRate: 0.25 },
  ],
};
const gsc: GscSearchReport = {
  siteUrl: "sc-domain:example.com",
  dateRange: range,
  totals: { clicks: 4, impressions: 500, ctr: 0.008, position: 8 },
  topQueries: [],
  topPages: [],
  queryPages: [
    { query: "seo 診断", page: "https://example.com/service", clicks: 4, impressions: 500, ctr: 0.008, position: 8 },
  ],
};

describe("SEO automation report", () => {
  it("既定期間を前日までの28日間にする", () => {
    expect(resolveSeoDateRange({}, new Date("2026-10-02T10:00:00Z"))).toEqual({
      startDate: "2026-09-04",
      endDate: "2026-10-01",
    });
    expect(() => resolveSeoDateRange({ startDate: "2026-10-02", endDate: "2026-10-01" })).toThrow();
  });

  it("技術課題・GSC・GA4 の根拠を優先課題へ統合する", () => {
    const list = buildSeoOpportunities(audit, ga4, gsc);
    expect(list.some((item) => item.source === "site-audit" && item.kind === "technical")).toBe(true);
    expect(list.some((item) => item.source === "gsc" && item.kind === "low-ctr")).toBe(true);
    expect(list.some((item) => item.source === "gsc" && item.kind === "striking-distance")).toBe(true);
    expect(list.some((item) => item.source === "ga4" && item.kind === "low-engagement")).toBe(true);
    expect(list[0].priority).toBeGreaterThanOrEqual(list.at(-1)?.priority ?? 0);
  });
});
