import type { Metadata } from "next";
import Link from "next/link";
import { NotConfigured, PageTitle } from "@/components/monitor/parts";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatJst } from "@/lib/monitor/format";
import { listRecentRuns, listSites } from "@/lib/monitor/store";
import { formatDuration } from "@/lib/report/format";
import { scoreTone, TONE_CLASSES } from "@/lib/ui/palette";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "診断履歴" };

const TRIGGER_LABEL = { schedule: "定期", manual: "手動" } as const;

/** 全サイトの診断の記録（サイト・結果で絞り込める） */
export default async function RunsPage({ searchParams }: { searchParams: Promise<{ site?: string; status?: string }> }) {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const q = await searchParams;
  const siteId = q.site && Number.isInteger(Number(q.site)) ? Number(q.site) : undefined;
  const status = q.status === "success" || q.status === "error" ? q.status : undefined;
  const db = await getDb();
  const [runs, sites] = await Promise.all([listRecentRuns(db, { siteId, status, limit: 200 }), listSites(db)]);

  const selectClass =
    "h-10 rounded-lg border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle title="診断履歴" lead="定期診断と「今すぐ診断」の記録です（新しい順に最大 200 件）。" />

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-[13px] font-bold text-ink">
          サイト
          <select name="site" defaultValue={siteId ?? ""} className={`mt-1 block ${selectClass}`}>
            <option value="">すべて</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[13px] font-bold text-ink">
          結果
          <select name="status" defaultValue={status ?? ""} className={`mt-1 block ${selectClass}`}>
            <option value="">すべて</option>
            <option value="success">診断済み</option>
            <option value="error">診断できず</option>
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg border border-line bg-panel px-4 text-sm font-bold text-ink hover:bg-surface">
          絞り込む
        </button>
      </form>

      {runs.length === 0 ? (
        <p className="text-[13px] text-muted">記録はありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[44rem] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="px-3 py-2 font-bold">日時</th>
                <th className="px-3 py-2 font-bold">サイト</th>
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
                  <td className="px-3 py-2">
                    <Link href={`/monitor/sites/${r.siteId}`} className="font-bold text-ink hover:text-accent hover:underline">
                      {r.siteName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{TRIGGER_LABEL[r.trigger]}</td>
                  {r.status === "success" ? (
                    <>
                      <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.overall === null ? "" : TONE_CLASSES[scoreTone(r.overall)].text}`}>
                        {r.overall ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.pageCount ?? "-"}</td>
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
    </main>
  );
}
