import type { ReactNode } from "react";

export interface StatStripItem {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  className?: string;
}

/** KPI ストリップ。grid-cols-N divide-x border-y。総合評価とツール側で共用 */
export function StatStrip({ items, className = "" }: { items: StatStripItem[]; className?: string }) {
  const cols =
    items.length <= 2 ? "grid-cols-2" : items.length === 3 ? "grid-cols-3" : items.length === 4 ? "grid-cols-4" : "grid-cols-2 @md:grid-cols-5";
  return (
    <dl className={`grid ${cols} divide-x divide-line border-y border-line py-3 ${className}`}>
      {items.map((it, i) => (
        <div key={i} className={`px-3 text-center ${it.className ?? ""}`}>
          <dd className="text-[22px] font-bold leading-none text-ink tabular-nums">
            {it.value}
            {it.unit && <span className="ml-0.5 text-[11px] font-normal text-muted">{it.unit}</span>}
          </dd>
          <dt className="mt-1 text-[11px] text-muted">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}
