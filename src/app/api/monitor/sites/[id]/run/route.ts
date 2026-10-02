import { NextRequest } from "next/server";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { MonitorAbortedError, runMonitor } from "@/lib/monitor/run";
import { getSite } from "@/lib/monitor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 同じサイトを同時に診断しない（同じインスタンス内だけの目安） */
function running(): Set<number> {
  const g = globalThis as unknown as { __monitor_running?: Set<number> };
  g.__monitor_running ??= new Set();
  return g.__monitor_running;
}

/**
 * POST /api/monitor/sites/:id/run — 監視サイトを今すぐ診断して記録する。
 * アクセス制限は proxy.ts の Basic 認証が掛かる。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isMonitorConfigured()) {
    return Response.json({ error: "DATABASE_URL が設定されていません" }, { status: 503 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "not found" }, { status: 404 });

  const db = await getDb();
  const site = await getSite(db, id);
  if (!site) return Response.json({ error: "サイトが見つかりません" }, { status: 404 });

  const busy = running();
  if (busy.has(id)) {
    return Response.json({ error: "このサイトは診断中です" }, { status: 409 });
  }
  busy.add(id);
  // 画面を閉じたら診断も止める（途中の結果は記録しない）
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  try {
    const outcome = await runMonitor(db, site, { trigger: "manual", timeBudgetMs: 270_000, signal: abort.signal });
    return Response.json(outcome);
  } catch (err) {
    if (err instanceof MonitorAbortedError) return Response.json({ error: err.message }, { status: 499 });
    throw err;
  } finally {
    busy.delete(id);
  }
}
