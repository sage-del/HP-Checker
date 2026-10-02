/**
 * グレード（A〜E）と判定（pass / warn / fail）の閾値。
 * 実体は palette.ts にある（トークンと同じファイルに置いて循環参照を避ける）。
 * 既存の `tone()` はこの `toneOf` に置き換える。
 */
export {
  GRADE_BANDS,
  TONE_THRESHOLDS,
  gradeOf,
  gradeLabel,
  scoreTone as toneOf,
  type Grade,
  type GradeBand,
  type GradeInfo,
  type ScoreTone,
} from "./palette";
