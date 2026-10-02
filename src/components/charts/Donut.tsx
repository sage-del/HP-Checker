import type { ReactNode } from "react";
import { gradeOf, palette } from "@/lib/ui/palette";
import { circumference, clamp, donutDash, round } from "./math";

export interface DonutProps {
  /** 0〜100 */
  value: number;
  /** 既定 160（r = 64, strokeWidth 14） */
  size?: number;
  thickness?: number;
  /** 中央の主表示。既定は value（40px / 700） */
  label?: ReactNode;
  /** 中央の副表示。既定「/100」 */
  sublabel?: ReactNode;
  /** 値の色。既定はグレード色 */
  color?: string;
  trackColor?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * 総合スコアのゲージ。トラック circle + 値 circle（strokeDasharray）。
 * 中央のラベルは HTML の absolute オーバーレイ（フォント・tabular-nums が効く）。
 */
export function Donut({
  value,
  size = 160,
  thickness = 14,
  label,
  sublabel,
  color,
  trackColor = palette.chartTrack,
  ariaLabel,
  className = "",
}: DonutProps) {
  const v = clamp(value, 0, 100);
  const c = size / 2;
  // 仕様: 160×160 で r=64（円周 402.1）。外側に 8px の余白、穴の直径は 114px（≥ 96px）
  const r = round(size * 0.4, 2);
  const circ = circumference(r);
  const dash = donutDash(v, 100, circ);
  const stroke = color ?? gradeOf(v).color;
  const aria = ariaLabel ?? `スコア ${Math.round(v)} / 100`;
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={aria}
        className="block h-auto max-w-full"
      >
        <title>{aria}</title>
        <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={thickness} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={thickness}
          strokeLinecap="butt"
          strokeDasharray={dash.dasharray}
          strokeDashoffset={dash.dashoffset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[40px] font-bold leading-none text-ink tabular-nums">{label ?? Math.round(v)}</div>
        <div className="mt-1 text-[12px] leading-none text-muted">{sublabel ?? "/100"}</div>
      </div>
    </div>
  );
}
