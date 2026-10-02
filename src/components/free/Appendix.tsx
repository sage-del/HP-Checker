/**
 * 付録 A。
 * - page: 診断対象ページの情報（§3.2 付録 A）
 * - site: 診断ページ一覧・採点から外したページ・診断できなかったページ・クロール統計（§3.3 付録 A）
 */
import { DataTable, type Column } from "@/components/ui";
import type {
  SiteAnalysisResult,
  SiteCrawlStats,
  SiteExcludedPage,
  SitePageFailure,
} from "@/lib/analyzer/types";
import { fmt, formatDuration, pathOf, type SiteReportSummary } from "@/lib/report";
import { DISCOVERY_LABEL, EmptyLine, KeyValue, Num, ReportSection, SubHeading } from "./report-parts";

const FAILURE_COLUMNS: Column<SitePageFailure>[] = [
  {
    key: "url",
    header: "URL",
    render: (row) => <span className="break-all">{pathOf(row.url)}</span>,
  },
  { key: "message", header: "理由", render: (row) => <span className="text-muted">{row.message}</span> },
];

/** 「サイト内検索の結果ページ（noindex）」 */
function exclusionLabel(row: SiteExcludedPage): string {
  const by = row.by.map((signal) => (signal === "noindex" ? "noindex" : "robots.txt")).join("・");
  return `${row.kind}（${by}）`;
}

const EXCLUDED_COLUMNS: Column<SiteExcludedPage>[] = [
  {
    key: "url",
    header: "URL",
    render: (row) => <span className="break-all">{pathOf(row.url)}</span>,
  },
  {
    key: "kind",
    header: "種類",
    render: (row) => <span className="text-muted">{exclusionLabel(row)}</span>,
  },
];

function truncationLabel(crawl: SiteCrawlStats): string {
  if (!crawl.truncated) return "打ち切りなし（見つかったページをすべて診断しました）";
  return crawl.truncated.reason === "max-pages"
    ? `上限 ${fmt(crawl.truncated.limit)} ページに達したため打ち切りました`
    : `制限時間 ${fmt(Math.round(crawl.truncated.limit / 1000))} 秒に達したため打ち切りました`;
}

export function SiteAppendix({
  result,
  summary,
  number,
}: {
  result: SiteAnalysisResult;
  summary: SiteReportSummary;
  number: string;
}) {
  const crawl = result.crawl;
  return (
    <ReportSection number={number} title="診断ページ一覧">
      <dl className="grid gap-x-8 @md:grid-cols-2">
        {summary.rankedPages.map((page) => (
          <div key={page.url} className="flex items-baseline gap-2 border-b border-line py-1 text-[12px]">
            <dt className="w-7 shrink-0 text-right text-muted tabular-nums">{page.rank}</dt>
            <dd className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 flex-1 break-all text-ink">{page.path}</span>
              <span className="shrink-0 font-bold text-ink tabular-nums">{page.overall}</span>
              <span className="w-3 shrink-0 text-right font-bold" style={{ color: page.grade.color }}>
                {page.grade.grade}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {result.excluded.length > 0 && (
        <>
          <SubHeading note={`${fmt(result.excluded.length)} ページ`}>
            採点から外したページ（参考）
          </SubHeading>
          <p className="mb-2 text-[12px] leading-relaxed text-muted">
            サイト内検索の結果やカートなど、もともと検索結果に出さないページです。title や本文が
            無くても問題にならないため、平均点とページ一覧には含めていません。
          </p>
          <DataTable
            rows={result.excluded}
            columns={EXCLUDED_COLUMNS}
            rowKey={(row) => row.url}
            dense
            stickyHeader={false}
            minWidth="24rem"
          />
        </>
      )}

      <SubHeading>診断できなかったページ</SubHeading>
      {result.failures.length === 0 ? (
        <EmptyLine>取得・診断に失敗したページはありません。</EmptyLine>
      ) : (
        <DataTable
          rows={result.failures}
          columns={FAILURE_COLUMNS}
          rowKey={(row) => row.url}
          dense
          stickyHeader={false}
          minWidth="24rem"
        />
      )}

      <SubHeading>クロール統計</SubHeading>
      <dl className="grid gap-x-8 @md:grid-cols-2">
        <KeyValue term="ページの集め方">
          {DISCOVERY_LABEL[result.discovery]}（sitemap 由来 <Num>{fmt(crawl.sitemapCount)}</Num> 件 / 内部リンクのみ{" "}
          <Num>{fmt(crawl.linkCount)}</Num> 件）
        </KeyValue>
        <KeyValue term="発見したページ">
          <Num>{fmt(crawl.discovered)}</Num> 件
        </KeyValue>
        <KeyValue term="取得を試みたページ">
          <Num>{fmt(crawl.fetched)}</Num> 件（対象外 <Num>{fmt(crawl.skipped)}</Num> 件）
        </KeyValue>
        <KeyValue term="診断できたページ">
          <Num>{fmt(crawl.analyzed)}</Num> 件
          {crawl.excluded > 0 && (
            <>
              （採点対象外 <Num>{fmt(crawl.excluded)}</Num> 件）
            </>
          )}
        </KeyValue>
        <KeyValue term="診断できなかったページ">
          <Num>{fmt(crawl.failed)}</Num> 件
        </KeyValue>
        <KeyValue term="上限と打ち切り">
          上限 <Num>{fmt(crawl.maxPages)}</Num> ページ / {truncationLabel(crawl)}
        </KeyValue>
        <KeyValue term="クロールの所要時間">{formatDuration(crawl.durationMs)}</KeyValue>
      </dl>

      {result.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.notes.map((note) => (
            <li key={note} className="text-[12px] leading-relaxed text-muted">
              ※ {note}
            </li>
          ))}
        </ul>
      )}
    </ReportSection>
  );
}
