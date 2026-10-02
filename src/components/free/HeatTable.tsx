"use client";

/**
 * ページ × カテゴリ 一覧（design-spec §3.3-4）。
 *
 * 行は総合スコアの低い順（入力 URL は先頭固定）。40 行ごとに <section> を分け、
 * 画面では最初の 40 行だけ出して「次の 40 ページ」で伸ばす。
 * 41 行目以降は print-only で DOM に残してあるので、PDF / 印刷には 120 行まで載る。
 */
import { useState } from "react";
import { HeatCell } from "@/components/charts";
import { Button } from "@/components/ui";
import { CATEGORY_LABELS, CATEGORY_ORDER, fmt, type RankedPage, type SiteReportSummary } from "@/lib/report";
import { Num, ReportSection } from "./report-parts";

const ROWS_PER_CHUNK = 40;
/** PDF / 印刷に載せる上限（これを超える分は付録 A の一覧に任せる） */
const PDF_MAX_ROWS = 120;

function chunkRows(pages: readonly RankedPage[]): RankedPage[][] {
  const chunks: RankedPage[][] = [];
  for (let i = 0; i < pages.length; i += ROWS_PER_CHUNK) {
    chunks.push(pages.slice(i, i + ROWS_PER_CHUNK));
  }
  return chunks;
}

export function HeatTableSection({ summary, number }: { summary: SiteReportSummary; number: number }) {
  const [visibleChunks, setVisibleChunks] = useState(1);
  const printable = summary.rankedPages.slice(0, PDF_MAX_ROWS);
  const chunks = chunkRows(printable);
  const shownRows = Math.min(printable.length, visibleChunks * ROWS_PER_CHUNK);
  const restOnScreen = printable.length - shownRows;
  const overflow = summary.rankedPages.length - printable.length;

  return (
    <ReportSection
      number={number}
      title="ページ × カテゴリ 一覧"
      lead="同じサイトでも、テンプレートと個別コンテンツの違いでページごとに点数が変わります。総合スコアの低い順に並べています（入力した URL は先頭）。"
    >
      {chunks.map((chunk, i) => (
        <section key={i} className={i < visibleChunks ? "" : "print-only"}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] table-fixed text-[12px] text-ink">
              <caption className="sr-only">
                ページ別のカテゴリスコア一覧（{i * ROWS_PER_CHUNK + 1}〜{i * ROWS_PER_CHUNK + chunk.length} 件目）
              </caption>
              <thead>
                <tr className="border-b border-line text-[12px] leading-tight font-bold text-muted">
                  <th scope="col" className="px-1 py-2 text-right" style={{ width: "1.75rem" }}>
                    #
                  </th>
                  <th scope="col" className="px-2 py-2 text-left">
                    パス
                  </th>
                  <th scope="col" className="px-1 py-2 text-right" style={{ width: "2.5rem" }}>
                    総合
                  </th>
                  <th scope="col" className="px-1 py-2 text-center" style={{ width: "2rem" }}>
                    評価
                  </th>
                  {CATEGORY_ORDER.map((id) => (
                    <th
                      key={id}
                      scope="col"
                      className="px-1 py-2 text-right text-[10px] break-all"
                      style={{ width: "2.6rem" }}
                    >
                      {CATEGORY_LABELS[id]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chunk.map((page) => (
                  <tr key={page.url} className="border-b border-line last:border-0">
                    <td className="px-1 py-1.5 text-right text-[11px] text-muted tabular-nums">{page.rank}</td>
                    <th scope="row" className="px-2 py-1.5 text-left text-[11px] font-normal break-all text-ink">
                      {page.path}
                      {page.isEntry && <span className="ml-1 text-[11px] text-muted">（入力 URL）</span>}
                    </th>
                    <td className="px-1 py-1.5 text-right font-bold text-ink tabular-nums">{page.overall}</td>
                    <td
                      className="px-1 py-1.5 text-center font-bold"
                      style={{ color: page.grade.color }}
                    >
                      {page.grade.grade}
                    </td>
                    {CATEGORY_ORDER.map((id) => (
                      <HeatCell key={id} score={page.scores[id] ?? 0} className="px-1!" />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {restOnScreen > 0 && (
        <div className="no-print mt-3">
          <Button variant="secondary" size="sm" onClick={() => setVisibleChunks((n) => n + 1)}>
            次の {Math.min(ROWS_PER_CHUNK, restOnScreen)} ページを表示（残り {fmt(restOnScreen)} ページ）
          </Button>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        セルの色: 80 以上 = 合格域 / 50〜79 = 警告域 / 50 未満 = 重大域。
        {overflow > 0 && (
          <>
            {" "}
            PDF・印刷には上位 <Num>{fmt(PDF_MAX_ROWS)}</Num> ページまで掲載します（残り <Num>{fmt(overflow)}</Num>{" "}
            ページは付録 A の一覧をご覧ください）。
          </>
        )}
      </p>
    </ReportSection>
  );
}
