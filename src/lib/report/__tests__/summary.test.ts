import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type CategoryId,
  type CheckStatus,
  type PageSnapshot,
  type SiteAnalysisResult,
  type SiteCategoryScore,
  type SiteCheckSummary,
  type SitePageResult,
} from "@/lib/analyzer/types";
import { buildSiteSummary } from "../summary";
import type { CommentaryLine } from "../types";
import { CATEGORY_ORDER } from "../weights";

// ---------------------------------------------------------------------------
// 手書きのフィクスチャ（ネットワークに出ない）
// ---------------------------------------------------------------------------

const SNAPSHOT: PageSnapshot = {
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  status: 200,
  title: "サンプルサイト",
  description: null,
  lang: "ja",
  mainText: "",
  mainTextLength: 1200,
  rawTextLength: 1500,
  jsonLdTypes: [],
  h1Count: 1,
  fetchedAt: "2026-09-06T05:00:00.000Z",
};

const EXTRA_CATEGORIES: CategoryId[] = ["trust", "contact", "performance", "security", "mobile"];

function mkSitePage(
  url: string,
  scores: Partial<Record<CategoryId, number>>,
  overall?: number,
): SitePageResult {
  // 指定の無いカテゴリは 0 点。ただし追加の 5 カテゴリ（信頼性〜モバイル対応）は、
  // 既存カテゴリだけで組んだフィクスチャの結果を変えないよう 100 点とみなす
  const full = Object.fromEntries(
    CATEGORY_ORDER.map((id) => [id, scores[id] ?? (EXTRA_CATEGORIES.includes(id) ? 100 : 0)]),
  ) as Record<CategoryId, number>;
  const weighted =
    CATEGORY_ORDER.reduce((s, id) => s + full[id] * CATEGORY_WEIGHTS[id], 0) / 100;
  return {
    url,
    overall: overall ?? Math.round(weighted),
    scores: full,
    page: { ...SNAPSHOT, url, finalUrl: url },
  };
}

function mkSiteCheck(
  id: string,
  category: CategoryId,
  counts: Partial<Record<CheckStatus, number>>,
  extra: Partial<SiteCheckSummary> = {},
): SiteCheckSummary {
  return {
    id,
    category,
    label: `${id} のラベル`,
    counts: { pass: 0, warn: 0, fail: 0, info: 0, ...counts },
    // summary 側は counts から spread を組み直すので、ここの値は問わない
    spread: "uniform",
    affected: [],
    ...extra,
  };
}

function mkSiteCategories(pages: SitePageResult[]): SiteCategoryScore[] {
  if (pages.length === 0) return [];
  return CATEGORY_ORDER.map((id) => {
    const scored = pages.map((p) => ({ url: p.url, score: p.scores[id] ?? 0 }));
    const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
    return {
      id,
      label: CATEGORY_LABELS[id],
      score: Math.round(scored.reduce((s, x) => s + x.score, 0) / scored.length),
      min: Math.min(...scored.map((s) => s.score)),
      max: Math.max(...scored.map((s) => s.score)),
      worstUrl: worst.url,
    };
  });
}

function mkSite(
  pages: SitePageResult[],
  checks: SiteCheckSummary[],
  extra: Partial<SiteAnalysisResult> = {},
): SiteAnalysisResult {
  const overall =
    pages.length === 0
      ? 0
      : Math.round(pages.reduce((s, p) => s + p.overall, 0) / pages.length);
  return {
    entryUrl: pages[0]?.url ?? "https://example.com/",
    origin: "https://example.com",
    pages,
    excluded: [],
    failures: [],
    overall,
    categories: mkSiteCategories(pages),
    checks,
    discovery: "sitemap",
    crawl: {
      discovered: pages.length,
      fetched: pages.length,
      analyzed: pages.length,
      failed: 0,
      skipped: 0,
      excluded: 0,
      durationMs: 12_000,
      truncated: null,
      sitemapCount: pages.length,
      linkCount: 0,
      maxPages: 300,
    },
    notes: [],
    fetchedAt: "2026-09-06T05:00:00.000Z",
    ...extra,
  };
}

const lineText = (line: CommentaryLine): string =>
  line.map((p) => (typeof p === "string" ? p : p.num)).join("");
const lineNums = (line: CommentaryLine): string[] =>
  line.flatMap((p) => (typeof p === "string" ? [] : [p.num]));

