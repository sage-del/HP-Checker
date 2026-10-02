import type { ReactNode } from "react";

/** セルの既定表示に使う値（render を省いた列で使う） */
export type CellValue = string | number | null | undefined;

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** セルの描画。省略時は accessor の値をそのまま出す */
  render?: (row: T, index: number) => ReactNode;
  /** 既定表示に使う値 */
  accessor?: (row: T) => CellValue;
  align?: "left" | "right" | "center";
  /** 例: "8rem"。省略時は自動 */
  width?: string;
  nowrap?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T, index: number) => string;
  emptyText?: ReactNode;
  caption?: ReactNode;
  /** 行を詰める（行高 32px） */
  dense?: boolean;
  /** thead を sticky にする（画面のみ） */
  stickyHeader?: boolean;
  /** 横スクロール時の最小幅（例: "34rem"） */
  minWidth?: string;
  className?: string;
  rowClassName?: (row: T, index: number) => string | undefined;
}

const ALIGN = { left: "text-left", right: "text-right tabular-nums", center: "text-center" } as const;

/**
 * 汎用の表。thead 12px / 700 / muted、本文 13px、行罫 1px line。
 * ラッパーは `overflow-x-auto`（印刷・PDF の両経路で解除される）。
 * 並び替えは持たない（レポートは決まった順で読ませ、そのまま PDF にする）。
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  emptyText = "表示できるデータがありません。",
  caption,
  dense = false,
  stickyHeader = true,
  minWidth,
  className = "",
  rowClassName,
}: DataTableProps<T>) {
  const cell = dense ? "px-2 py-1.5" : "px-2 py-2";

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-[13px] text-ink" style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="mb-2 text-left text-[12px] text-muted">{caption}</caption>}
        <thead className={stickyHeader ? "sticky top-0 z-[1] bg-panel" : "bg-panel"}>
          <tr className="border-b border-line text-[12px] font-bold text-muted">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={`${cell} font-bold ${ALIGN[col.align ?? "left"]} ${col.nowrap ? "whitespace-nowrap" : ""} ${col.className ?? ""}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-[13px] text-muted">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={`border-b border-line last:border-0 ${rowClassName?.(row, i) ?? ""}`}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${cell} align-top ${ALIGN[col.align ?? "left"]} ${col.nowrap ? "whitespace-nowrap" : ""} ${col.className ?? ""}`}
                  >
                    {col.render ? col.render(row, i) : (col.accessor?.(row) ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
