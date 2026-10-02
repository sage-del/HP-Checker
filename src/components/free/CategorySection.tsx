/**
 * 2. カテゴリ別スコア（design-spec §3.2-2 / §3.3-2）。
 * 目盛（50 / 80）付きのカテゴリ別の横棒と、配点・判定の表。棒には最低〜最高のレンジ帯を重ねる。
 */
import { HBar, type HBarRow } from "@/components/charts";
import { Badge, DataTable, type Column } from "@/components/ui";
import { pathOf, type CategoryRow, type SiteReportSummary } from "@/lib/report";
import { TONE_LABELS } from "@/lib/ui/palette";
import { ReportSection } from "./report-parts";

export function CategorySection({ summary, number }: { summary: SiteReportSummary; number: number }) {
  const rows: HBarRow[] = summary.categories.map((c) => ({
    label: c.label,
    value: c.score,
    range: c.min !== undefined && c.max !== undefined && c.max > c.min ? { min: c.min, max: c.max } : undefined,
  }));

  const columns: Column<CategoryRow>[] = [
    { key: "label", header: "カテゴリ", accessor: (r) => r.label, nowrap: true },
    { key: "weight", header: "配点", align: "right", width: "3.5rem", render: (r) => r.weight },
    {
      key: "score",
      header: "平均",
      align: "right",
      width: "3.5rem",
      render: (r) => <span className="font-bold">{r.score}</span>,
    },
    {
      key: "tone",
      header: "判定",
      width: "5.5rem",
      render: (r) => <Badge tone={r.tone}>{TONE_LABELS[r.tone]}</Badge>,
    },
  ];
  columns.push(
    {
      key: "range",
      header: "最低〜最高",
      align: "right",
      width: "5rem",
      nowrap: true,
      render: (r) => (r.min === undefined || r.max === undefined ? "—" : `${r.min}〜${r.max}`),
    },
    {
      key: "worst",
      header: "最低点のページ",
      render: (r) => <span className="break-all text-[12px] text-muted">{r.worstUrl ? pathOf(r.worstUrl) : "—"}</span>,
    },
  );

  return (
    <ReportSection
      number={number}
      title="カテゴリ別スコア"
      lead={`総合スコアは ${summary.categories.length} カテゴリを配点で加重平均した値です。棒は全ページの平均、帯は最低〜最高の幅を表します。`}
    >
      <HBar rows={rows} labelWidth="7.5rem" ariaLabel="カテゴリ別スコア" />
      <div className="mt-5">
        <DataTable
          rows={summary.categories}
          columns={columns}
          rowKey={(r) => r.id}
          dense
          stickyHeader={false}
          minWidth="34rem"
        />
      </div>
    </ReportSection>
  );
}
