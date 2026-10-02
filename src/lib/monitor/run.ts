/**
 * 監視サイトを 1 回診断して、記録と通知を残す。
 *
 * 定期診断（/api/cron/monitor）と「今すぐ診断」（/api/monitor/sites/[id]/run）の両方がここを通る。
 */
import { FetchError } from "@/lib/analyzer/fetch";
import { analyzeSite } from "@/lib/analyzer/site";
import { snapshotOf } from "@/lib/report/history";
import { deriveAlerts, type AlertDraft } from "./alerts";
import type { Db } from "./db";
import { addAlerts, previousRuns, saveRun, type MonitorSite, type RunTrigger } from "./store";

/** リンク切れの確認に回す時間の上限 */
const LINK_BUDGET_MAX_MS = 45_000;
/** クロールの外側（入口ページ・robots.txt の取得、保存）に見込む時間 */
const OVERHEAD_MS = 15_000;
/** これより時間が残っていなければ診断を始めない */
export const MIN_RUN_BUDGET_MS = 60_000;

/** 途中で止めた診断。中途半端な結果で誤った通知を出さないよう、記録しない */
export class MonitorAbortedError extends Error {
  constructor() {
    super("診断を中止しました");
    this.name = "MonitorAbortedError";
  }
}

export interface MonitorRunResult {
  runId: number;
  status: "success" | "error";
  overall: number | null;
  error: string | null;
  alerts: AlertDraft[];
}

/** 使える時間を、クロールとリンク切れの確認に振り分ける */
export function splitBudget(totalMs: number): { crawlMs: number; linkMs: number } {
  const usable = Math.max(0, totalMs - OVERHEAD_MS);
  const linkMs = Math.min(LINK_BUDGET_MAX_MS, Math.round(usable * 0.2));
  return { crawlMs: Math.max(10_000, usable - linkMs), linkMs: Math.max(5_000, linkMs) };
}

export async function runMonitor(
  db: Db,
  site: MonitorSite,
  options: { trigger: RunTrigger; timeBudgetMs: number; signal?: AbortSignal },
): Promise<MonitorRunResult> {
  const startedAt = new Date();
  const before = await previousRuns(db, site.id);
  const budget = splitBudget(options.timeBudgetMs);

  try {
    const result = await analyzeSite(site.url, {
      timeBudgetMs: budget.crawlMs,
      checkLinks: { timeBudgetMs: budget.linkMs },
      signal: options.signal,
    });
    if (options.signal?.aborted) throw new MonitorAbortedError();
    const snapshot = snapshotOf(result);
    const runId = await saveRun(db, {
      siteId: site.id,
      trigger: options.trigger,
      startedAt,
      finishedAt: new Date(),
      status: "success",
      snapshot,
      result,
    });
    const alerts = deriveAlerts({
      previousStatus: before.last?.status ?? null,
      previous: before.lastSuccess?.snapshot ?? null,
      current: { status: "success", snapshot },
    });
    await addAlerts(db, site.id, runId, alerts);
    return { runId, status: "success", overall: result.overall, error: null, alerts };
  } catch (err) {
    if (err instanceof MonitorAbortedError || options.signal?.aborted) throw new MonitorAbortedError();
    const error =
      err instanceof FetchError ? err.message : "診断中に予期しないエラーが発生しました";
    if (!(err instanceof FetchError)) console.error("[monitor] unexpected error", site.url, err);
    const runId = await saveRun(db, {
      siteId: site.id,
      trigger: options.trigger,
      startedAt,
      finishedAt: new Date(),
      status: "error",
      error,
    });
    const alerts = deriveAlerts({
      previousStatus: before.last?.status ?? null,
      previous: before.lastSuccess?.snapshot ?? null,
      current: { status: "error", error },
    });
    await addAlerts(db, site.id, runId, alerts);
    return { runId, status: "error", overall: null, error, alerts };
  }
}
