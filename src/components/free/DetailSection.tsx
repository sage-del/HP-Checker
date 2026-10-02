/**
 * 改善提案（詳細）。
 * - page: カテゴリごとに全項目を「判定ピル / 項目 / 根拠 / 左罫の対応方法」で並べる（§3.2-4）
 * - site: 「全ページ共通の問題」と「ページによって差がある項目」の 2 群（§3.3-5）
 */
import { Badge } from "@/components/ui";
import { fmt, pathOf, type PriorityItem, type SiteReportSummary } from "@/lib/report";
import { TONE_LABELS } from "@/lib/ui/palette";
import { Advice, EmptyLine, Num, ReportSection, SubHeading } from "./report-parts";

/** 該当ページの列挙はこの件数まで（PDF の 1 要素が長くなりすぎないように） */
const MAX_AFFECTED = 8;

export function SiteDetailSection({
  summary,
  number,
}: {
  summary: SiteReportSummary;
  number: number;
}) {
  const uniform = summary.priorities.filter((p) => p.spread === "uniform");
  const mixed = summary.priorities.filter((p) => p.spread === "mixed");
  return (
    <ReportSection
      number={number}
      title="改善提案（詳細）"
      lead="全ページ共通の問題は、共通テンプレートやサイト設定を 1 箇所直せば全ページに効きます。ページによって差がある項目は、該当ページだけの対応で済みます。"
    >
      <SubHeading note="テンプレート・サイト設定の修正で全ページ改善">全ページ共通の問題</SubHeading>
      <PriorityList items={uniform} emptyText="全ページ共通で問題になっている項目はありません。" />
      <SubHeading note="ページ間でスコアが変わる原因">ページによって差がある項目</SubHeading>
      <PriorityList items={mixed} emptyText="ページ間で判定が分かれた項目はありません。" />
    </ReportSection>
  );
}

function PriorityList({ items, emptyText }: { items: PriorityItem[]; emptyText: string }) {
  if (items.length === 0) return <EmptyLine>{emptyText}</EmptyLine>;
  return (
    <ul>
      {items.map((item) => {
        // 全ページ共通の項目は、同じ根拠がページ数だけ並ぶだけなので 1 行にまとめる
        const uniform = item.spread === "uniform";
        const shown = uniform ? [] : item.affected.slice(0, MAX_AFFECTED);
        // 残り件数は affectedCount（全ページ分の実数）から数える。
        // affected はサーバー側で実例の上限まで間引かれている（site.ts の MAX_AFFECTED_SAMPLES）
        const rest = uniform ? 0 : Math.max(0, item.affectedCount - shown.length);
        const sample = item.affected.find((a) => a.evidence)?.evidence;
        return (
          <li key={item.id} className="grid grid-cols-[5.5rem_1fr] gap-3 border-b border-line py-3">
            <div>
              <Badge tone={item.worst}>{TONE_LABELS[item.worst]}</Badge>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-[14px] leading-snug text-ink">{item.label}</p>
                <p className="shrink-0 text-[12px] text-muted tabular-nums">
                  {fmt(item.affectedCount)} / {fmt(item.totalPages)} ページ
                </p>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {item.categoryLabel}
                {item.worst !== "info" && (
                  <>
                    ・配点 <Num>{item.weight}</Num>
                  </>
                )}
                {item.counts.fail > 0 && (
                  <>
                    ・重大 <Num>{fmt(item.counts.fail)}</Num> ページ
                  </>
                )}
                {item.counts.warn > 0 && (
                  <>
                    ・警告 <Num>{fmt(item.counts.warn)}</Num> ページ
                  </>
                )}
              </p>
              {uniform && (
                <p className="mt-1 text-[12px] leading-relaxed break-words text-muted">
                  該当ページはすべて同じ状態です{sample ? ` — ${sample}` : ""}
                </p>
              )}
              {shown.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {shown.map((a) => (
                    <li key={a.url} className="text-[12px] leading-relaxed break-all text-muted">
                      ・{pathOf(a.url)}
                      {a.evidence ? ` — ${a.evidence}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {rest > 0 && (
                <p className="mt-1 text-[12px] text-muted">
                  …他 <Num>{fmt(rest)}</Num> ページ（付録 A の一覧をご覧ください）
                </p>
              )}
              {item.advice && <Advice>{item.advice}</Advice>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
