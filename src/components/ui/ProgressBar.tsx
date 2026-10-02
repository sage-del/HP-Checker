import type { ReactNode } from "react";

export interface ProgressBarProps {
  value?: number;
  max?: number;
  /** 進捗の説明（例: "ページを収集・取得しています — 12 / 128 ページ"） */
  label?: ReactNode;
  /** 分母が未確定のとき。バーが往復する（prefers-reduced-motion で静止） */
  indeterminate?: boolean;
  className?: string;
}

/**
 * 4px の進捗バー（トラック line、値 accent）。no-print 領域で使う。
 */
export function ProgressBar({ value = 0, max = 100, label, indeterminate = false, className = "" }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`no-print ${className}`}>
      {label && <div className="mb-2 text-[13px] text-ink">{label}</div>}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : value}
        aria-busy={indeterminate || undefined}
        className="relative h-1 w-full overflow-hidden rounded-full bg-line"
      >
        {indeterminate ? (
          <div className="progress-indeterminate absolute inset-y-0 left-0 w-[30%] rounded-full bg-accent" />
        ) : (
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}