describe("buildSiteSummary", () => {
  const pages = [
    mkSitePage("https://example.com/", { crawlers: 100, structuredData: 80, meta: 90, headings: 100, content: 80 }),
    mkSitePage("https://example.com/a", { crawlers: 60, structuredData: 40, meta: 50, headings: 100, content: 60 }),
    mkSitePage("https://example.com/b", { crawlers: 60, structuredData: 60, meta: 70, headings: 100, content: 80 }),
    mkSitePage("https://example.com/c", { crawlers: 60, structuredData: 60, meta: 60, headings: 50, content: 60 }),
  ];
  const checks = [
    // 全 4 ページで未対応（テンプレート側の問題）
    mkSiteCheck("noindex", "crawlers", { fail: 4 }, {
      advice: "noindex を外す",
      affected: pages.map((p) => ({ url: p.url, status: "fail" as const })),
    }),
    // 2 ページだけ未対応
    mkSiteCheck("ai-crawlers-allowed", "crawlers", { fail: 2, pass: 2 }, {
      affected: [
        { url: "https://example.com/a", status: "fail" as const, evidence: "GPTBot が拒否されています" },
        { url: "https://example.com/b", status: "fail" as const },
      ],
    }),
    mkSiteCheck("llms-txt", "crawlers", { pass: 4 }),
    // 一部のページにしか現れない項目（全ページ共通とは呼べない）
    mkSiteCheck("jsonld-parse-error", "structuredData", { fail: 2 }),
    mkSiteCheck("jsonld-website", "structuredData", { warn: 1, pass: 3 }, {
      affected: [{ url: "https://example.com/c", status: "warn" as const }],
    }),
    mkSiteCheck("jsonld-search-action", "structuredData", { info: 4 }),
  ];
  const site = mkSite(pages, checks);

  it("判定の件数はページ × 項目で数える", () => {
    expect(buildSiteSummary(site).counts).toEqual({
      pass: 9,
      warn: 1,
      fail: 8,
      info: 4,
      scored: 18,
    });
  });

  it("カテゴリ行は最低・最高と最低点のページを持つ", () => {
    const s = buildSiteSummary(site);
    expect(s.categories.map((c) => c.id)).toEqual([...CATEGORY_ORDER]);
    const structured = s.categories.find((c) => c.id === "structuredData");
    expect(structured?.score).toBe(60);
    expect(structured?.min).toBe(40);
    expect(structured?.max).toBe(80);
    expect(structured?.worstUrl).toBe("https://example.com/a");
    expect(s.pageCount).toBe(4);
  });

  it("集計が欠けていてもページから作り直す", () => {
    const s = buildSiteSummary(mkSite(pages, checks, { categories: [] }));
    expect(s.categories).toHaveLength(CATEGORY_ORDER.length);
    expect(s.categories.find((c) => c.id === "headings")?.min).toBe(50);
    expect(s.categories.find((c) => c.id === "headings")?.worstUrl).toBe("https://example.com/c");
  });

  it("見込み加点は (配点 × 未対応 + 0.5 × 配点 × 改善余地) / N / Σ配点 × カテゴリ配点", () => {
    const s = buildSiteSummary(site);
    // structuredData の Σ配点 = 2(jsonld-parse-error) + 1(jsonld-website) + 0(jsonld-search-action) = 3
    //   jsonld-parse-error: 2 × 2 / 4 / 3 × 15 = 5
    //   jsonld-website:     0.5 × 1 × 1 / 4 / 3 × 15 = 0.625
    // crawlers の Σ配点 = 3(ai-crawlers-allowed) + 2(noindex) + 0(llms-txt) = 5
    //   noindex:             2 × 4 / 4 / 5 × 15 = 6
    //   ai-crawlers-allowed: 3 × 2 / 4 / 5 × 15 = 4.5（配点は大きいが該当が 2 ページなので下）
    expect(s.improvements.map((i) => i.id)).toEqual([
      "noindex",
      "jsonld-parse-error",
      "ai-crawlers-allowed",
      "jsonld-website",
    ]);
    expect(s.improvements.map((i) => i.gainLabel)).toEqual(["+6 点", "+5 点", "+5 点", "+1 点"]);
    expect(s.improvements[0].gain).toBeCloseTo(6, 3);
    expect(s.improvements[1].gain).toBeCloseTo(5, 3);
    expect(s.improvements[3].gain).toBeCloseTo(0.625, 3);
    // 配点 0 の項目（llms-txt など参考表示）は改善提案に出さない
    expect(s.improvements.map((i) => i.id)).not.toContain("llms-txt");
    const uniformItem = s.improvements[0];
    expect(uniformItem.spread).toBe("uniform");
    expect(uniformItem.status).toBe("fail");
    expect(uniformItem.affectedPages).toBe(4);
    expect(uniformItem.affectedCount).toBe(4);
    expect(uniformItem.totalPages).toBe(4);
    expect(uniformItem.advice).toBe("noindex を外す");
    const ai = s.improvements[2];
    expect(ai.spread).toBe("mixed");
    expect(ai.affectedPages).toBe(2);
    expect(ai.affectedUrls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(ai.evidence).toBe("GPTBot が拒否されています");
    // 全ページ合格の項目は優先改善に出さない
    expect(s.improvements.some((i) => i.id === "llms-txt")).toBe(false);
    expect(s.top3).toHaveLength(3);
    // 総合 81 点 + TOP3 の 6 + 5 + 4.5 = 96.5 → 97 点
    expect(s.overall).toBe(81);
    expect(s.projected).toBe(97);
    expect(s.projectedGrade.grade).toBe("A");
  });

  // 見込み加点が小さすぎて四捨五入で 0 になるときは、点数の代わりに言い回しで示す
  it("四捨五入して 0 になる見込み加点は「+1 点未満」", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      mkSitePage(`https://example.com/p${i}`, { meta: 100 }),
    );
    const s = buildSiteSummary(
      mkSite(many, [mkSiteCheck("description", "meta", { warn: 1, pass: 39 })]),
    );
    expect(s.improvements.map((i) => i.gainLabel)).toEqual(["+1 点未満"]);
  });

  it("優先改善リストは全ページ共通とページ差を 1 本にまとめる", () => {
    const s = buildSiteSummary(site);
    expect(s.priorities.map((p) => p.id)).toEqual([
      "noindex", // 未対応 4 × 配点 2 = 8
      "ai-crawlers-allowed", // 未対応 2 × 配点 3 = 6
      "jsonld-parse-error", // 未対応 2 × 配点 2 = 4
      "jsonld-website", // 改善余地 1 × 配点 1
      "jsonld-search-action", // 参考のみ
    ]);
    const uniform = s.priorities[0];
    expect(uniform.spread).toBe("uniform");
    expect(uniform.worst).toBe("fail");
    expect(uniform.affectedCount).toBe(4);
    expect(uniform.totalPages).toBe(4);
    expect(uniform.priority).toBe(8);
    expect(uniform.advice).toBe("noindex を外す");
    const mixed = s.priorities[1];
    expect(mixed.spread).toBe("mixed");
    expect(mixed.secondary).toBe(0);
    // 一部のページにしか出ない項目は「全ページ共通」にしない
    expect(s.priorities[2].spread).toBe("mixed");
    expect(s.priorities[3].worst).toBe("warn");
    expect(s.priorities[3].secondary).toBe(1);
    expect(s.priorities[4].worst).toBe("info");
    expect(s.priorities[4].affectedCount).toBe(4);
    // 全ページ合格の項目は出さない
    expect(s.priorities.some((p) => p.id === "llms-txt")).toBe(false);
    expect(s.uniformFailCount).toBe(1);
  });

  it("ページ一覧は入力 URL を先頭に固定し、残りは総合の低い順", () => {
    const s = buildSiteSummary(site);
    // 総合: /（トップ） 93 / a 74 / b 82 / c 73
    expect(s.rankedPages.map((p) => p.path)).toEqual(["/（トップ）", "/c", "/a", "/b"]);
    expect(s.rankedPages.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(s.rankedPages[0].isEntry).toBe(true);
    expect(s.rankedPages.slice(1).every((p) => !p.isEntry)).toBe(true);
    expect(s.rankedPages[2].scores.structuredData).toBe(40);
    expect(s.worstPage.path).toBe("/c");
    expect(s.bestPage.path).toBe("/（トップ）");
    expect(s.bestPage.grade.grade).toBe("A");
  });

  it("入力 URL は www・スキーム・末尾スラッシュの違いを吸収して照合する", () => {
    const s = buildSiteSummary(mkSite(pages, [], { entryUrl: "http://www.example.com/b/" }));
    expect(s.rankedPages[0].path).toBe("/b");
    expect(s.rankedPages[0].isEntry).toBe(true);
  });

  it("スコア分布は 0-49 / 50-64 / 65-79 / 80-89 / 90-100 の 5 区分（境界値を含む）", () => {
    const boundary = [49, 50, 65, 70, 80, 90].map((v, i) =>
      mkSitePage(`https://example.com/p${i}`, { crawlers: v }, v),
    );
    const s = buildSiteSummary(mkSite(boundary, []));
    expect(s.bands.map((b) => b.grade)).toEqual(["E", "D", "C", "B", "A"]);
    expect(s.bands.map((b) => b.range)).toEqual([
      "0–49",
      "50–64",
      "65–79",
      "80–89",
      "90–100",
    ]);
    expect(s.bands.map((b) => b.count)).toEqual([1, 1, 2, 1, 1]);
    expect(s.bands[2].label).toBe("改善余地あり");
    // 平均 67 点 / 中央値 67.5 → 68
    expect(s.average).toBe(67);
    expect(s.median).toBe(68);
    expect(s.modeBand.grade).toBe("C");
    // 平均 67 点は C 区分（65〜79）の 2/15 の位置
    expect(s.averageFraction).toBeCloseTo((2 + 2 / 15) / 5, 6);
  });

  it("講評は 3 行。全ページ共通の未対応があれば 2 行目で伝える", () => {
    const s = buildSiteSummary(site);
    expect(s.commentary).toHaveLength(3);
    expect(lineText(s.commentary[0])).toContain("4 ページの平均で総合");
    expect(lineNums(s.commentary[0])).toContain(String(s.overall));
    expect(lineText(s.commentary[1])).toBe(
      "全 4 ページ共通の重大な問題が 1 項目あり、テンプレートの修正で全ページに効果があります。",
    );
    expect(lineText(s.commentary[2])).toContain("優先改善 TOP3 に対応すると");
    for (const line of s.commentary) {
      expect(lineText(line)).not.toMatch(/危険|致命的/);
    }
  });

  it("全ページ共通の未対応が無ければ、最も低いカテゴリと判定件数を伝える", () => {
    const s = buildSiteSummary(
      mkSite(pages, [
        mkSiteCheck("ai-crawlers-allowed", "crawlers", { fail: 2, pass: 2 }),
        mkSiteCheck("jsonld-website", "structuredData", { warn: 1, pass: 3 }),
      ]),
    );
    expect(s.uniformFailCount).toBe(0);
    expect(lineText(s.commentary[1])).toBe(
      `最も低いのは${CATEGORY_LABELS.structuredData}（60 点）で、重大 2 件・警告 1 件の判定があります。`,
    );
  });

  it("端ケース: クロールを打ち切ったときは 1 行目で触れる", () => {
    const s = buildSiteSummary(
      mkSite(pages, checks, {
        crawl: { ...mkSite(pages, checks).crawl, truncated: { reason: "max-pages", limit: 300 } },
      }),
    );
    expect(lineText(s.commentary[0])).toContain("上限 300 ページで打ち切ったため、4 ページ分の集計です。");
    expect(lineNums(s.commentary[0])).toContain("300");
  });

  it("端ケース: 制限時間での打ち切り", () => {
    const s = buildSiteSummary(
      mkSite(pages, checks, {
        crawl: {
          ...mkSite(pages, checks).crawl,
          truncated: { reason: "time-budget", limit: 240_000 },
        },
      }),
    );
    expect(lineText(s.commentary[0])).toContain("制限時間で打ち切ったため");
  });

  it("端ケース: 1 ページだけのサイト", () => {
    const one = [
      mkSitePage("https://example.com/", Object.fromEntries(CATEGORY_ORDER.map((id) => [id, 60]))),
    ];
    const s = buildSiteSummary(
      mkSite(one, [mkSiteCheck("title", "meta", { fail: 1 }), mkSiteCheck("lang", "meta", { pass: 1 })]),
    );
    expect(s.pageCount).toBe(1);
    expect(s.rankedPages).toHaveLength(1);
    expect(s.bestPage.url).toBe(s.worstPage.url);
    expect(s.median).toBe(60);
    expect(lineText(s.commentary[0])).toContain("1 ページを診断し、総合");
    // 1 ページでは「全ページ共通」と言わない
    expect(lineText(s.commentary[1])).toContain("最も低いのは");
    expect(s.priorities[0].spread).toBe("uniform");
  });

  it("端ケース: 診断できたページが 0 でも落ちない", () => {
    const s = buildSiteSummary(mkSite([], []));
    expect(s.pageCount).toBe(0);
    expect(s.overall).toBe(0);
    expect(s.rankedPages).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(s.priorities).toEqual([]);
    expect(s.improvements).toEqual([]);
    expect(s.median).toBe(0);
    expect(s.averageFraction).toBe(0);
    expect(s.bands.every((b) => b.count === 0)).toBe(true);
    expect(s.worstPage.overall).toBe(0);
    expect(s.bestPage.url).toBe("https://example.com/");
    expect(s.commentary).toHaveLength(1);
    expect(lineText(s.commentary[0])).toContain("診断できたページがありません");
  });

  it("端ケース: 全ページ全項目合格", () => {
    const clean = [
      mkSitePage("https://example.com/", { crawlers: 100, structuredData: 100, meta: 100, headings: 100, content: 100 }),
      mkSitePage("https://example.com/a", { crawlers: 100, structuredData: 100, meta: 100, headings: 100, content: 100 }),
    ];
    const s = buildSiteSummary(
      mkSite(clean, [
        mkSiteCheck("title", "meta", { pass: 2 }),
        mkSiteCheck("jsonld-search-action", "structuredData", { info: 2 }),
      ]),
    );
    expect(s.overall).toBe(100);
    expect(s.top3).toEqual([]);
    expect(s.priorities.map((p) => p.id)).toEqual(["jsonld-search-action"]);
    expect(s.commentary).toHaveLength(3);
    expect(lineText(s.commentary[1])).toContain("2 ページのすべてで主要項目を満たしています");
    expect(lineText(s.commentary[2])).toContain("情報（2 件）");
  });
});
