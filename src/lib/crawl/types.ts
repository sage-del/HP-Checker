import type { SiteAnalysisResult, SiteProgress } from "@/lib/analyzer/types";

/** クロール中の進捗（1 ページ取得するごとに 1 回通知） */
export interface CrawlProgress {
  /** "discover" = サイトマップ展開中 / "crawl" = ページ取得中 */
  phase: "discover" | "crawl";
  /** 取得を試みたページ数（失敗・非 HTML も含む） */
  fetched: number;
  /** まだ取得していない待ち行列の長さ */
  queued: number;
  /** これまでに見つかった一意な URL 数（待ち行列 + 取得済み） */
  discovered: number;
  /** 取得や診断に失敗したページ数 */
  failed: number;
  /** 直近に処理した URL */
  url?: string;
  /** 開始からの経過ミリ秒 */
  elapsedMs: number;
}

export interface CrawlFailure {
  url: string;
  message: string;
}

export type CrawlTruncation = { reason: "max-pages" | "time-budget"; limit: number };

export interface CrawlResult {
  /** 実際に visit() に渡した（= 診断した）ページの URL。取得完了順 */
  visitedUrls: string[];
  /** 見つかった一意な URL 数（取得しなかったものも含む） */
  discovered: number;
  /** 取得を試みた数 */
  fetched: number;
  /** visit() が正常に終わった数 */
  visited: number;
  /** 非 HTML・別オリジンへのリダイレクト・重複などで診断対象外にした数 */
  skipped: number;
  failures: CrawlFailure[];
  /** サイトマップ由来の URL 数 */
  sitemapCount: number;
  /** サイトマップに無く、内部リンクからだけ見つかった URL 数 */
  linkCount: number;
  /** 読み込めたサイトマップファイル数 */
  sitemapFiles: number;
  truncated: CrawlTruncation | null;
  /** AbortSignal で中断された */
  aborted: boolean;
  durationMs: number;
  /** 日本語の補足（.gz 未対応など） */
  notes: string[];
}

/** /api/site が NDJSON で流すイベント。1 行 1 オブジェクト */
export type SiteStreamEvent =
  | ({ type: "progress" } & SiteProgress)
  | { type: "result"; result: SiteAnalysisResult; cached: boolean }
  | { type: "error"; error: string; code?: string };
