/**
 * CHECK_WEIGHTS（配点の写し）が analyzer の実際の出力と一致することを検証する。
 *
 * サイトモードの見込み加点は CheckResult.weight を持たない SiteCheckSummary から
 * 計算するため、この写しがずれると優先改善 TOP3 の順位が狂う。
 * ネットワークには出ず、手書きの HTML を analyzeFetched に直接渡す。
 */
import { describe, expect, it } from "vitest";
import {
  analyzeFetched,
  type AnalysisResult,
  type CategoryId,
  type FetchedText,
  type SiteAnalysisResult,
  type SitePageResult,
  type SiteFiles,
} from "@/lib/analyzer";
import { summarizeCategories, summarizeChecks } from "@/lib/analyzer/site";
import { buildSiteSummary } from "../summary";
import type { CommentaryLine } from "../types";
import {
  CATEGORY_ORDER,
  CATEGORY_WEIGHTS,
  CHECK_WEIGHTS,
  checkWeight,
} from "../weights";

const lineText = (line: CommentaryLine): string =>
  line.map((p) => (typeof p === "string" ? p : p.num)).join("");

const SITE_FILES: SiteFiles = {
  origin: "https://example.com",
  robotsTxt: "User-agent: *\nAllow: /\n",
  sitemaps: [],
  llmsTxt: { present: true, length: 400, status: 200 },
  llmsFullTxt: { present: false, length: 0 },
};

function fetched(body: string, url = "https://example.com/"): FetchedText {
  return {
    ok: true,
    status: 200,
    finalUrl: url,
    contentType: "text/html; charset=utf-8",
    body,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    timing: { ttfbMs: 300, totalMs: 400, bytes: body.length },
  };
}

const LONG_TEXT =
  "AI 検索最適化は、生成 AI が回答を組み立てるときに引用されやすい状態を作る取り組みです。".repeat(40);

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "サンプル株式会社",
      url: "https://example.com/",
      sameAs: ["https://example.com/sns"],
    },
    {
      "@type": "WebSite",
      url: "https://example.com/",
      potentialAction: { "@type": "SearchAction", target: "https://example.com/?q={q}" },
    },
    { "@type": "BreadcrumbList", itemListElement: [] },
    { "@type": "FAQPage", mainEntity: [] },
    { "@type": "Article", headline: "AI検索最適化の進め方" },
    { "@type": "Product", name: "診断サービス" },
  ],
});

const RICH_PAGE = `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<title>AI検索最適化（AIO）診断の進め方 | サンプル株式会社</title>
<meta name="description" content="AI 検索に引用されるために必要な robots.txt・構造化データ・メタ情報・見出し・本文量の整え方を、無料の診断ツールの結果に沿って解説します。">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="AI検索最適化（AIO）診断の進め方">
<meta property="og:description" content="AI 検索に引用されるための整え方">
<meta property="og:image" content="https://example.com/ogp.png">
<script type="application/ld+json">${JSON_LD}</script>
</head><body>
<h1>AI検索最適化（AIO）診断の進め方</h1>
<main>
<p>${LONG_TEXT}</p>
<h2>診断でわかること</h2><p>${LONG_TEXT}</p>
<h3>採点の考え方</h3><p>${LONG_TEXT}</p>
<img src="/figure.png" alt="診断の流れ">
</main>
</body></html>`;

const BROKEN_JSONLD_PAGE = RICH_PAGE.replace(
  "</head>",
  '<script type="application/ld+json">{ "@type": "Organization", }</script></head>',
);

