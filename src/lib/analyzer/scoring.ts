import {
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type CategoryId,
  type CategoryScore,
  type CheckResult,
} from "./types";

const CATEGORY_ORDER: CategoryId[] = [
  "crawlers",
  "structuredData",
  "meta",
  "headings",
  "content",
  "trust",
  "contact",
  "performance",
  "security",
  "mobile",
];

/** カテゴリ内の獲得点 / 配点 を 0-100 に正規化する。info（配点 0）は無視 */
export function scoreCategory(checks: CheckResult[]): number {
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  if (total === 0) return 100;
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  return Math.round((earned / total) * 100);
}

export function buildCategories(checks: CheckResult[]): CategoryScore[] {
  return CATEGORY_ORDER.map((id) => {
    const own = checks.filter((c) => c.category === id);
    return { id, label: CATEGORY_LABELS[id], score: scoreCategory(own), checks: own };
  });
}

/** カテゴリ重みで加重平均した総合スコア */
export function overallScore(categories: CategoryScore[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const c of categories) {
    const w = CATEGORY_WEIGHTS[c.id];
    weighted += c.score * w;
    totalWeight += w;
  }
  return totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
}
