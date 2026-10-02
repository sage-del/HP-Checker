import type { ReactNode } from "react";
import { palette } from "@/lib/ui/palette";
import { percentages, ringSegmentPath, round, segmentAngles } from "./math";

export interface PieSegment {
  label: string;
  value: number;
  /** palette の hex */
  color: string;
}

export interface PieProps {
  segments: readonly PieSegment[];
  /** 既定 140 */
  size?: number;
  /** リングの太さ。0 で円グラフ（穴なし）。既定 18 */
  thickness?: number;
  /** 凡例表（■ / 区分 / 件数 / %）。0 件の行も残す */
  legend?: boolean;
  /** 中央の主表示（thickness > 0 のとき）。既定は合計件数 */
  centerLabel?: ReactNode;
  /** 中央の副表示。既定「判定」 */
  centerSub?: ReactNode;
  unit?: string;
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
}

/**
 * 判定内訳などの区分グラフ。区分ごとに塗りの扇形 path を描く。
 * 凡例・中央の数値は HTML。合計 0 のときはチャートを描かない。
 */
export function Pie({
  segments,
  size = 140,
  thickness = 18,
  legend = true,
  centerLabel,
  centerSub,
  unit = "件",
  ariaLabel,
  emptyText = "表示できるデータがありません。",
  className = "",
}: PieProps) {
  const total = segments.reduce((a, s) => a + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  const pct = percentages(segments.map((s) => s.value));
  const aria =
    ariaLabel ?? `${segments.map((s, i) => `${s.label} ${s.value}${unit}（${pct[i]}%）`).join("、")}`;
  const c = size / 2;
  const rOuter = c;
  const rInner = thickness > 0 ? round(c - thickness, 2) : 0;
  const angles = segmentAngles(segments.map((s) => s.value));

  return (
    <div className={`flex flex-wrap items-center gap-5 ${className}`}>
      {total <= 0 ? (
        <p className="text-[13px] text-muted">{emptyText}</p>
      ) : (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={aria}
            className="block h-auto max-w-full"
          >
            <title>{aria}</title>
            {angles.map((a) => (
              <path
                key={a.index}
                d={ringSegmentPath(c, c, rOuter, rInner, a.start, a.end)}
                fill={segments[a.index].color}
                stroke={angles.length > 1 ? palette.panel : "none"}
                strokeWidth={angles.length > 1 ? 1 : 0}
              />
            ))}
          </svg>
          {thickness > 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[22px] font-bold leading-none text-ink tabular-nums">{centerLabel ?? total}</div>
              <div className="mt-1 text-[11px] leading-none text-muted">{centerSub ?? "判定"}</div>
            </div>
          )}
        </div>
      )}
      {legend && (
        <table className="text-[13px] text-ink">
          <tbody>
            {segments.map((s, i) => (
              <tr key={s.label}>
                <td className="py-0.5 pr-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-lg align-middle"
                    style={{ backgroundColor: s.color }}
                  />
                </td>
                <td className="py-0.5 pr-4">{s.label}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">
                  {s.value.toLocaleString("ja-JP")}
                  <span className="ml-0.5 text-[11px] text-muted">{unit}</span>
                </td>
                <td className="py-0.5 text-right text-muted tabular-nums">{pct[i]}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
