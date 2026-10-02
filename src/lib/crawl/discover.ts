import { FetchError, fetchText, type FetchedText } from "@/lib/analyzer/fetch";
import type { SiteFiles } from "@/lib/analyzer/robots";
import { drainQueue } from "./pool";
import type { CrawlProgress } from "./types";
import {
  alignToOrigin,
  canonicalizeUrl,
  extractSitemapEntries,
  looksLikeHtmlUrl,
} from "./url";

/** 読み込むサイトマップファイル数の上限（索引 → 子 → 孫 … を合計して） */
export const MAX_SITEMAP_FILES = 60;
/** サイトマップ索引を何段まで辿るか */
export const MAX_SITEMAP_DEPTH = 3;
/** サイトマップから集める URL 数の上限（それ以上はクロールしきれない） */
export const MAX_SITEMAP_URLS = 20_000;
/** 1 つのサイトマップの取得タイムアウト */
const SITEMAP_TIMEOUT_MS = 8_000;
/** サイトマップは 5 万 URL で数 MB になるので、ページより大きめに許す */
const SITEMAP_MAX_BYTES = 12 * 1024 * 1024;
const SITEMAP_CONCURRENCY = 4;

/** robots.txt に Sitemap 行が無いときに試す定番の場所 */
export const FALLBACK_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/wp-sitemap.xml",
] as const;

export interface SitemapDiscovery {
  /** 同一オリジンの HTML ページ URL（正規化・重複除去済み、サイトマップの並び順） */
  urls: string[];
  /** robots.txt の Sitemap 行から辿ったか、定番の場所を当たったか */
  source: "robots" | "fallback" | "none";
  /** 取得を試みたサイトマップファイル数 */
  sitemapsTried: number;
  /** 中身を読めたサイトマップファイル数 */
  sitemapFiles: number;
  /** 日本語の補足（.gz 未対応、上限到達など） */
  notes: string[];
}

export interface DiscoverOptions {
  onProgress?: (progress: CrawlProgress) => void;
  /** これを過ぎたら新しいサイトマップは読まない（epoch ms） */
  deadline?: number;
  maxFiles?: number;
  maxDepth?: number;
  maxUrls?: number;
  /** テスト用。既定は fetchText */
  fetch?: (url: string, options: { timeoutMs: number; maxBytes: number }) => Promise<FetchedText>;
}

/**
 * サイトマップからページ URL を集める。
 *
 * 1. robots.txt の `Sitemap:` 行（複数可）
 * 2. 無ければ /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml, /wp-sitemap.xml
 *
 * サイトマップ索引は MAX_SITEMAP_DEPTH 段まで再帰的に展開し、ファイル数は
 * MAX_SITEMAP_FILES で打ち切る。.gz は未対応（fetchText がテキストとして
 * デコードしてしまうため）で、読み飛ばした旨を notes に残す。
 */
