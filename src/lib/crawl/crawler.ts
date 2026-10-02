import { FetchError, fetchText, type FetchedText, PAGE_MAX_BYTES } from "@/lib/analyzer/fetch";
import type { SiteFiles } from "@/lib/analyzer/robots";
import { discoverSitemapUrls } from "./discover";
import { drainQueue } from "./pool";
import type { CrawlFailure, CrawlProgress, CrawlResult, CrawlTruncation } from "./types";
import {
  canonicalizeUrl,
  extractLinks,
  looksLikeHtmlResponse,
  looksLikeHtmlUrl,
  sortShallowFirst,
} from "./url";

/** 既定のページ数上限。SITE_MAX_PAGES で変更できる */
export const DEFAULT_MAX_PAGES = 100;
/** 環境変数でも超えられない上限 */
export const HARD_MAX_PAGES = 100;
/** 既定の時間予算。Route Handler の maxDuration（300 秒）に取得 1 回分の余裕を残す */
export const DEFAULT_TIME_BUDGET_MS = 240_000;
/** 同時取得数。相手サーバーへの負荷と所要時間の折り合い */
export const DEFAULT_CONCURRENCY = 4;
/** 1 ページの取得タイムアウト */
export const PAGE_TIMEOUT_MS = 12_000;
/** サイトマップ展開に使ってよい時間（全体の予算の内数） */
const DISCOVER_TIME_BUDGET_MS = 60_000;

/**
 * ページ数の上限を決める。
 * SITE_MAX_PAGES（既定・最大とも 100）が運用側の上限で、リクエストはそれ以下に丸める。
 */
export function resolveMaxPages(requested?: number | null): number {
  const env = Number.parseInt(process.env.SITE_MAX_PAGES ?? "", 10);
  const cap = Number.isFinite(env) && env > 0 ? Math.min(env, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES;
  if (requested === undefined || requested === null || !Number.isFinite(requested)) return cap;
  return Math.min(Math.max(Math.trunc(requested), 1), cap);
}

export interface CrawlOptions {
  /** 入力された URL（正規化済み）。最初に取得し、必ず診断対象に含める */
  entryUrl: string;
  /** クロール対象のオリジン。これ以外へのリンク・リダイレクトは追わない */
  origin: string;
  siteFiles: SiteFiles;
  /** 呼び出し側で既に取得済みの入力ページ。あれば取り直さない */
  entryPage?: FetchedText;
  maxPages?: number;
  timeBudgetMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CrawlProgress) => void;
  /**
   * 取得できた HTML ページごとに呼ぶ。例外はそのページの失敗として記録する。
   * `url` は待ち行列に入っていた URL（リダイレクト前）。
   */
  visit: (page: FetchedText, url: string) => void | Promise<void>;
}

