import * as cheerio from "cheerio";
import { checkContent, extractContent } from "./content";
import { FetchError, type FetchedText } from "./fetch";
import { checkHeadings, extractHeadings } from "./headings";
import { checkStructuredData, extractJsonLd } from "./jsonld";
import { checkMeta, extractMeta } from "./meta";
import { checkCrawlers, inspectCrawlers, type SiteFiles } from "./robots";
import { buildCategories, overallScore } from "./scoring";
import { checkMobile, checkPerformance, checkSecurity } from "./technical";
import { checkContact, checkTrust, extractTrust } from "./trust";
import type { AnalysisResult, CheckResult } from "./types";

export { FetchError, type FetchedText } from "./fetch";
export { fetchSiteFiles, notForSearchKind, type SiteFiles } from "./robots";
export * from "./types";

export interface AnalyzeFetchedOptions {
  /**
   * ユーザーが入力した（またはクロールで取りに行った）URL。
   * リダイレクトされた場合も、結果の `page.url` にはこちらを残す。既定は finalUrl。
   */
  requestedUrl?: string;
}

/**
 * 取得結果が診断できる HTML ページか確かめる。ダメなら FetchError を投げる。
 */
export function assertHtmlPage(page: FetchedText): void {
  if (page.status === 0) {
    throw new FetchError("ページに接続できませんでした", "network");
  }
  if (!page.ok) {
    throw new FetchError(`ページの取得に失敗しました（HTTP ${page.status}）`, "network");
  }
  if (!page.contentType.includes("html") && !/<html[\s>]/i.test(page.body.slice(0, 2000))) {
    throw new FetchError("HTML ページではないため診断できません", "invalid_url");
  }
}

/**
 * 取得済みの HTML に対してルールベースの AIO 診断を実行する（ネットワークに出ない）。
 *
 * サイト診断ではクローラが取得したページをそのまま渡すので、同じページを
 * 二度取得しない。`siteFiles` はオリジン共通の robots.txt / llms.txt の情報。
 */
export function analyzeFetched(
  page: FetchedText,
  siteFiles: SiteFiles,
  options: AnalyzeFetchedOptions = {},
): AnalysisResult {
  assertHtmlPage(page);

  const finalUrl = new URL(page.finalUrl);
  const requestedUrl = options.requestedUrl ?? finalUrl.toString();
  const $ = cheerio.load(page.body);
  const notes: string[] = [];

  let requestedOrigin: string | null = null;
  try {
    requestedOrigin = new URL(requestedUrl).origin;
  } catch {
    requestedOrigin = null;
  }
  if (requestedOrigin && finalUrl.origin !== requestedOrigin) {
    notes.push(`リダイレクト先 ${finalUrl.toString()} を診断しました`);
  }

  const contentInfo = extractContent(page.body, finalUrl.toString(), $);
  const meta = extractMeta($);
  const headings = extractHeadings($);
  const jsonLd = extractJsonLd($);
  const trust = extractTrust($, finalUrl.toString());

  // クローラまわりは 1 度だけ読み取り、採点と「採点対象にするか」の判断で共有する
  const crawlers = inspectCrawlers(finalUrl, $, page.headers, siteFiles);
  if (crawlers.exclusion) {
    const by = crawlers.exclusion.by
      .map((signal) => (signal === "noindex" ? "noindex" : "robots.txt での拒否"))
      .join("・");
    notes.push(
      `このページは${crawlers.exclusion.kind}として検索対象から外されています（${by}）。サイト全体の診断では採点から外すため、このページ単体の点数は参考値です`,
    );
  }

  const checks: CheckResult[] = [
    ...checkCrawlers(finalUrl, crawlers, siteFiles),
    ...checkStructuredData($, finalUrl.toString()),
    ...checkMeta($),
    ...checkHeadings($),
    ...checkContent(contentInfo),
    ...checkTrust(trust),
    ...checkContact(trust),
    ...checkPerformance($, page.timing),
    ...checkSecurity($, finalUrl, page.headers),
    ...checkMobile($),
  ];

  const categories = buildCategories(checks);

  return {
    page: {
      url: requestedUrl,
      finalUrl: finalUrl.toString(),
      status: page.status,
      title: meta.title,
      description: meta.description,
      lang: meta.lang,
      mainText: contentInfo.mainText,
      mainTextLength: contentInfo.mainTextLength,
      rawTextLength: contentInfo.rawTextLength,
      jsonLdTypes: jsonLd.types,
      h1Count: headings.counts[1],
      fetchedAt: new Date().toISOString(),
    },
    exclusion: crawlers.exclusion,
    overall: overallScore(categories),
    categories,
    notes,
    facts: trust.facts,
  };
}
