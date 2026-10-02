/**
 * レポートの小さな共通部品（番号付き見出し・講評・左罫の引用ブロックなど）。
 *
 * ここに置くのは「描くだけ」の部品で、数値の導出は src/lib/report/ が行う。
 * 色はトークン（Tailwind のユーティリティ）か src/lib/ui/palette.ts からだけ取る。
 */
import { Fragment, type ReactNode } from "react";
import type { SiteDiscovery } from "@/lib/analyzer/types";
import type { CommentaryLine } from "@/lib/report";
import { GRADE_BANDS } from "@/lib/ui/grade";

/** 「A 90〜」「B 80〜」… の各区分 */
const GRADE_SCALE_PARTS = GRADE_BANDS.map((band, i) =>
  i === GRADE_BANDS.length - 1
    ? `${band.grade} 〜${GRADE_BANDS[i - 1].min - 1}`
    : `${band.grade} ${band.min}〜`,
);

/**
 * 「判定基準: A 90〜 / B 80〜 / …」。
 *
 * 区分そのものは whitespace-nowrap で途中改行させないが、区切りの " / " は
 * span の外に出しておく。中に入れると span 間にも改行機会が無くなり、
 * 文字列全体が 1 つの塊になって紙（印刷 / PDF）で列からはみ出す。
 */
export function GradeScale() {
  return (
    <>
      判定基準:{" "}
      {GRADE_SCALE_PARTS.map((part, i) => (
        <Fragment key={part}>
          <span className="whitespace-nowrap">{part}</span>
          {i < GRADE_SCALE_PARTS.length - 1 ? " / " : ""}
        </Fragment>
      ))}
    </>
  );
}

/** ページの集め方（表紙・付録に出す） */
export const DISCOVERY_LABEL: Record<SiteDiscovery, string> = {
  sitemap: "sitemap.xml から収集",
  links: "内部リンクをたどって収集",
  "sitemap+links": "sitemap.xml と内部リンクから収集",
  "entry-only": "入力 URL のみ",
};

/** 数値は必ず tabular-nums の span に入れる（和文の中でも桁が揃う） */
export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{children}</span>;
}

export interface ReportSectionProps {
  /** 通し番号（「1」）または「付録 A」のような文字列 */
  number?: ReactNode;
  title: ReactNode;
  /** 見出し直下の導入 1 行 */
  lead?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * 番号付き h2 + 1px 罫線のセクション。PDF / 印刷の改ページ単位（print-card）。
 */
export function ReportSection({ number, title, lead, id, className = "", children }: ReportSectionProps) {
  return (
    <section id={id} className={`print-card mt-8 first:mt-0 ${className}`}>
      <h2 className="flex items-baseline gap-2 border-b border-line pb-2 text-[18px] font-bold text-ink">
        <span aria-hidden className="relative top-0.5 h-5 w-1 shrink-0 self-center bg-brand" />
        {number !== undefined && <span className="shrink-0 tabular-nums">{number}.</span>}
        <span className="min-w-0">{title}</span>
      </h2>
      {lead && <p className="mt-3 text-[13px] leading-relaxed text-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** h3（14px / 700）。右側に補足を置ける */
export function SubHeading({
  children,
  note,
  className = "",
}: {
  children: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-6 mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 first:mt-0 ${className}`}>
      <h3 className="text-[14px] font-bold text-ink">{children}</h3>
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  );
}

/** 改善方法。箱ではなく左罫の引用ブロック */
export function Advice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mt-2 border-l-2 border-accent pl-3 text-[13px] leading-relaxed text-ink ${className}`}>
      {children}
    </p>
  );
}

/** 講評 3 行。{ num } の部分だけ tabular-nums で強調する */
export function Commentary({ lines }: { lines: readonly CommentaryLine[] }) {
  return (
    <ul className="space-y-2">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2 text-[15px] leading-relaxed text-ink">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0">
            {line.map((part, j) =>
              typeof part === "string" ? (
                <span key={j}>{part}</span>
              ) : (
                <span key={j} className="font-bold tabular-nums">
                  {part.num}
                </span>
              ),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** データが無いときの 1 行帯（bg-surface）。ダミーは出さない */
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-surface px-3 py-2 text-[13px] text-muted">{children}</p>
  );
}

/** 付録の dl（ラベル 11px muted → 値 13px ink） */
export function KeyValue({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-line py-2">
      <dt className="text-[11px] text-muted">{term}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed break-words text-ink">{children}</dd>
    </div>
  );
}
