import { NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/monitor/auth";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { MIN_RUN_BUDGET_MS, runMonitor } from "@/lib/monitor/run";
import { dueSites } from "@/lib/monitor/schedule";
import { listSites } from "@/lib/monitor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 関数の打ち切り（maxDuration）までに残しておく余裕 */
const SAFETY_MS = 20_000;
/** 1 サイトに使う時間の上限（手動の「今すぐ診断」と同じ） */
const PER_SITE_MAX_MS = 270_000;

/**
 * GET /api/cron/monitor — Vercel Cron が呼ぶ定期診断（vercel.json で時刻を決める）。
 *
 * 期限の来たサイトを、最後の診断が古い順に 1 つずつ診断する。1 回の呼び出しで
 * 時間が足りなくなったら残りは次の呼び出しに回す（次は取り残されたサイトから始まる）。
 * 認証は Authorization: Bearer <CRON_SECRET>（Vercel Cron が自動で付ける）。
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET, process.env.NODE_ENV === "production")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isMonitorConfigured()) {
    return Response.json({ error: "DATABASE_URL が設定されていません" }, { status: 503 });
  }

  const db = await getDb();
  const due = dueSites(await listSites(db), new Date());
  const deadline = started + maxDuration * 1000 - SAFETY_MS;
  const ran: { site: string; status: string; overall: number | null; alerts: number }[] = [];

  for (const site of due) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_RUN_BUDGET_MS) break;
    const outcome = await runMonitor(db, site, {
      trigger: "schedule",
      timeBudgetMs: Math.min(remaining, PER_SITE_MAX_MS),
    });
    ran.push({ site: site.url, status: outcome.status, overall: outcome.overall, alerts: outcome.alerts.length });
  }

  return Response.json({ due: due.length, ran, deferred: due.length - ran.length });
}
