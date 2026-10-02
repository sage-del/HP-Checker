import type { ReactNode, TdHTMLAttributes } from "react";
import { scoreTone, type ScoreTone } from "@/lib/ui/palette";

const HEAT_CLASS: Record<ScoreTone, string> = {
  pass: "bg-pass-soft",
  warn: "bg-warn-soft",
  fail: "bg-fail-soft",
};

/** スコア → Tailwind の地色クラス（HTML 表用） */
export function heatCellClass(score: number): string {
  return HEAT_CLASS[scoreTone(score)];
}

export interface HeatCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  score: number;
  children?: ReactNode;
}

/**
 * ヒート表の <td>。地色は判定（80 / 50）、文字は ink の tabular 右寄せ。
 * 数値を併記するので背景オフの印刷でも読める。
 */
export function HeatCell({ score, children, className = "", ...rest }: HeatCellProps) {
  return (
    <td className={`${heatCellClass(score)} px-2 py-1.5 text-right text-ink tabular-nums ${className}`} {...rest}>
      {children ?? Math.round(score)}
    </td>
  );
}
