/**
 * 3. 判定の内訳とページ別スコア分布（design-spec §3.3-3）。
 */
import { Histogram, Pie, type PieSegment } from "@/components/charts";
import { fmt, type SiteReportSummary } from "@/lib/report";
import { palette } from "@/lib/ui/palette";
import { Num, ReportSection, SubHeading } from "./report-parts";

function segmentsOf(counts: { pass: number; warn: number; fail: number }): PieSegment[] {
  return [
    { label: "合格", value: counts.pass, color: palette.pass },
    { label: "警告", value: counts.warn, color: palette.warn },
    { label: "重大", value: counts.fail, color: palette.fail },
  ];
}

export function SiteBreakdownSection({
  summary,
  number,
}: {
  summary: SiteReportSummary;
  number: number;
}) {
  return (
    <ReportSection
      number={number}
      title="判定の内訳とページ別スコア分布"
      lead="左は全ページ × 全項目の判定を集計したもの、右はページごとの総合スコアの分布です。"
    >
      <div className="grid gap-8 @md:grid-cols-2">
        <div className="min-w-0">
          <Pie
            segments={segmentsOf(summary.counts)}
            centerLabel={fmt(summary.counts.scored)}
            centerSub="判定"
            ariaLabel={`判定の内訳: 合格 ${summary.counts.pass} 件、警告 ${summary.counts.warn} 件、重大 ${summary.counts.fail} 件`}
          />
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            {summary.uniformFailCount > 0 ? (
              <>
                全ページ共通で重大の項目が <Num>{fmt(summary.uniformFailCount)}</Num> 件あります（テンプレートやサイト設定を 1 箇所直せば全ページに効きます）。
              </>
            ) : (
              "全ページ共通で重大になっている項目はありません。"
            )}
          </p>
        </div>
        <div className="min-w-0">
          <SubHeading>ページ別スコア分布</SubHeading>
          <Histogram
            bands={summary.bands.map((b) => ({
              label: b.grade,
              sublabel: b.range,
              count: b.count,
              color: b.color,
            }))}
            marker={{ fraction: summary.averageFraction, label: `平均 ${summary.average} 点` }}
            ariaLabel={`ページ別スコア分布: ${summary.bands.map((b) => `${b.grade}（${b.range}）${b.count}ページ`).join("、")}`}
          />
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            最も多い区分は {summary.modeBand.grade}（{summary.modeBand.label}）: <Num>{fmt(summary.modeBand.count)}</Num> ページ。平均{" "}
            <Num>{summary.average}</Num> 点 / 中央値 <Num>{summary.median}</Num> 点。
          </p>
        </div>
      </div>
    </ReportSection>
  );
}
