import { FetchError, fetchStatus } from "@/lib/analyzer/fetch";
import { drainQueue } from "@/lib/crawl/pool";
import type { RefTarget } from "./extract";
import type { BrokenLink, LinkCheckResult } from "./types";

/** 1 回の診断で新たに問い合わせる参照先の上限（クロール済みの URL は数えない） */
export const MAX_LINK_CHECKS = 300;
/** 既定の時間予算 */
export const DEFAULT_LINK_TIME_BUDGET_MS = 45_000;
const LINK_TIMEOUT_MS = 8_000;
const LINK_CONCURRENCY = 4;

/**
 * リンク切れとみなすステータス。
 * 401 / 403 / 429 は「見せない・混んでいる」の意味で、リンク先が無いとは限らない
 * （WAF がクローラだけを弾くことも多い）ので数えない。
 */
export function isBrokenStatus(status: number): boolean {
  return status === 0 || status === 404 || status === 410 || status >= 500;
}

export interface CheckLinksOptions {
  targets: ReadonlyMap<string, RefTarget>;
  /** クロールで取得済みの URL → ステータス。ここにある URL は問い合わせない */
  known?: ReadonlyMap<string, number>;
  maxChecks?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
  /** テスト用の差し替え口 */
  probe?: (url: string) => Promise<number>;
}

/** 参照先のステータスを確かめ、リンク切れを返す */
export async function checkLinks(options: CheckLinksOptions): Promise<LinkCheckResult> {
  const started = Date.now();
  const deadline = started + (options.timeBudgetMs ?? DEFAULT_LINK_TIME_BUDGET_MS);
  const maxChecks = options.maxChecks ?? MAX_LINK_CHECKS;
  const known = options.known ?? new Map<string, number>();
  const probe =
    options.probe ??
    (async (url: string) => (await fetchStatus(url, { timeoutMs: LINK_TIMEOUT_MS, signal: options.signal })).status);

  const statuses = new Map<string, number>();
  const pending: string[] = [];
  for (const url of options.targets.keys()) {
    const status = known.get(url);
    if (status !== undefined) statuses.set(url, status);
    else pending.push(url);
  }

  // 参照元の多い（= 影響の大きい）参照先から確かめる
  pending.sort(
    (a, b) => options.targets.get(b)!.sourceCount - options.targets.get(a)!.sourceCount || a.localeCompare(b),
  );
  const queue = pending.slice(0, maxChecks);
  let skipped = 0;

  await drainQueue(
    LINK_CONCURRENCY,
    () => {
      if (options.signal?.aborted || Date.now() > deadline) return undefined;
      return queue.shift();
    },
    async (url) => {
      try {
        statuses.set(url, await probe(url));
      } catch (err) {
        // 内部アドレスへの転送は結果に出さない（内部ネットワークの到達性を漏らさないため）
        if (err instanceof FetchError && err.code === "blocked_host") skipped += 1;
        else statuses.set(url, 0);
      }
    },
  );

  const broken: BrokenLink[] = [];
  for (const [url, status] of statuses) {
    if (!isBrokenStatus(status)) continue;
    const target = options.targets.get(url)!;
    broken.push({ url, status, kind: target.kind, sources: target.sources, sourceCount: target.sourceCount });
  }
  // 404 / 410 → 5xx → 接続不可の順、同じなら参照元の多い順
  const rank = (s: number) => (s === 404 || s === 410 ? 0 : s >= 500 ? 1 : 2);
  broken.sort((a, b) => rank(a.status) - rank(b.status) || b.sourceCount - a.sourceCount || a.url.localeCompare(b.url));

  return {
    found: options.targets.size,
    checked: statuses.size,
    unchecked: options.targets.size - statuses.size - skipped,
    broken,
    durationMs: Date.now() - started,
  };
}
