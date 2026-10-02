/**
 * デザイントークンの写し（docs/dev/design-spec.md §1）。
 *
 * `src/app/globals.css` の `@theme` と同じ hex を持つ。チャート（SVG）の
 * `fill` / `stroke` は CSS 変数やユーティリティクラスではなく、必ずここから
 * 取る（html2canvas-pro の PDF 化・印刷でも同じ色になるようにするため）。
 * 両方を同時に更新すること。`src/lib/ui/__tests__/palette.test.ts` が
 * globals.css との一致を検証する。
 */
export const palette = {
  surface: "#f6f8f9",
  panel: "#ffffff",
  ink: "#111c22",
  muted: "#5a6a75",
  line: "#e2e8ec",
  brand: "#1b3a63",
  onBrand: "#ffffff",
  onBrandMuted: "#a9bcd4",
  accent: "#00786d",
  accentStrong: "#005f56",
  accentSoft: "#e3f3f0",
  secondary: "#5a6a75",
  pass: "#15803d",
  passSoft: "#e7f5ec",
  warn: "#a35a00",
  warnSoft: "#fbf0df",
  fail: "#b91c1c",
  failSoft: "#fbeaea",
  info: "#1d4ed8",
  infoSoft: "#e8eefc",
  chart: ["#00897c", "#c2410c", "#2563eb", "#a21caf", "#65a30d", "#0891b2"] as const,
  chartTrack: "#eef2f4",
  chartGrid: "#e2e8ec",
  grade: { A: "#0f7a43", B: "#3f7a33", C: "#a35a00", D: "#b4531b", E: "#b91c1c" } as const,
} as const;

/** 判定の 4 区分。info は採点対象外 */
export type StatusTone = "pass" | "warn" | "fail" | "info";

/** 採点される 3 区分（スコアから決まる） */
export type ScoreTone = Exclude<StatusTone, "info">;

export type Grade = "A" | "B" | "C" | "D" | "E";

export interface GradeBand {
  grade: Grade;
  /** この点数以上でこのグレード */
  min: number;
  /** 帯ラベル */
  label: string;
}

/**
 * グレードの閾値（唯一の定義）。ヒート表のセル色・カテゴリ数値の色・
 * ヒストグラムの区分はすべてここから引く。
 */
export const GRADE_BANDS: readonly GradeBand[] = [
  { grade: "A", min: 90, label: "優良" },
  { grade: "B", min: 80, label: "良好" },
  { grade: "C", min: 65, label: "改善余地あり" },
  { grade: "D", min: 50, label: "要改善" },
  { grade: "E", min: 0, label: "要対策" },
] as const;

/** 判定の閾値。80 以上 = 合格域、50〜79 = 警告域、50 未満 = 重大域 */
export const TONE_THRESHOLDS = { pass: 80, warn: 50 } as const;

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

/** スコア（0-100）→ 判定区分 */
export function scoreTone(score: number): ScoreTone {
  const s = clampScore(score);
  if (s >= TONE_THRESHOLDS.pass) return "pass";
  if (s >= TONE_THRESHOLDS.warn) return "warn";
  return "fail";
}

export interface GradeInfo {
  grade: Grade;
  label: string;
  /** グレード色（hex）。SVG の fill / stroke にそのまま使う */
  color: string;
  /** 範囲（表示用） */
  min: number;
  max: number;
}

/** スコア（0-100）→ グレード A〜E */
export function gradeOf(score: number): GradeInfo {
  const s = clampScore(score);
  const idx = GRADE_BANDS.findIndex((b) => s >= b.min);
  const band = GRADE_BANDS[idx === -1 ? GRADE_BANDS.length - 1 : idx];
  const upper = idx <= 0 ? 100 : GRADE_BANDS[idx - 1].min - 1;
  return { grade: band.grade, label: band.label, color: palette.grade[band.grade], min: band.min, max: upper };
}

/** グレード → 帯ラベル */
export function gradeLabel(grade: Grade): string {
  return GRADE_BANDS.find((b) => b.grade === grade)?.label ?? "";
}

/** 判定区分 → 文字 / 塗り色と地色（hex） */
export function toneColors(tone: StatusTone): { fg: string; bg: string } {
  switch (tone) {
    case "pass":
      return { fg: palette.pass, bg: palette.passSoft };
    case "warn":
      return { fg: palette.warn, bg: palette.warnSoft };
    case "fail":
      return { fg: palette.fail, bg: palette.failSoft };
    case "info":
      return { fg: palette.info, bg: palette.infoSoft };
  }
}

/** 判定区分 → Tailwind クラス（文字色 / 地色 / 枠色）。ピルやヒート表で使う */
export const TONE_CLASSES: Record<StatusTone, { text: string; bg: string; border: string }> = {
  pass: { text: "text-pass", bg: "bg-pass-soft", border: "border-pass" },
  warn: { text: "text-warn", bg: "bg-warn-soft", border: "border-warn" },
  fail: { text: "text-fail", bg: "bg-fail-soft", border: "border-fail" },
  info: { text: "text-info", bg: "bg-info-soft", border: "border-info" },
};

/** 判定区分の日本語ラベル */
export const TONE_LABELS: Record<StatusTone, string> = {
  pass: "合格",
  warn: "警告",
  fail: "重大",
  info: "情報",
};
