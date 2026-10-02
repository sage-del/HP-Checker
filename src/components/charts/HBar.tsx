import type { ReactNode } from "react";
import { palette, scoreTone, TONE_CLASSES } from "@/lib/ui/palette";
import { clamp, round } from "./math";

export interface HBarRow {
  label: ReactNode;
  value: number;
  /** 行ごとの上限（省略時は props.max） */
  max?: number;
  /** 棒の色（palette の hex）。既定 chart-1 */
  color?: string;
  /** 最低〜最高のレンジ帯（site モード） */
  range?: { min: number; max: number };
  /** 右側の数値表示を差し替える */
  valueLabel?: ReactNode;
  /** ラベルの下の補足（12px muted） */
  sublabel?: ReactNode;
}

export interface HBarProps {
  rows: readonly HBarRow[];
  /** 既定 100 */
  max?: number;
  /** 目盛。max=100 のとき既定 [50, 80] */
  ticks?: readonly number[];
  /** 右側の数値。max=100 なら判定色、それ以外は ink */
  valueTone?: "score" | "none";
  /** ラベル列の幅。既定 8rem */
  labelWidth?: string;
  /** 凡例（HTML 11px）。true で自動生成 */
  legend?: ReactNode | boolean;
  ariaLabel?: string;
  className?: string;
}

const W = 400;
const H = 16;

/**
 * 横棒（カテゴリ別スコア）。行は HTML グリッド、棒だけ SVG（400×16、幅は伸縮）。
 * 数値は棒の外（右）に置き、サブピクセルのずれに依存しない。
 */
export function HBar({
  rows,
  max = 100,
  ticks,
  valueTone = "score",
  labelWidth = "8rem",
  legend = true,
  ariaLabel,
  className = "",
}: HBarProps) {
  const tickList = ticks ?? (max === 100 ? [50, 80] : []);
  const hasRange = rows.some((r) => r.range);
  const scale = (v: number, m: number) => round((clamp(v, 0, m) / m) * W, 2);
  const legendNode =
    legend === true ? (
      <p className="mt-2 text-[11px] text-muted">
        <span className="mr-3">
          <span aria-hidden style={{ color: palette.chart[0] }}>
            ■
          </span>{" "}
          スコア{hasRange ? "（平均）" : ""}
        </span>
        {hasRange && (
          <span className="mr-3">
            <span aria-hidden style={{ color: palette.chart[2] }}>
              ▭
            </span>{" "}
            最低〜最高
          </span>
        )}
        {tickList.length > 0 && (
          <span>
            <span aria-hidden style={{ color: palette.secondary }}>
              ┆
            </span>{" "}
            目盛 {tickList.join(" / ")}
          </span>
        )}
      </p>
    ) : legend === false ? null : (
      legend
    );

  if (rows.length === 0) {
    return <p className={`text-[13px] text-muted ${className}`}>表示できるデータがありません。</p>;
  }

  return (
    <figure className={className} aria-label={ariaLabel}>
      <ul className="space-y-2">
        {rows.map((row, i) => {
          const m = row.max ?? max;
          const tone = valueTone === "score" && m === 100 ? scoreTone(row.value) : null;
          const rowAria = `${typeof row.label === "string" ? row.label : `項目 ${i + 1}`}: ${Math.round(row.value)} / ${m}${
            row.range ? `（最低 ${row.range.min}〜最高 ${row.range.max}）` : ""
          }`;
          return (
            <li
              key={i}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: `${labelWidth} 1fr 3.5rem` }}
            >
              <div className="min-w-0 text-[13px] text-ink">
                <div className="truncate">{row.label}</div>
                {row.sublabel && <div className="truncate text-[12px] text-muted">{row.sublabel}</div>}
              </div>
              <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={rowAria}
                className="block h-4 w-full"
              >
                <title>{rowAria}</title>
                <rect x={0} y={0} width={W} height={H} fill={palette.chartTrack} />
                {row.range && (
                  <rect
                    x={scale(row.range.min, m)}
                    y={0}
                    width={round(scale(row.range.max, m) - scale(row.range.min, m), 2)}
                    height={H}
                    fill={palette.chart[2]}
                  />
                )}
                <rect
                  x={0}
                  y={row.range ? 4 : 0}
                  width={scale(row.value, m)}
                  height={row.range ? 8 : H}
                  fill={row.color ?? palette.chart[0]}
                />
                {tickList.map((t) => (
                  <line
                    key={t}
                    x1={scale(t, m)}
                    x2={scale(t, m)}
                    y1={0}
                    y2={H}
                    stroke={palette.secondary}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ))}
              </svg>
              <div
                className={`text-right text-xl font-bold leading-none tabular-nums ${tone ? TONE_CLASSES[tone].text : "text-ink"}`}
              >
                {row.valueLabel ?? Math.round(row.value)}
              </div>
            </li>
          );
        })}
      </ul>
      {legendNode}
    </figure>
  );
}
