import { palette } from "@/lib/ui/palette";
import { clamp, round } from "./math";

export interface LinePoint {
  /** 目盛に出すラベル（日付など） */
  label: string;
  /** 値。null は欠測（診断できなかった回）で、線を切る */
  value: number | null;
}

export interface LineChartProps {
  /** 古い順 */
  points: readonly LinePoint[];
  /** 既定 100 */
  max?: number;
  /** 既定 [50, 80]（判定の境目） */
  ticks?: readonly number[];
  ariaLabel: string;
  className?: string;
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 28 };

/**
 * スコアの推移（折れ線）。色は palette から直接取る（印刷・PDF でも同じ色にするため）。
 * 点が多いときは目盛のラベルを間引く。
 */
export function LineChart({ points, max = 100, ticks = [50, 80], ariaLabel, className = "" }: LineChartProps) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i: number) => round(PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1)));
  const y = (v: number) => round(PAD.top + innerH * (1 - clamp(v, 0, max) / max));

  // 欠測で線を切る
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${x(i)},${y(p.value)}`);
  });
  if (current.length) segments.push(current.join(" "));

  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full ${className}`} role="img" aria-label={ariaLabel}>
      {[0, ...ticks, max].map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={palette.chartGrid} strokeDasharray={t === 0 || t === max ? undefined : "3 3"} />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={palette.muted}>
            {t}
          </text>
        </g>
      ))}
      {segments.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke={palette.chart[0]} strokeWidth="2.5" strokeLinejoin="round" />
      ))}
      {points.map((p, i) =>
        p.value === null ? (
          <text key={i} x={x(i)} y={y(0) - 4} textAnchor="middle" fontSize="11" fill={palette.fail}>
            ×
          </text>
        ) : (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={n > 40 ? 2 : 3.5} fill={palette.panel} stroke={palette.chart[0]} strokeWidth="2" />
        ),
      )}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={palette.muted}>
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
