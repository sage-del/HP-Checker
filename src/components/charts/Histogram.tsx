import { palette } from "@/lib/ui/palette";
import { clamp, niceMax, round } from "./math";

export interface HistogramBand {
  /** 例: "E" */
  label: string;
  /** 例: "0–49" */
  sublabel?: string;
  count: number;
  /** palette の hex。既定 chart-1 */
  color?: string;
}

export interface HistogramProps {
  bands: readonly HistogramBand[];
  /** 既定 140 */
  height?: number;
  /** グリッド線の本数。既定 4 */
  gridSteps?: number;
  /** 横方向の位置（0〜1）に縦の破線を引く（例: 平均点の位置） */
  marker?: { fraction: number; label?: string };
  ariaLabel?: string;
  className?: string;
}

const SLOT = 64;
const BAR = 40;
const TOP = 14;

/**
 * 区分ごとの件数（ページ別スコア分布など）。柱は SVG、x ラベルは HTML。
 * SVG 内の <text> は柱の上の件数だけ。
 */
export function Histogram({ bands, height = 140, gridSteps = 4, marker, ariaLabel, className = "" }: HistogramProps) {
  if (bands.length === 0) {
    return <p className={`text-[13px] text-muted ${className}`}>表示できるデータがありません。</p>;
  }
  const width = bands.length * SLOT;
  const maxCount = Math.max(0, ...bands.map((b) => (Number.isFinite(b.count) ? b.count : 0)));
  const yMax = niceMax(maxCount, gridSteps);
  const plotH = height - TOP;
  const y = (v: number) => round(TOP + plotH - (clamp(v, 0, yMax) / yMax) * plotH, 2);
  const aria = ariaLabel ?? bands.map((b) => `${b.label}${b.sublabel ? `（${b.sublabel}）` : ""} ${b.count}件`).join("、");

  return (
    <figure className={`max-w-full ${className}`} style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria} className="block h-auto w-full">
        <title>{aria}</title>
        {Array.from({ length: gridSteps + 1 }, (_, i) => {
          const gy = y((yMax / gridSteps) * i);
          return <line key={i} x1={0} x2={width} y1={gy} y2={gy} stroke={palette.chartGrid} strokeWidth={1} />;
        })}
        {bands.map((b, i) => {
          const x = 16 + i * SLOT + (SLOT - 16 - BAR) / 2 - 4;
          const count = Number.isFinite(b.count) ? Math.max(0, b.count) : 0;
          const top = y(count);
          const h = round(TOP + plotH - top, 2);
          return (
            <g key={b.label}>
              {h > 0 && <rect x={round(x, 2)} y={top} width={BAR} height={h} fill={b.color ?? palette.chart[0]} />}
              <text
                x={round(x + BAR / 2, 2)}
                y={round(top - 3, 2)}
                fontSize={11}
                fill={palette.ink}
                textAnchor="middle"
                fontFamily="inherit"
              >
                {count}
              </text>
            </g>
          );
        })}
        {marker && (
          <line
            x1={round(clamp(marker.fraction, 0, 1) * width, 2)}
            x2={round(clamp(marker.fraction, 0, 1) * width, 2)}
            y1={TOP}
            y2={height}
            stroke={palette.secondary}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <figcaption
        className="grid text-center"
        style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}
      >
        {bands.map((b) => (
          <div key={b.label} className="leading-tight">
            <div className="text-[13px] font-bold text-ink">{b.label}</div>
            {b.sublabel && <div className="text-[11px] text-muted tabular-nums">{b.sublabel}</div>}
          </div>
        ))}
      </figcaption>
      {marker?.label && (
        <p className="mt-1 text-[11px] text-muted">
          <span aria-hidden style={{ color: palette.secondary }}>
            ┆
          </span>{" "}
          {marker.label}
        </p>
      )}
    </figure>
  );
}
