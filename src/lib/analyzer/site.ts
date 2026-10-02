import { crawlSite, PAGE_TIMEOUT_MS, resolveMaxPages } from "@/lib/crawl/crawler";
import type { CrawlProgress } from "@/lib/crawl/types";
import { canonicalizeUrl, pathDepth } from "@/lib/crawl/url";
import { analyzeFetched, assertHtmlPage } from "./index";
import { assertPublicHost, FetchError, fetchText, normalizeUrl, PAGE_MAX_BYTES } from "./fetch";
import { fetchSiteFiles } from "./robots";
import { buildCategories, overallScore } from "./scoring";
import { companyConsistencyCheck, factMajority, siteFactMismatches } from "./trust";
import {
  CATEGORY_LABELS,
  type AnalysisResult,
  type CategoryId,
  type CheckStatus,
  type PageSnapshot,
  type SiteAnalysisResult,
  type SiteCategoryScore,
  type SiteCheckSummary,
  type SiteDiscovery,
  type SiteExcludedPage,
  type SitePageFailure,
  type SitePageResult,
  type SiteProgress,
} from "./types";

// URL の正規化・サイトマップ解析は crawl/ に移した。既存の利用側とテストのために再輸出する
export { canonicalizeUrl, extractSitemapLocs, NON_HTML_EXT } from "@/lib/crawl/url";
export { DEFAULT_MAX_PAGES, HARD_MAX_PAGES as MAX_PAGES_LIMIT, resolveMaxPages } from "@/lib/crawl/crawler";

/**
 * サイト診断の応答に載せるページ概要。
 *
 * 本文（`mainText`）は含めない（design-spec §9.1）。数百ページ分を積むと応答が
 * 数 MB になり、レポートが使うのは `mainTextLength` だけ。本文が要る FAQ 生成は
 * page モード専用。項目を列挙しているのは、PageSnapshot に項目が増えたときに
 * 型検査でここに気付けるようにするため。
 */
function siteSnapshot(page: PageSnapshot): SitePageResult["page"] {
  return {
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    title: page.title,
    description: page.description,
    lang: page.lang,
    mainTextLength: page.mainTextLength,
    rawTextLength: page.rawTextLength,
    jsonLdTypes: page.jsonLdTypes,
    h1Count: page.h1Count,
    fetchedAt: page.fetchedAt,
  };
}

/**
 * 入力 URL を必ず先頭に置き、残りは階層の浅い順に選ぶ。
 * クロールの種の並び順（トップ・会社概要・サービス → 記事）に使う。
 */
export function pickPages(entryUrl: string, candidates: string[], limit: number): string[] {
  const rest = candidates
    .filter((u) => u !== entryUrl)
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.length - b.length);
  return [entryUrl, ...rest].slice(0, limit);
}

export interface AnalyzeSiteOptions {
  /** ページ数の上限。省略時は SITE_MAX_PAGES（既定・最大とも 100） */
  maxPages?: number;
  /** クロール全体の時間予算（ミリ秒）。既定 240 秒 */
  timeBudgetMs?: number;
  /** 同時取得数。既定 4 */
  concurrency?: number;
  /** クライアント切断などで中断する */
  signal?: AbortSignal;
  /** 1 ページ処理するごとに呼ばれる */
  onProgress?: (progress: SiteProgress) => void;
}

/**
 * サイト単位の診断。サイト全体をクロールして全ページを診断し、集計する。
 *
 * サイト共通の項目（robots.txt / llms.txt）は 1 度だけ取得して全ページで共有し、
 * ページ固有の項目（構造化データ・メタ・見出し・コンテンツ）はページごとに評価して
 * 平均とばらつきを出す。「どのページが原因で点が下がっているか」が分かる。
 *
 * ページの集め方: サイトマップ（robots.txt の Sitemap 行 → 定番の場所、索引は再帰展開）
 * を種にして、取得した各ページの内部リンクを幅優先で辿る。上限（maxPages /
 * timeBudgetMs）に達したら打ち切り、その旨を `crawl.truncated` と `notes` に残す。
 */