export async function discoverSitemapUrls(
  origin: string,
  siteFiles: SiteFiles,
  options: DiscoverOptions = {},
): Promise<SitemapDiscovery> {
  const started = Date.now();
  const maxFiles = options.maxFiles ?? MAX_SITEMAP_FILES;
  const maxDepth = options.maxDepth ?? MAX_SITEMAP_DEPTH;
  const maxUrls = options.maxUrls ?? MAX_SITEMAP_URLS;
  const doFetch = options.fetch ?? fetchText;

  const urls = new Set<string>();
  const seenSitemaps = new Set<string>();
  const notes = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  let tried = 0;
  let okFiles = 0;
  let gzSkipped = 0;
  let fileCapHit = false;
  let urlCapHit = false;
  let depthCapHit = false;

  const enqueueSitemap = (raw: string, depth: number) => {
    const aligned = alignToOrigin(raw.trim(), origin);
    if (!aligned) return;
    // サイトマップの URL はクエリ付き（?page=2 など）があり得るので canonicalize しない
    const key = aligned.replace(/#.*$/, "");
    if (seenSitemaps.has(key)) return;
    if (/\.gz(?:[?#]|$)/i.test(key)) {
      seenSitemaps.add(key);
      gzSkipped += 1;
      return;
    }
    if (depth > maxDepth) {
      depthCapHit = true;
      return;
    }
    if (seenSitemaps.size >= maxFiles) {
      fileCapHit = true;
      return;
    }
    seenSitemaps.add(key);
    queue.push({ url: key, depth });
  };

  const addPageUrl = (raw: string) => {
    if (urls.size >= maxUrls) {
      urlCapHit = true;
      return;
    }
    const aligned = alignToOrigin(raw.trim(), origin);
    if (!aligned) return;
    const canonical = canonicalizeUrl(aligned);
    if (!canonical || !looksLikeHtmlUrl(canonical)) return;
    urls.add(canonical);
  };

  const report = (url: string) => {
    options.onProgress?.({
      phase: "discover",
      fetched: 0,
      queued: queue.length,
      discovered: urls.size,
      failed: 0,
      url,
      elapsedMs: Date.now() - started,
    });
  };

  const processQueue = () =>
    drainQueue(
      SITEMAP_CONCURRENCY,
      () => {
        if (options.deadline !== undefined && Date.now() > options.deadline) {
          if (queue.length > 0) {
            notes.add("時間切れのため、一部のサイトマップは読み込めませんでした");
            queue.length = 0;
          }
          return undefined;
        }
        return queue.shift();
      },
      async ({ url, depth }) => {
        tried += 1;
        let res: FetchedText;
        try {
          res = await doFetch(url, { timeoutMs: SITEMAP_TIMEOUT_MS, maxBytes: SITEMAP_MAX_BYTES });
        } catch (err) {
          if (err instanceof FetchError && err.code === "too_large") {
            notes.add(`サイトマップ ${url} が大きすぎるため読み飛ばしました`);
          } else if (err instanceof FetchError && err.code === "timeout") {
            notes.add(`サイトマップ ${url} の取得がタイムアウトしました`);
          }
          report(url);
          return;
        }
        if (!res.ok || !res.body) {
          report(url);
          return;
        }
        const entries = extractSitemapEntries(res.body);
        if (entries.kind === "unknown" && entries.sitemaps.length + entries.urls.length === 0) {
          report(url);
          return;
        }
        okFiles += 1;
        for (const child of entries.sitemaps) enqueueSitemap(child, depth + 1);
        for (const page of entries.urls) addPageUrl(page);
        report(url);
      },
    );

  // 1. robots.txt の Sitemap 行
  for (const s of siteFiles.sitemaps) enqueueSitemap(s, 0);
  let source: SitemapDiscovery["source"] = queue.length > 0 ? "robots" : "none";
  if (queue.length > 0) await processQueue();

  // 2. 何も取れなければ定番の場所を当たる
  if (urls.size === 0) {
    for (const path of FALLBACK_SITEMAP_PATHS) enqueueSitemap(origin + path, 0);
    if (queue.length > 0) {
      await processQueue();
      if (urls.size > 0) source = "fallback";
    }
  }
  if (urls.size === 0) source = "none";

  if (gzSkipped > 0) {
    notes.add(
      `圧縮サイトマップ（.gz）${gzSkipped} 件は未対応のため読み飛ばしました。内部リンクから補います`,
    );
  }
  if (fileCapHit) {
    notes.add(`サイトマップの読み込みが上限（${maxFiles} ファイル）に達したため、以降は読み飛ばしました`);
  }
  if (depthCapHit) {
    notes.add(`サイトマップ索引が ${maxDepth} 段より深いため、それ以降は読み飛ばしました`);
  }
  if (urlCapHit) {
    notes.add(`サイトマップの URL が ${maxUrls.toLocaleString("ja-JP")} 件を超えたため、それ以降は対象外にしました`);
  }

  return {
    urls: [...urls],
    source,
    sitemapsTried: tried,
    sitemapFiles: okFiles,
    notes: [...notes],
  };
}
