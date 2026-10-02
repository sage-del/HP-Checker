import type { Metadata } from "next";
import Link from "next/link";
import { markAllAlertsReadAction } from "@/app/monitor/actions";
import { AlertList, NotConfigured, PageTitle } from "@/components/monitor/parts";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { countUnreadAlerts, listAlerts } from "@/lib/monitor/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "通知" };

/** ツール内の通知（未読 / すべて） */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const all = (await searchParams).view === "all";
  const db = await getDb();
  const [alerts, unread] = await Promise.all([listAlerts(db, { unreadOnly: !all, limit: 200 }), countUnreadAlerts(db)]);

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-bold ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageTitle
        back={{ href: "/monitor", label: "定期監視" }}
        title="通知"
        lead="定期診断で前回より悪くなった点・直った点をお知らせします。"
        actions={
          unread > 0 ? (
            <form action={markAllAlertsReadAction}>
              <button type="submit" className="h-9 rounded-lg border border-line bg-panel px-3 text-sm font-bold text-ink hover:bg-surface">
                すべて既読にする
              </button>
            </form>
          ) : undefined
        }
      />
      <nav className="mb-4 flex gap-1" aria-label="表示する通知">
        <Link href="/monitor/alerts" className={tab(!all)} aria-current={!all ? "page" : undefined}>
          未読 {unread > 0 && <span className="tabular-nums">({unread})</span>}
        </Link>
        <Link href="/monitor/alerts?view=all" className={tab(all)} aria-current={all ? "page" : undefined}>
          すべて
        </Link>
      </nav>
      <AlertList alerts={alerts} empty={all ? "通知はありません。" : "未読の通知はありません。"} />
    </main>
  );
}