export async function analyzeSite(
  input: string,
  options: AnalyzeSiteOptions = {},
): Promise<SiteAnalysisResult> {
  const startedAt = Date.now();
  const entry = normalizeUrl(input);
  await assertPublicHost(entry);
  const maxPages = resolveMaxPages(options.maxPages);

  // 入力ページを先に取得する。サイトに到達できるかを早く判定し、
  // www 有無や http→https のリダイレクトを踏まえた「本当のオリジン」をここで確定する
  const entryPage = await fetchText(entry.toString(), {
    timeoutMs: PAGE_TIMEOUT_MS,
    maxBytes: PAGE_MAX_BYTES,
    truncate: true,
  });
  assertHtmlPage(entryPage);
  const finalEntry = new URL(entryPage.finalUrl);
  const notes: string[] = [];
  if (finalEntry.origin !== entry.origin) {
    await assertPublicHost(finalEntry);
    notes.push(`リダイレクト先 ${finalEntry.origin} を診断しました`);
  }
  const origin = finalEntry.origin;
  const entryUrl = canonicalizeUrl(finalEntry.toString()) ?? finalEntry.toString();

  const files = await fetchSiteFiles(origin);

  const analyses: { url: string; result: AnalysisResult }[] = [];
  const progress = (p: CrawlProgress) => {
    options.onProgress?.({ ...p, analyzed: analyses.length });
  };

  const crawl = await crawlSite({
    entryUrl,
    origin,
    siteFiles: files,
    entryPage,
    maxPages,
    timeBudgetMs: options.timeBudgetMs,
    concurrency: options.concurrency,
    signal: options.signal,
    onProgress: progress,
    visit: (page, url) => {
      const result = analyzeFetched(page, files, { requestedUrl: url });
      // 本文（mainText）は落として積む（design-spec §9.1）。
      // 集計に使うのは categories と PageSnapshot の数値だけで、数百ページ分の本文を
      // リクエスト中ずっと抱えると数十 MB になるため。
      analyses.push({ url, result: { ...result, page: { ...result.page, mainText: "" } } });
    },
  });

  // 検索対象から外されているページ（サイト内検索の結果など）は採点しない。
  // title も本文も無くて当然のページを平均に混ぜると、直しようのない減点で
  // サイト全体の点だけが下がる。診断はしたので参考として一覧には残す。
  // ただし全ページが該当するときは採点対象が無くなってしまうので、そのまま集計する。
  const scoredAnalyses = analyses.filter(({ result }) => !result.exclusion);
  const allExcluded = scoredAnalyses.length === 0;
  const scored = allExcluded ? analyses : scoredAnalyses;
  // 会社情報の一致はページ内だけでは測りきれないので、全ページの多数派と比べ直す
  if (scored.length > 1) {
    const majority = factMajority(scored.map(({ result }) => result.facts ?? EMPTY_FACTS));
    for (const entry of scored) entry.result = withSiteConsistency(entry.result, majority);
  }
  const excluded: SiteExcludedPage[] = allExcluded
    ? []
    : analyses
        .filter(({ result }) => result.exclusion)
        .map(({ result }) => ({
          url: result.page.finalUrl,
          kind: result.exclusion!.kind,
          by: result.exclusion!.by,
        }));

  const pages: SitePageResult[] = scored.map(({ result }) => ({
    url: result.page.finalUrl,
    overall: result.overall,
    scores: Object.fromEntries(
      result.categories.map((c) => [c.id, c.score]),
    ) as Record<CategoryId, number>,
    page: siteSnapshot(result.page),
  }));

  // 入力ページを先頭に（並列取得で順序が前後するため）
  const entryIndex = pages.findIndex((p) => canonicalizeUrl(p.url) === entryUrl);
  if (entryIndex > 0) {
    const [entryResult] = pages.splice(entryIndex, 1);
    pages.unshift(entryResult);
  }

  const failures: SitePageFailure[] = crawl.failures.map((f) => ({
    url: f.url,
    message: f.message,
  }));

  if (pages.length === 0) {
    throw new FetchError("サイト内のどのページも診断できませんでした", "network");
  }

  const discovery: SiteDiscovery =
    crawl.sitemapCount > 0 && crawl.linkCount > 0
      ? "sitemap+links"
      : crawl.sitemapCount > 0
        ? "sitemap"
        : crawl.linkCount > 0
          ? "links"
          : "entry-only";

  const fmt = (n: number) => n.toLocaleString("ja-JP");

  if (discovery === "entry-only") {
    notes.push(
      "sitemap.xml も内部リンクも見つからなかったため、入力された 1 ページだけを診断しました",
    );
  } else if (pages.length === 1 && crawl.discovered === 1) {
    notes.push("同一サイト内に他のページが見つからなかったため、1 ページだけを診断しました");
  }

  if (crawl.truncated?.reason === "max-pages") {
    notes.push(
      `上限 ${fmt(crawl.truncated.limit)} ページで打ち切りました（見つかった URL は ${fmt(crawl.discovered)} 件）。SITE_MAX_PAGES で変更できます`,
    );
  } else if (crawl.truncated?.reason === "time-budget") {
    notes.push(
      `制限時間（${fmt(Math.round(crawl.truncated.limit / 1000))} 秒）に達したため ${fmt(pages.length)} ページで打ち切りました（見つかった URL は ${fmt(crawl.discovered)} 件）`,
    );
  }
  if (failures.length > 0) {
    notes.push(`${fmt(failures.length)} ページは取得できなかったため集計から除きました`);
  }
  if (excluded.length > 0) {
    notes.push(
      `${fmt(excluded.length)} ページは検索対象ではない（サイト内検索の結果など）ため、採点から外しました（付録 A に一覧）`,
    );
  } else if (allExcluded) {
    notes.push(
      "診断したページがすべて検索対象外でした。採点するページが無くなるため、今回は外さずに集計しています",
    );
  }
  if (crawl.skipped > 0) {
    notes.push(
      `${fmt(crawl.skipped)} 件は HTML 以外・別サイトへの転送・重複のため診断対象外にしました`,
    );
  }
  notes.push(...crawl.notes);

  return {
    entryUrl: entry.toString(),
    origin,
    pages,
    excluded,
    failures,
    overall: average(pages.map((p) => p.overall)),
    categories: summarizeCategories(pages),
    checks: summarizeChecks(scored),
    discovery,
    crawl: {
      discovered: crawl.discovered,
      fetched: crawl.fetched,
      analyzed: analyses.length,
      excluded: excluded.length,
      failed: failures.length,
      skipped: crawl.skipped,
      durationMs: Date.now() - startedAt,
      truncated: crawl.truncated,
      sitemapCount: crawl.sitemapCount,
      linkCount: crawl.linkCount,
      maxPages,
    },
    notes,
    fetchedAt: new Date().toISOString(),
  };
}

