import type { Metadata } from "next";
import Link from "next/link";
import { AddSiteForm } from "@/components/monitor/AddSiteForm";
import { NotConfigured, PageTitle, RunStatusBadge, ScoreWithDelta, Section } from "@/components/monitor/parts";
import { RunNowButton } from "@/components/monitor/RunNowButton";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatAgo, formatJst } from "@/lib/monitor/format";
import { FREQUENCY_LABEL } from "@/lib/monitor/schedule";
import { countUnreadAlerts, listSiteOverviews } from "@/lib/monitor/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "定期監視" };

/** 監視しているサイトの一覧と、サイトの登録 */
export default async function MonitorPage() {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const db = await getDb();
  const [sites, unread] = await Promise.all([listSiteOverviews(db), countUnreadAlerts(db)]);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageTitle
        title="定期監視"
        lead="登録したサイトを決まった頻度で自動診断し、前回より悪くなったときにツール内で通知します。"
        actions={
          <Link
            href="/monitor/alerts"
            className="inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3 text-sm font-bold text-ink hover:bg-surface"
          >
            通知{unread > 0 && <span className="ml-1.5 rounded-full bg-fail px-1.5 text-[11px] text-on-brand tabular-nums">{unread}</span>}
          </Link>
        }
      />

      {sites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-panel p-6 text-center text-sm text-muted">
          まだサイトが登録されていません。下のフォームから追加してください。
        </p>
      ) : (
        <ul className="space-y-3">
          {sites.map((s) => (
            <li key={s.id} className="rounded-xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/monitor/sites/${s.id}`} className="text-base font-bold text-ink hover:text-accent hover:underline">
                      {s.name}
                    </Link>
                    <RunStatusBadge run={s.latest} />
                    {!s.enabled && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">停止中</span>}
                    {s.unreadAlerts > 0 && <span className="text-[12px] font-bold text-fail">未読の通知 {s.unreadAlerts} 件</span>}
                  </div>
                  <p className="mt-0.5 break-all text-[12px] text-muted">{s.url}</p>
                  <p className="mt-2 text-[12px] text-muted">
                    {FREQUENCY_LABEL[s.frequency]}診断 ·{" "}
                    {s.latest ? (
                      <span title={formatJst(s.latest.finishedAt)}>最終診断 {formatAgo(s.latest.finishedAt, now)}</span>
                    ) : (
                      "次の定期診断を待っています"
                    )}
                    {s.latest?.brokenCount ? <span className="font-bold text-fail"> · リンク切れ {s.latest.brokenCount} 件</span> : null}
                  </p>
                  {s.latest?.status === "error" && <p className="mt-1 text-[12px] text-fail">{s.latest.error}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ScoreWithDelta score={s.latest?.overall ?? null} previous={s.previousOverall} />
                  <RunNowButton siteId={s.id} size="sm" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Section title="サイトを追加">
        <AddSiteForm />
      </Section>
    </main>
  );
}
