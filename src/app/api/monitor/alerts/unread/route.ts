import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { countUnreadAlerts } from "@/lib/monitor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/monitor/alerts/unread — サイドバーの「通知」タブに出す未読の通知数 */
export async function GET() {
  if (!isMonitorConfigured()) return Response.json({ count: 0 });
  const db = await getDb();
  return Response.json({ count: await countUnreadAlerts(db) }, { headers: { "Cache-Control": "no-store" } });
}