const EMPTY_FACTS = { phones: [], orgNames: [], postalCodes: [] };

/**
 * 「会社情報の一致」をサイト全体の多数派と比べた判定に置き換え、スコアを組み直す。
 * サイトの多数派と食い違わなければ、ページ内（構造化データと画面表記）の判定をそのまま残す。
 */
export function withSiteConsistency(
  result: AnalysisResult,
  majority: ReturnType<typeof factMajority>,
): AnalysisResult {
  const mismatches = siteFactMismatches(result.facts ?? EMPTY_FACTS, majority);
  if (mismatches.length === 0) return result;
  const replacement = companyConsistencyCheck(mismatches, "site", true);
  const checks = result.categories
    .flatMap((c) => c.checks)
    .map((c) => (c.id === replacement.id ? replacement : c));
  const categories = buildCategories(checks);
  return { ...result, categories, overall: overallScore(categories) };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function summarizeCategories(pages: SitePageResult[]): SiteCategoryScore[] {
  return (Object.keys(CATEGORY_LABELS) as CategoryId[]).map((id) => {
    const scored = pages.map((p) => ({ url: p.url, score: p.scores[id] ?? 0 }));
    const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
    return {
      id,
      label: CATEGORY_LABELS[id],
      score: average(scored.map((s) => s.score)),
      min: Math.min(...scored.map((s) => s.score)),
      max: Math.max(...scored.map((s) => s.score)),
      worstUrl: worst.url,
    };
  });
}

/**
 * 項目ごとに残す「該当ページ」の実例の上限。
 * 画面は 8 件しか出さず（DetailSection）、残りは counts から件数で示す。
 * CSV の課題一覧には全件を載せたいので、ページ数の上限（100）と同じにしている。
 */
export const MAX_AFFECTED_SAMPLES = 100;

/**
 * 項目ごとにページ横断で集計する。
 * 全ページ同じ状態なら "uniform"（テンプレート側の問題）、
 * 混在していれば "mixed"（そのページだけの問題）。
 */
export function summarizeChecks(
  analyses: { url: string; result: AnalysisResult }[],
): SiteCheckSummary[] {
  const map = new Map<string, SiteCheckSummary>();

  for (const { result } of analyses) {
    const url = result.page.finalUrl;
    for (const category of result.categories) {
      for (const c of category.checks) {
        let entry = map.get(c.id);
        if (!entry) {
          entry = {
            id: c.id,
            category: c.category,
            label: c.label,
            advice: c.advice,
            counts: { pass: 0, warn: 0, fail: 0, info: 0 },
            spread: "uniform",
            affected: [],
          };
          map.set(c.id, entry);
        }
        entry.counts[c.status] += 1;
        if (c.advice && !entry.advice) entry.advice = c.advice;
        if (c.status !== "pass") {
          entry.label = c.label; // 問題があるときの文言を代表にする
          // 該当ページの実例は上限まで（件数は counts が持つ）。
          // 300 ページ × 数十項目のとき、ここが応答とキャッシュの大半を占めるため。
          if (entry.affected.length < MAX_AFFECTED_SAMPLES) {
            entry.affected.push({ url, status: c.status, evidence: c.evidence });
          }
        }
      }
    }
  }

  const summaries = [...map.values()];
  for (const s of summaries) {
    const seen = (["pass", "warn", "fail", "info"] as CheckStatus[]).filter(
      (k) => s.counts[k] > 0,
    );
    s.spread = seen.length > 1 ? "mixed" : "uniform";
  }

  // ばらついている項目 → 全ページで問題がある項目 → 問題なしの順に並べる
  const rank = (s: SiteCheckSummary) => {
    if (s.spread === "mixed") return 0;
    if (s.counts.fail > 0 || s.counts.warn > 0) return 1;
    return 2;
  };
  return summaries.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}
