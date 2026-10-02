import { round } from "./math";

export interface SegmentBarSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * 1 本の横棒を区分で分ける（例: 配点構成 20/25/20/15/20）。400×12、ラベルは HTML。
 */
export function SegmentBar({
  segments,
  ariaLabel,
  className = "",
}: {
  segments: readonly SegmentBarSegment[];
  ariaLabel?: string;
  className?: string;
}) {
  const W = 400;
  const H = 12;
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  if (total <= 0) return <p className={`text-[13px] text-muted ${className}`}>表示できるデータがありません。</p>;
  const aria = ariaLabel ?? segments.map((s) => `${s.label} ${s.value}`).join("、");
  // 各区分の x 位置を先に積算しておく
  const placed = segments.reduce<Array<{ seg: SegmentBarSegment; x: number; w: number }>>((acc, seg) => {
    const x = acc.length > 0 ? acc[acc.length - 1].x + acc[acc.length - 1].w : 0;
    const w = round((Math.max(0, seg.value) / total) * W, 2);
    acc.push({ seg, x: round(x, 2), w });
    return acc;
  }, []);
  return (
    <figure className={className}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria} className="block h-3 w-full">
        <title>{aria}</title>
        {placed.map(({ seg, x, w }) => (
          <rect key={seg.label} x={x} y={0} width={w} height={H} fill={seg.color} />
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-3 w-3 rounded-lg" style={{ backgroundColor: s.color }} />
            {s.label} <span className="tabular-nums">{s.value}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
