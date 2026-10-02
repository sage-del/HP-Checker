import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteSiteAction, updateSiteAction } from "@/app/monitor/actions";
import { LineChart } from "@/components/charts";
import {
  AlertList,
  BrokenLinksTable,
  NotConfigured,
  PageTitle,
  RunStatusBadge,
  ScoreWithDelta,
  Section,
} from "@/components/monitor/parts";
import { ConfirmSubmit } from "@/components/monitor/ConfirmSubmit";
import { RunNowButton } from "@/components/monitor/RunNowButton";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatJst, formatJstShort } from "@/lib/monitor/format";
import { FREQUENCIES, FREQUENCY_LABEL } from "@/lib/monitor/schedule";
import { getRun, getSite, listAlerts, listRuns } from "@/lib/monitor/store";
import { formatDuration } from "@/lib/report/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "監視サイト" };

const TRIGGER_LABEL = { schedule: "定期", manual: "手動" } as const;

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  const site = await getSite(db, id);
  if (!site) notFound();

  const [runs, alerts] = await Promise.all([listRuns(db, id, 60), listAlerts(db, { siteId: id, limit: 10 })]);
  const latest = runs[0] ?? null;
  const latestSuccess = runs.find((r) => r.status === "success") ?? null;
  const previousSuccess = runs.filter((r) => r.status === "success")[1] ?? null;
  // リンク切れの一覧は最新の成功した回のレポートから出す
  const latestDetail = latestSuccess ? await getRun(db, latestSuccess.id) : null;
  const trend = [...runs].reverse().map((r) => ({ label: formatJstShort(r.startedAt), value: r.status === "success" ? r.overall : null }));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageTitle
        back={{ href: "/monitor", label: "定期監視" }}
        title={site.name}
        lead={site.url}
        actions={<RunNowButton siteId={site.id} />}
      />

      <div className="grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-3">
        <div>
          <p className="text-[12px] font-bold text-muted">総合スコア</p>
          <ScoreWithDelta score={latestSuccess?.overall ?? null} previous={previousSuccess?.overall ?? null} />
        </div>
        <div>
          <p className="text-[12px] font-bold text-muted">最新の診断</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <RunStatusBadge run={latest} />
            {latest && <span className="text-[13px] text-ink">{formatJst(latest.finishedAt)}</span>}
          </div>
          {latest?.status === "error" && <p className="mt-1 text-[12px] text-fail">{latest.error}</p>}
        </div>
        <div>
          <p className="text-[12px] font-bold text-muted">リンク切れ</p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${latestSuccess?.brokenCount ? "text-fail" : "text-ink"}`}>
            {latestSuccess?.brokenCount ?? "-"}
            <span className="ml-0.5 text-[12px] text-muted">件</span>
          </p>
        </div>
      </div>

      <Section title="総合スコアの推移">
        {trend.length === 0 ? (
          <p className="text-[13px] text-muted">まだ診断していません。「今すぐ診断」を押すか、次の定期診断を待ってください。</p>
        ) : (
          <div className="rounded-xl border border-line bg-panel p-4">
            <LineChart points={trend} ariaLabel={`総合スコアの推移（直近 ${trend.length} 回）`} />
            <p className="mt-1 text-[11px] text-muted">× は診断できなかった回。点線は 50 点・80 点の境目です。</p>
          </div>
        )}
      </Section>

      <Section title="リンク切れ">
        {latestDetail?.result ? (
          <BrokenLinksTable links={latestDetail.result.links} />
        ) : (
          <p className="text-[13px] text-muted">表示できる診断結果がありません。</p>
        )}
      </Section>

      <Section
        title="最近の通知"
        aside={
          <Link href="/monitor/alerts" className="text-[13px] font-bold text-accent hover:underline">
            すべての通知
          </Link>
        }
      >
        <AlertList alerts={alerts} showSite={false} empty="このサイトの通知はありません。" />
      </Section>

      <Section title="診断の記録">
        {runs.length === 0 ? (
          <p className="text-[13px] text-muted">記録はまだありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[34rem] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="px-3 py-2 font-bold">日時</th>
                  <th className="px-3 py-2 font-bold">種類</th>
                  <th className="px-3 py-2 text-right font-bold">総合</th>
                  <th className="px-3 py-2 text-right font-bold">ページ</th>
                  <th className="px-3 py-2 text-right font-bold">リンク切れ</th>
                  <th className="px-3 py-2 text-right font-bold">所要</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">{formatJst(r.startedAt)}</td>
                    <td className="px-3 py-2 text-muted">{TRIGGER_LABEL[r.trigger]}</td>
                    {r.status === "success" ? (
                      <>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{r.overall}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.pageCount}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.brokenCount ? "font-bold text-fail" : ""}`}>{r.brokenCount ?? "-"}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="px-3 py-2 text-fail">
                        {r.error}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{formatDuration(r.finishedAt.getTime() - r.startedAt.getTime())}</td>
                    <td className="px-3 py-2 text-right">
                      {r.status === "success" && (
                        <Link href={`/monitor/runs/${r.id}`} className="font-bold text-accent hover:underline">
                          レポート
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="設定">
        <div className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <form action={updateSiteAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={site.id} />
            <label className="text-[13px] font-bold text-ink">
              表示名
              <input
                name="name"
                defaultValue={site.name}
                maxLength={60}
                className="mt-1 block h-10 w-56 rounded-lg border border-line bg-panel px-3 text-sm font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </label>
            <label className="text-[13px] font-bold text-ink">
              診断の頻度
              <select
                name="frequency"
                defaultValue={site.frequency}
                className="mt-1 block h-10 rounded-lg border border-line bg-panel px-3 text-sm font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-lg border border-line bg-panel px-4 text-sm font-bold text-ink hover:bg-surface">
              保存
            </button>
          </form>
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <form action={updateSiteAction}>
              <input type="hidden" name="id" value={site.id} />
              <input type="hidden" name="enabled" value={site.enabled ? "false" : "true"} />
              <button type="submit" className="h-9 rounded-lg border border-line bg-panel px-3 text-sm font-bold text-ink hover:bg-surface">
                {site.enabled ? "定期診断を止める" : "定期診断を再開する"}
              </button>
            </form>
            <form action={deleteSiteAction}>
              <input type="hidden" name="id" value={site.id} />
              <ConfirmSubmit
                message={`「${site.name}」を監視から削除します。診断の記録と通知もすべて消え、元に戻せません。よろしいですか？`}
                className="h-9 rounded-lg border border-fail bg-panel px-3 text-sm font-bold text-fail hover:bg-fail-soft"
              >
                監視から削除（記録と通知も消えます）
              </ConfirmSubmit>
            </form>
          </div>
        </div>
      </Section>
    </main>
  );
}
