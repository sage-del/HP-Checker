/**
 * チャートの計算（純関数）。SVG の path / dasharray を組み立てる。
 * 角度は「12 時の位置を 0°、時計回り」で扱う。
 */

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** 小数を丸める（属性に長い小数を書かないため） */
export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: round(cx + r * Math.cos(rad), 3), y: round(cy + r * Math.sin(rad), 3) };
}

export function circumference(r: number): number {
  return round(2 * Math.PI * r, 1);
}

/**
 * ゲージ用の dasharray / dashoffset。value / max の割合だけ線を出す。
 * circle に `transform="rotate(-90 cx cy)"` を付けて 12 時から始める。
 */
export function donutDash(value: number, max: number, circ: number): { dasharray: string; dashoffset: number } {
  const ratio = max > 0 ? clamp(value, 0, max) / max : 0;
  const len = round(circ * ratio, 2);
  return { dasharray: `${len} ${circ}`, dashoffset: 0 };
}

/**
 * 塗りつぶしの扇形（rInner > 0 なら環状）。ドーナツ / 円グラフの 1 区分。
 */
export function ringSegmentPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = endDeg - startDeg;
  if (sweep <= 0) return "";
  if (sweep >= 360) {
    // 外周を時計回り、内周を反時計回りに描いて穴を空ける（evenodd 不要）
    const oTop = polarToCartesian(cx, cy, rOuter, 0);
    const oBottom = polarToCartesian(cx, cy, rOuter, 180);
    const outer = `M ${oTop.x} ${oTop.y} A ${rOuter} ${rOuter} 0 1 1 ${oBottom.x} ${oBottom.y} A ${rOuter} ${rOuter} 0 1 1 ${oTop.x} ${oTop.y} Z`;
    if (rInner <= 0) return outer;
    const iTop = polarToCartesian(cx, cy, rInner, 0);
    const iBottom = polarToCartesian(cx, cy, rInner, 180);
    return `${outer} M ${iTop.x} ${iTop.y} A ${rInner} ${rInner} 0 1 0 ${iBottom.x} ${iBottom.y} A ${rInner} ${rInner} 0 1 0 ${iTop.x} ${iTop.y} Z`;
  }
  const large = sweep > 180 ? 1 : 0;
  const os = polarToCartesian(cx, cy, rOuter, startDeg);
  const oe = polarToCartesian(cx, cy, rOuter, endDeg);
  if (rInner <= 0) {
    return `M ${cx} ${cy} L ${os.x} ${os.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${oe.x} ${oe.y} Z`;
  }
  const is = polarToCartesian(cx, cy, rInner, startDeg);
  const ie = polarToCartesian(cx, cy, rInner, endDeg);
  return `M ${os.x} ${os.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${oe.x} ${oe.y} L ${ie.x} ${ie.y} A ${rInner} ${rInner} 0 ${large} 0 ${is.x} ${is.y} Z`;
}

export interface SegmentAngle {
  index: number;
  start: number;
  end: number;
  fraction: number;
}

/** 値の配列 → 各区分の開始 / 終了角（0 の区分は含めない） */
export function segmentAngles(values: readonly number[]): SegmentAngle[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const out: SegmentAngle[] = [];
  let acc = 0;
  safe.forEach((v, index) => {
    if (v <= 0) return;
    const fraction = v / total;
    const start = round((acc / total) * 360, 3);
    acc += v;
    const end = round((acc / total) * 360, 3);
    out.push({ index, start, end, fraction });
  });
  // 丸め誤差で最後が 360 に届かないことがあるので合わせる
  if (out.length > 0) out[out.length - 1].end = 360;
  return out;
}

/**
 * 軸の上限を「きりのよい値」に丸める。steps 本のグリッド線が整数刻みになる。
 * 例: (61, 4) → 80、(3, 4) → 4、(0, 4) → 4
 */
export function niceMax(max: number, steps = 4): number {
  if (!Number.isFinite(max) || max <= 0) return steps;
  if (max <= steps) return steps;
  const rawStep = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return round(nice * magnitude * steps, 6);
}

/** 百分率の表示（合計 100 になるよう最大剰余法で丸める） */
export function percentages(values: readonly number[]): number[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return safe.map(() => 0);
  const raw = safe.map((v) => (v / total) * 100);
  const floors = raw.map((r) => Math.floor(r));
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (safe[i] > 0) {
      floors[i] += 1;
      rest -= 1;
    }
  }
  return floors;
}
