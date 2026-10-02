import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrokenLinksTable, NotConfigured, PageTitle, Section } from "@/components/monitor/parts";
import { StoredReport } from "@/components/monitor/StoredReport";
import { Callout } from "@/components/ui";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatJst } from "@/lib/monitor/format";
import { getRun, getSite, KEEP_FULL_RESULTS, previousRuns } from "@/lib/monitor/store";
import { compareSnapshots } from "@/lib/report/history";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "診断レポート" };

/** 保存した 1 回分の診断レポート（前回の成功した回との比較つき） */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  const run = await getRun(db, id);
  if (!run) notFound();
  const site = await getSite(db, run.siteId);
  if (!site) notFound();

  const { lastSuccess } = await previousRuns(db, run.siteId, { startedAt: run.startedAt, id: run.id });
  const comparison =
    run.snapshot && lastSuccess?.snapshot ? compareSnapshots(lastSuccess.snapshot, run.snapshot) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8">
      <PageTitle
        back={{ href: `/monitor/sites/${site.id}`, label: site.name }}
        title={`${formatJst(run.startedAt)} の診断`}
        lead={site.url}
      />
      {run.status === "error" ? (
        <Callout tone="fail" title="この回は診断できませんでした">
          {run.error}
        </Callout>
      ) : !run.result ? (
        <Callout tone="info" title="レポートの保存期間を過ぎています">
          レポート本体はサイトごとに直近 {KEEP_FULL_RESULTS} 回分だけ残しています。この回は総合 {run.overall} 点でした。
        </Callout>
      ) : (
        <>
          <Section title="リンク切れ">
            <BrokenLinksTable links={run.result.links} />
          </Section>
          <div className="mt-8">
            <StoredReport result={run.result} comparison={comparison} />
          </div>
        </>
      )}
    </main>
  );
}
