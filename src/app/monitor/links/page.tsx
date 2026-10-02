import type { Metadata } from "next";
import Link from "next/link";
import { BrokenLinksTable, NotConfigured, PageTitle, Section, StatCards } from "@/components/monitor/parts";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { formatJst } from "@/lib/monitor/format";
import { latestLinksBySite } from "@/lib/monitor/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "リンク切れ" };

/** 全監視サイトのリンク切れ（各サイトの最新の成功した診断） */
export default async function LinksPage() {
  if (!isMonitorConfigured()) return <NotConfigured />;
  const rows = await latestLinksBySite(await getDb());
  const total = rows.reduce((sum, r) => sum + (r.links?.broken.length ?? 0), 0);
  const affectedSites = rows.filter((r) => (r.links?.broken.length ?? 0) > 0).length;
  // リンク切れの多いサイトから
  const sorted = [...rows].sort((a, b) => (b.links?.broken.length ?? -1) - (a.links?.broken.length ?? -1));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle title="リンク切れ" lead="各サイトの最新の診断で見つかった、サイト内のリンク切れ（ページ・画像・CSS・JavaScript）です。" />
      <StatCards
        items={[
          { label: "リンク切れ", value: total, tone: total > 0 ? "fail" : "pass", hint: "全サイトの合計" },
          { label: "該当サイト", value: affectedSites, tone: affectedSites > 0 ? "fail" : undefined, hint: `監視サイト ${rows.length} 件中` },
        ]}
      />
      {rows.length === 0 && <p className="mt-8 text-[13px] text-muted">監視サイトがまだありません。</p>}
      {sorted.map(({ site, run, links }) => (
        <Section
          key={site.id}
          title={
            <Link href={`/monitor/sites/${site.id}`} className="hover:text-accent hover:underline">
              {site.name}
              {links && links.broken.length > 0 && <span className="ml-2 text-[13px] font-bold text-fail">{links.broken.length} 件</span>}
            </Link>
          }
          aside={
            run && (
              <Link href={`/monitor/runs/${run.id}`} className="text-[12px] text-muted hover:text-accent hover:underline">
                {formatJst(run.startedAt)} の診断
              </Link>
            )
          }
        >
          {run ? <BrokenLinksTable links={links ?? undefined} /> : <p className="text-[13px] text-muted">まだ診断していません。</p>}
        </Section>
      ))}
    </main>
  );
}