/**
 * サイト全体を幅優先でクロールする。
 *
 * 種 = [入力 URL, ...サイトマップの URL（階層の浅い順）]。取得した HTML から
 * 同一オリジンの <a href> を集めて待ち行列に足し、未取得の URL が無くなるか、
 * maxPages / timeBudgetMs に達するまで続ける。同じ URL は二度取得しない。
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const started = Date.now();
  const maxPages = Math.max(1, options.maxPages ?? resolveMaxPages());
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const deadline = started + timeBudgetMs;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const origin = new URL(options.origin).origin;

  const seen = new Set<string>();
  const visitedFinals = new Set<string>();
  const queue: string[] = [];
  const failures: CrawlFailure[] = [];
  const visitedUrls: string[] = [];
  const notes: string[] = [];
  let fetched = 0;
  let dequeued = 0;
  let visited = 0;
  let skipped = 0;
  let sitemapCount = 0;
  let linkCount = 0;
  let truncated: CrawlTruncation | null = null;
  let aborted = options.signal?.aborted ?? false;

  const onAbort = () => {
    aborted = true;
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const enqueue = (candidate: string, from: "entry" | "sitemap" | "link") => {
    const url = canonicalizeUrl(candidate);
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.origin !== origin) return;
    // 入力 URL は呼び出し側で HTML と確認済みなので拡張子では弾かない
    if (from !== "entry" && !looksLikeHtmlUrl(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    queue.push(url);
    if (from === "sitemap") sitemapCount += 1;
    if (from === "link") linkCount += 1;
  };

  const report = (phase: CrawlProgress["phase"], url?: string) => {
    options.onProgress?.({
      phase,
      fetched,
      queued: queue.length,
      discovered: seen.size,
      failed: failures.length,
      url,
      elapsedMs: Date.now() - started,
    });
  };

  // --- 種を用意する ------------------------------------------------------------
  const entryUrl = canonicalizeUrl(options.entryUrl) ?? options.entryUrl;
  enqueue(entryUrl, "entry");

  let sitemapFiles = 0;
  if (!aborted) {
    const discovery = await discoverSitemapUrls(origin, options.siteFiles, {
      onProgress: (p) => options.onProgress?.({ ...p, discovered: seen.size + p.discovered }),
      deadline: Math.min(deadline, started + DISCOVER_TIME_BUDGET_MS),
    });
    sitemapFiles = discovery.sitemapFiles;
    notes.push(...discovery.notes);
    for (const url of sortShallowFirst(discovery.urls)) enqueue(url, "sitemap");
  }
  report("discover");

  // --- 幅優先で取得する --------------------------------------------------------
  const next = (): string | undefined => {
    if (aborted) return undefined;
    if (queue.length === 0) return undefined;
    if (dequeued >= maxPages) {
      truncated ??= { reason: "max-pages", limit: maxPages };
      return undefined;
    }
    if (Date.now() > deadline) {
      truncated ??= { reason: "time-budget", limit: timeBudgetMs };
      return undefined;
    }
    dequeued += 1;
    return queue.shift();
  };

  const work = async (url: string) => {
    let page: FetchedText;
    try {
      page =
        options.entryPage && url === entryUrl
          ? options.entryPage
          : await fetchText(url, {
              timeoutMs: PAGE_TIMEOUT_MS,
              maxBytes: PAGE_MAX_BYTES,
              truncate: true,
            });
    } catch (err) {
      fetched += 1;
      // 診断できないホスト（内部アドレスへの転送など）は失敗一覧に出さずに読み飛ばす。
      // URL ごとの結果を並べると内部ネットワークの到達性を調べる材料になるため。
      if (err instanceof FetchError && err.code === "blocked_host") {
        skipped += 1;
        report("crawl", url);
        return;
      }
      failures.push({
        url,
        message: err instanceof FetchError ? err.message : "ページの取得に失敗しました",
      });
      report("crawl", url);
      return;
    }
    fetched += 1;

    if (page.status === 0) {
      failures.push({ url, message: "ページに接続できませんでした" });
      report("crawl", url);
      return;
    }
    if (!page.ok) {
      failures.push({ url, message: `ページの取得に失敗しました（HTTP ${page.status}）` });
      report("crawl", url);
      return;
    }

    // リダイレクト先の確認: 別オリジンなら追わない、同一オリジンの別 URL なら 1 回だけ診断する
    const finalUrl = canonicalizeUrl(page.finalUrl) ?? url;
    let finalOrigin: string;
    try {
      finalOrigin = new URL(finalUrl).origin;
    } catch {
      finalOrigin = "";
    }
    if (finalOrigin !== origin) {
      skipped += 1;
      report("crawl", url);
      return;
    }
    if (finalUrl !== url) seen.add(finalUrl);
    if (visitedFinals.has(finalUrl)) {
      skipped += 1;
      report("crawl", url);
      return;
    }
    visitedFinals.add(finalUrl);

    if (!looksLikeHtmlResponse(page)) {
      skipped += 1;
      report("crawl", url);
      return;
    }

    try {
      for (const link of extractLinks(page.body, page.finalUrl || url)) enqueue(link, "link");
    } catch {
      // 壊れた HTML でリンク抽出が失敗しても、そのページの診断とクロール全体は続ける
    }

    try {
      await options.visit(page, url);
      visited += 1;
      visitedUrls.push(url);
    } catch (err) {
      failures.push({
        url,
        message:
          err instanceof FetchError ? err.message : "診断中に予期しないエラーが発生しました",
      });
    }
    report("crawl", url);
  };

  try {
    await drainQueue(concurrency, next, work);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  return {
    visitedUrls,
    discovered: seen.size,
    fetched,
    visited,
    skipped,
    failures,
    sitemapCount,
    linkCount,
    sitemapFiles,
    truncated,
    aborted,
    durationMs: Date.now() - started,
    notes,
  };
}
