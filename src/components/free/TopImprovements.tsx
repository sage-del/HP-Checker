/**
 * 優先改善 TOP3 の表（design-spec §3.2-1 / §3.3-1）。
 * 独立したセクションではなく「1. 総合評価」の右列、講評の下に置く。
 * 列は # / 改善項目 / カテゴリ / 見込み効果 / 該当ページ。
 * 各項目の根拠と対応方法は「改善提案（詳細）」に出るため、ここでは並べない。
 */
import { DataTable, type Column } from "@/components/ui";
import { fmt, type Improvement, type SiteReportSummary } from "@/lib/report";
import { EmptyLine, SubHeading } from "./report-parts";

export function TopImprovementsTable({ summary }: { summary: SiteReportSummary }) {
  const items = summary.top3;

  const columns: Column<Improvement>[] = [
    {
      key: "rank",
      header: "#",
      align: "right",
      width: "1.75rem",
      render: (_r, i) => <span className="font-bold text-accent">{i + 1}</span>,
    },
    {
      key: "label",
      header: "改善項目",
      render: (r) => <span className="font-bold">{r.label}</span>,
    },
    {
      key: "category",
      header: "カテゴリ",
      width: "7rem",
      nowrap: true,
      render: (r) => <span className="text-[12px] text-muted">{r.categoryLabel}</span>,
    },
    {
      key: "gain",
      header: "見込み効果",
      align: "right",
      width: "5rem",
      nowrap: true,
      render: (r) => <span className="font-bold text-accent">{r.gainLabel}</span>,
    },
  ];
  columns.push({
    key: "pages",
    header: "該当ページ",
    align: "right",
    width: "5.5rem",
    nowrap: true,
    render: (r) =>
      r.affectedPages === undefined || r.totalPages === undefined
        ? "—"
        : `${fmt(r.affectedPages)} / ${fmt(r.totalPages)}`,
  });

  return (
    <>
      <SubHeading note="※ 見込み効果は配点からの試算">優先改善 TOP3</SubHeading>
      {items.length === 0 ? (
        <EmptyLine>優先的に改善すべき項目はありません。主要項目はすべて満たしています。</EmptyLine>
      ) : (
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(r) => r.id}
          dense
          stickyHeader={false}
          minWidth="26rem"
        />
      )}
    </>
  );
}
