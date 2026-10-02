/**
 * 無料診断レポートの「導出済みサマリー」の型。
 *
 * 画面（src/components/free）は AnalysisResult / SiteAnalysisResult を直接いじらず、
 * ここで定義した形に変換したものを描くだけにする。導出はすべて純関数で、LLM は使わない。
 */
import type {
  CategoryId,
  CheckStatus,
  SiteCheckSummary,
} from "@/lib/analyzer/types";
import type { Grade, GradeInfo, ScoreTone } from "@/lib/ui/palette";

/** 講評の 1 行。数値は { num } で分け、画面側で tabular-nums の span に包む */
export type CommentaryPart = string | { num: string };
export type CommentaryLine = CommentaryPart[];

/** 判定の件数。page では項目数、site ではページ × 項目の判定数 */
export interface StatusCounts {
  pass: number;
  warn: number;
  fail: number;
  /** 採点対象外 */
  info: number;
  /** 採点対象（pass + warn + fail） */
  scored: number;
}

export interface CategoryRow {
  id: CategoryId;
  label: string;
  /** page: スコア / site: 全ページ平均 */
  score: number;
  /** 総合スコアの配点（CATEGORY_WEIGHTS） */
  weight: number;
  tone: ScoreTone;
  grade: GradeInfo;
  /** site のみ */
  min?: number;
  max?: number;
  /** site のみ: 最低点のページ */
  worstUrl?: string;
}

/** 優先改善 TOP3 の 1 行 */
export interface Improvement {
  id: string;
  label: string;
  category: CategoryId;
  categoryLabel: string;
  status: CheckStatus;
  /** 合格にしたときの総合スコアの見込み加点（小数） */
  gain: number;
  /** 「+3 点」「+1 点未満」 */
  gainLabel: string;
  /** 判定根拠（site は該当ページの 1 件目） */
  evidence?: string;
  /** どう直すか（CheckResult.advice / SiteCheckSummary.advice） */
  advice?: string;
  /** site のみ: 該当（未対応 + 改善余地）ページ数 */
  affectedPages?: number;
  /** site のみ: affectedPages と同じ値（PriorityItem と名前を揃えた別名） */
  affectedCount?: number;
  /** site のみ: 該当ページの URL（未対応 → 改善余地の順）。画面側で先頭 N 件だけ出す */
  affectedUrls?: string[];
  totalPages?: number;
  spread?: "uniform" | "mixed";
}

/** ページ別スコア分布の 1 区分（A〜E） */
export interface ScoreBand {
  grade: Grade;
  label: string;
  /** 「0–49」 */
  range: string;
  min: number;
  max: number;
  count: number;
  color: string;
}

export interface RankedPage {
  /** 1 始まり */
  rank: number;
  url: string;
  path: string;
  overall: number;
  grade: GradeInfo;
  scores: Record<CategoryId, number>;
  isEntry: boolean;
}

/** 優先改善リストの 1 行（site） */
export interface PriorityItem {
  id: string;
  label: string;
  category: CategoryId;
  categoryLabel: string;
  weight: number;
  counts: Record<CheckStatus, number>;
  spread: "uniform" | "mixed";
  /** 最も悪い判定 */
  worst: CheckStatus;
  /** pass 以外のページ数 */
  affectedCount: number;
  totalPages: number;
  affected: SiteCheckSummary["affected"];
  advice?: string;
  /** 並び替えキー: 未対応ページ数 × 配点 */
  priority: number;
  /** 副キー: 改善余地ページ数 × 配点 */
  secondary: number;
}

/** サイト全体（全ページ）のレポートサマリー。画面が描くのはこれだけ */
export interface SiteReportSummary {
  overall: number;
  grade: GradeInfo;
  counts: StatusCounts;
  categories: CategoryRow[];
  /** 最も評価が高い / 低いカテゴリ（同点は CATEGORY_ORDER の先頭） */
  best: CategoryRow;
  worst: CategoryRow;
  /** 優先改善の全件（見込み加点の降順）。画面側は任意の件数で切って使う */
  improvements: Improvement[];
  /** improvements の先頭 3 件 */
  top3: Improvement[];
  /** TOP3 に対応したときの見込み総合スコア（100 で頭打ち） */
  projected: number;
  projectedGrade: GradeInfo;
  /** 講評（2〜3 行） */
  commentary: CommentaryLine[];
  pageCount: number;
  bestPage: RankedPage;
  worstPage: RankedPage;
  /** E → A の順 */
  bands: ScoreBand[];
  average: number;
  median: number;
  /** 最もページ数が多い区分 */
  modeBand: ScoreBand;
  /** 平均点の位置（ヒストグラムの横方向 0〜1） */
  averageFraction: number;
  /** 全ページで未対応の項目数 */
  uniformFailCount: number;
  /** 総合の低い順（入力 URL は先頭固定） */
  rankedPages: RankedPage[];
  priorities: PriorityItem[];
}

