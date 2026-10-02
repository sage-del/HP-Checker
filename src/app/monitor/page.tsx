import type { Metadata } from "next";
import Link from "next/link";
import { AlertList, NotConfigured, PageTitle, RunStatusBadge, ScoreWithDelta, Section, StatCards } from "@/components/monitor/parts";
import { RunNowButton } from "@/components/monitor/RunNowButton";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatAgo, formatJst } from "@/lib/monitor/format";
import { FREQUENCY_LABEL } from "@/lib/monitor/schedule";
import { countUnreadAlerts, listAlerts, listSiteOverviews } from "@/lib/monitor/store";
import { scoreTone } from "@/lib/ui/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ダッシュボード" };

/** 定期監視のダッシュボード: 全体の集計・監視サイトの一覧・未読の通知 */
export default async function MonitorDashboard() {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const db = await getDb();
  const [sites, unread, latestAlerts] = await Promise.all([
    listSiteOverviews(db),
    countUnreadAlerts(db),
    listAlerts(db, { unreadOnly: true, limit: 5 }),
  ]);
  const now = new Date();

  const scored = sites.filter((s) => s.latest?.status === "success" && s.latest.overall !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, s) => sum + (s.latest!.overall ?? 0), 0) / scored.length)
    : null;
  const broken = sites.reduce((sum, s) => sum + (s.latest?.status === "success" ? (s.latest.brokenCount ?? 0) : 0), 0);
  const failing = sites.filter((s) => s.latest?.status === "error").length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle
        title="ダッシュボード"
        lead="登録したサイトを決まった頻度で自動診断し、前回より悪くなったときにツール内で通知します。"
        actions={
          <Link
            href="/monitor/new"
            className="inline-flex h-10 items-center rounded-lg border border-accent bg-accent px-4 text-sm font-bold text-on-brand hover:bg-accent-strong"
          >
            ＋ サイトを追加
          </Link>
        }
      />

      <StatCards
        items={[
          { label: "監視サイト", value: sites.length, hint: `停止中 ${sites.filter((s) => !s.enabled).length} 件` },
          {
            label: "平均スコア",
            value: average ?? "-",
            tone: average === null ? undefined : scoreTone(average),
            hint: `${scored.length} サイトの最新の診断`,
          },
          { label: "リンク切れ", value: broken, tone: broken > 0 ? "fail" : undefined, hint: "最新の診断の合計", href: "/monitor/links" },
          {
            label: "未読の通知",
            value: unread,
            tone: unread > 0 ? "fail" : undefined,
            hint: failing > 0 ? `診断できないサイト ${failing} 件` : "診断できないサイトなし",
            href: "/monitor/alerts",
          },
        ]}
      />

      <Section title="監視サイト">
        {sites.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-panel p-6 text-center text-sm text-muted">
            まだサイトが登録されていません。<Link href="/monitor/new" className="font-bold text-accent hover:underline">サイト追加</Link>から登録してください。
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
                      {s.latest?.status === "success" && s.latest.brokenCount ? (
                        <span className="font-bold text-fail"> · リンク切れ {s.latest.brokenCount} 件</span>
                      ) : null}
                    </p>
                    {s.latest?.status === "error" && <p className="mt-1 text-[12px] text-fail">{s.latest.error}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ScoreWithDelta score={s.latest?.status === "success" ? s.latest.overall : null} previous={s.previousOverall} />
                    <RunNowButton siteId={s.id} size="sm" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="未読の通知"
        aside={
          <Link href="/monitor/alerts" className="text-[13px] font-bold text-accent hover:underline">
            すべての通知
          </Link>
        }
      >
        <AlertList alerts={latestAlerts} empty="未読の通知はありません。" />
      </Section>
    </main>
  );
}
