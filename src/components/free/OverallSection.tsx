/**
 * 1. 総合評価（design-spec §3.2-1 / §3.3-1）。
 * 左にドーナツゲージと判定基準、右に講評 3 行、下に KPI ストリップ。
 */
import { Donut } from "@/components/charts";
import { StatStrip } from "@/components/ui";
import { fmt, type SiteReportSummary } from "@/lib/report";
import { Commentary, GradeScale, Num, ReportSection, SubHeading } from "./report-parts";
import { TopImprovementsTable } from "./TopImprovements";

export function OverallSection({ summary, number }: { summary: SiteReportSummary; number: number }) {
  const { counts } = summary;
  return (
    <ReportSection number={number} title="総合評価">
      <div className="grid gap-6 @md:grid-cols-[11rem_1fr]">
        <div className="min-w-0">
          <Donut
            value={summary.overall}
            ariaLabel={`総合スコア ${summary.overall} / 100（${summary.grade.grade}・${summary.grade.label}）`}
          />
          <p className="mt-3 text-[13px] font-bold text-ink">
            <Num>{fmt(summary.pageCount)}</Num> ページ平均
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            <GradeScale />
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            <span className="whitespace-nowrap">
              最高 <Num>{summary.bestPage.overall}</Num> 点
            </span>{" "}
            /{" "}
            <span className="whitespace-nowrap">
              最低 <Num>{summary.worstPage.overall}</Num> 点
            </span>
            <br />
            <span className="break-all">最低点のページ: {summary.worstPage.path}</span>
          </p>
        </div>

        <div className="min-w-0">
          <SubHeading>講評</SubHeading>
          <Commentary lines={summary.commentary} />
          <p className="mt-3 text-[11px] text-muted">
            ※ 診断結果から機械的に組み立てた文章です（生成 AI は使用していません）。
          </p>
          <TopImprovementsTable summary={summary} />
        </div>
      </div>

      <StatStrip
        className="mt-6"
        items={[
          { label: "判定数（ページ × 項目）", value: fmt(counts.scored), unit: "件" },
          { label: "合格", value: fmt(counts.pass), unit: "件" },
          { label: "警告", value: fmt(counts.warn), unit: "件" },
          { label: "重大", value: fmt(counts.fail), unit: "件" },
        ]}
      />
      {counts.info > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          ほかに情報が <Num>{fmt(counts.info)}</Num> 件あります（任意項目のため採点対象外）。
        </p>
      )}
    </ReportSection>
  );
}
