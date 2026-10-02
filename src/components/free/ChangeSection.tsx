/**
 * 前回の診断からの変化（再診断のとき、同じブラウザに前回の結果があれば出す）。
 * 比較の導出は src/lib/report/history.ts の純関数が行い、ここは描くだけ。
 */
import { Badge } from "@/components/ui";
import { fmt, formatDateTime, type DiagnosisComparison, type IssueChange } from "@/lib/report";
import { TONE_LABELS } from "@/lib/ui/palette";
import { EmptyLine, Num, ReportSection, SubHeading } from "./report-parts";

const TH = "border-b border-line px-2 py-2 text-left text-[12px] font-bold text-muted";
const TD = "border-b border-line px-2 py-1.5 text-[13px] text-ink tabular-nums";

/** 増減の表示。点数は増えると良く、件数は減ると良い */
function Delta({ value, better }: { value: number | null; better: "up" | "down" }) {
  if (value === null) return <span className="text-muted">—</span>;
  if (value === 0) return <span className="text-muted">±0</span>;
  const good = better === "up" ? value > 0 : value < 0;
  return (
    <span className={`font-bold ${good ? "text-pass" : "text-fail"}`}>
      {value > 0 ? "+" : "−"}
      {fmt(Math.abs(value))}
    </span>
  );
}

function StatusPill({ status }: { status: IssueChange["before"] }) {
  if (status === null) return <span className="text-[12px] text-muted">なし</span>;
  return <Badge tone={status}>{TONE_LABELS[status]}</Badge>;
}

function IssueList({ items, emptyText }: { items: IssueChange[]; emptyText: string }) {
  if (items.length === 0) return <EmptyLine>{emptyText}</EmptyLine>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-2">
          <span className="flex shrink-0 items-center gap-1">
            <StatusPill status={item.before} />
            <span aria-hidden className="text-muted">
              →
            </span>
            <StatusPill status={item.after} />
          </span>
          <span className="min-w-0 text-[13px] leading-snug text-ink">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChangeSection({ comparison, number }: { comparison: DiagnosisComparison; number: number | string }) {
  const { overall, counts } = comparison;
  const rows: { label: string; before: number; after: number; delta: number; better: "up" | "down" }[] = [
    { label: "総合スコア", ...overall, better: "up" },
    { label: "重大", ...counts.fail, better: "down" },
    { label: "警告", ...counts.warn, better: "down" },
    { label: "情報", ...counts.info, better: "down" },
  ];
  return (
    <ReportSection
      number={number}
      title="前回の診断からの変化"
      lead={
        <>
          前回（{formatDateTime(comparison.previousAt)}・<Num>{fmt(comparison.pageCount.before)}</Num> ページ）と今回（
          <Num>{fmt(comparison.pageCount.after)}</Num> ページ）の比較です。前回の結果は、この端末のブラウザに保存されたものを使っています。
        </>
      }
    >
      <div className="grid gap-6 @md:grid-cols-2">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[16rem]">
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  指標
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  前回
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  今回
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  変化
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className={`${TD} text-left font-bold`}>
                    {r.label}
                  </th>
                  <td className={`${TD} text-right`}>{fmt(r.before)}</td>
                  <td className={`${TD} text-right font-bold`}>{fmt(r.after)}</td>
                  <td className={`${TD} text-right`}>
                    <Delta value={r.delta} better={r.better} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">重大・警告・情報はページ × 項目の判定件数です。</p>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[16rem]">
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  カテゴリ
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  前回
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  今回
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  変化
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.categories.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className={`${TD} text-left font-normal whitespace-nowrap`}>
                    {c.label}
                  </th>
                  <td className={`${TD} text-right`}>{c.before === null ? "—" : c.before}</td>
                  <td className={`${TD} text-right font-bold`}>{c.after}</td>
                  <td className={`${TD} text-right`}>
                    <Delta value={c.delta} better="up" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {comparison.categories.some((c) => c.before === null) && (
            <p className="mt-2 text-[11px] text-muted">「—」は前回の診断に無かったカテゴリです。</p>
          )}
        </div>
      </div>

      <SubHeading note={`${comparison.resolved.length} 項目`}>解消した課題</SubHeading>
      <IssueList items={comparison.resolved} emptyText="前回から解消した重大・警告の項目はありません。" />
      <SubHeading note={`${comparison.appeared.length} 項目`}>新たに見つかった課題</SubHeading>
      <IssueList items={comparison.appeared} emptyText="前回から新たに増えた重大・警告の項目はありません。" />
      {comparison.changed.length > 0 && (
        <>
          <SubHeading note={`${comparison.changed.length} 項目`}>判定が変わった課題</SubHeading>
          <IssueList items={comparison.changed} emptyText="" />
        </>
      )}
    </ReportSection>
  );
}