const SPA_PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>アプリ</title></head>
<body><div id="root"></div>
<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>
</body></html>`;

const results = [RICH_PAGE, BROKEN_JSONLD_PAGE, SPA_PAGE].map((html) =>
  analyzeFetched(fetched(html), SITE_FILES),
);
const allChecks = results.flatMap((r) => r.categories.flatMap((c) => c.checks));

describe("CHECK_WEIGHTS", () => {
  it("analyzer が出す項目の配点と一致する", () => {
    expect(allChecks.length).toBeGreaterThan(0);
    for (const c of allChecks) {
      expect({ id: c.id, weight: checkWeight(c.id) }).toEqual({ id: c.id, weight: c.weight });
    }
  });

  it("項目 ID の一覧が analyzer と一致する（未知の ID を 1 とみなさない）", () => {
    const observed = [...new Set(allChecks.map((c) => c.id))].sort();
    expect(observed).toEqual(Object.keys(CHECK_WEIGHTS).sort());
  });

  it("カテゴリの並びと配点は analyzer と同じで、合計は 100", () => {
    expect(results[0].categories.map((c) => c.id)).toEqual([...CATEGORY_ORDER]);
    expect(CATEGORY_ORDER.reduce((sum, id) => sum + CATEGORY_WEIGHTS[id], 0)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// サイトモード: analyzer の集計（summarizeCategories / summarizeChecks）を通した実出力
// ---------------------------------------------------------------------------

function siteFrom(analyses: { url: string; result: AnalysisResult }[]): SiteAnalysisResult {
  const pages: SitePageResult[] = analyses.map(({ result }) => ({
    url: result.page.finalUrl,
    overall: result.overall,
    scores: Object.fromEntries(result.categories.map((c) => [c.id, c.score])) as Record<
      CategoryId,
      number
    >,
    page: result.page,
  }));
  return {
    entryUrl: pages[0].url,
    origin: "https://example.com",
    pages,
    excluded: [],
    failures: [],
    overall: Math.round(pages.reduce((s, p) => s + p.overall, 0) / pages.length),
    categories: summarizeCategories(pages),
    checks: summarizeChecks(analyses),
    discovery: "sitemap",
    crawl: {
      discovered: pages.length,
      fetched: pages.length,
      analyzed: pages.length,
      failed: 0,
      skipped: 0,
      excluded: 0,
      durationMs: 8_000,
      truncated: null,
      sitemapCount: pages.length,
      linkCount: 0,
      maxPages: 300,
    },
    notes: [],
    fetchedAt: "2026-09-06T05:00:00.000Z",
  };
}

describe("buildSiteSummary（analyzer の実出力）", () => {
  // robots.txt で全クローラを拒否し llms.txt も無い = 全ページ共通の未対応が出る設定
  const blockedFiles: SiteFiles = {
    ...SITE_FILES,
    robotsTxt: "User-agent: *\nDisallow: /\n",
    llmsTxt: { present: false, length: 0, status: 404 },
  };
  const analyses = [
    { url: "https://example.com/", html: RICH_PAGE },
    { url: "https://example.com/app", html: SPA_PAGE },
  ].map(({ url, html }) => ({ url, result: analyzeFetched(fetched(html, url), blockedFiles) }));
  const site = siteFrom(analyses);

  it("ページ × 項目の判定数が全ページ分の合計になる", () => {
    const s = buildSiteSummary(site);
    const checkCount = analyses.reduce(
      (n, a) => n + a.result.categories.reduce((m, c) => m + c.checks.length, 0),
      0,
    );
    expect(s.counts.scored + s.counts.info).toBe(checkCount);
    expect(s.pageCount).toBe(2);
    expect(s.rankedPages[0].isEntry).toBe(true);
    expect(s.worstPage.url).toBe("https://example.com/app");
  });

  it("すべての未対応・改善余地を直すと総合が 100 点になる（丸め誤差の範囲で）", () => {
    const s = buildSiteSummary(site);
    const total = s.overall + s.improvements.reduce((sum, i) => sum + i.gain, 0);
    // 条件付きで出す項目を無くしてカテゴリの分母をページ間で揃えたので、
    // ずれはスコアの丸め（カテゴリごと・総合で各 0.5 点まで）に収まる
    expect(Math.abs(100 - total)).toBeLessThan(1.5);
  });

  it("全ページ共通の未対応と、ページによって差がある項目を分けて数える", () => {
    const s = buildSiteSummary(site);
    // AI クローラ拒否は両ページとも未対応（テンプレート側）、js-rendering は SPA のページだけ
    const crawlers = s.priorities.find((p) => p.id === "ai-crawlers-allowed");
    expect(crawlers?.spread).toBe("uniform");
    expect(crawlers?.worst).toBe("fail");
    expect(crawlers?.affectedCount).toBe(2);
    expect(s.priorities.find((p) => p.id === "js-rendering")?.spread).toBe("mixed");
    expect(s.uniformFailCount).toBeGreaterThan(0);
    expect(lineText(s.commentary[1])).toContain("全 2 ページ共通の重大な問題");
    expect(s.priorities.every((p) => p.totalPages === 2)).toBe(true);
    expect(s.projected).toBeLessThanOrEqual(100);
  });
});
