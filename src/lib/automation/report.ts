import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import { buildSiteSummary } from "@/lib/report";
import type { Ga4OrganicReport, GscSearchReport, SeoDateRange } from "@/lib/google/types";

export interface SeoOpportunity {
  source: "site-audit" | "gsc" | "ga4";
  kind: "technical" | "low-ctr" | "striking-distance" | "low-engagement";
  priority: number;
  title: string;
  page?: string;
  query?: string;
  evidence: string;
  action: string;
}

export function resolveSeoDateRange(
  input: { startDate?: unknown; endDate?: unknown },
  now = new Date(),
): SeoDateRange {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  const startDate = input.startDate ?? start.toISOString().slice(0, 10);
  const endDate = input.endDate ?? end.toISOString().slice(0, 10);
  if (typeof startDate !== "string" || !datePattern.test(startDate)) {
    throw new Error("startDate は YYYY-MM-DD 形式で指定してください");
  }
  if (typeof endDate !== "string" || !datePattern.test(endDate)) {
    throw new Error("endDate は YYYY-MM-DD 形式で指定してください");
  }
  const startTime = Date.parse(`${startDate}T00:00:00Z`);
  const endTime = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
    throw new Error("startDate は endDate 以前の日付にしてください");
  }
  return { startDate, endDate };
}

function percent(value: number | null): string {
  return value === null ? "未取得" : `${(value * 100).toFixed(1)}%`;
}

export function buildSeoOpportunities(
  audit: SiteAnalysisResult,
  ga4: Ga4OrganicReport,
  gsc: GscSearchReport,
  limit = 20,
): SeoOpportunity[] {
  const summary = buildSiteSummary(audit);
  const opportunities: SeoOpportunity[] = summary.improvements.slice(0, 5).map((item) => ({
    source: "site-audit",
    kind: "technical",
    priority: 90 + Math.min(10, Math.round(item.gain)),
    title: item.label,
    page: item.affectedUrls?.[0],
    evidence: item.evidence || `${item.affectedCount ?? 0}ページで要改善`,
    action: item.advice || "対象ページの診断根拠を確認して修正してください",
  }));

  for (const row of gsc.queryPages) {
    if (row.impressions >= 100 && row.ctr < 0.03 && row.position <= 20) {
      opportunities.push({
        source: "gsc",
        kind: "low-ctr",
        priority: Math.min(95, 60 + Math.round(Math.log10(row.impressions + 1) * 10)),
        title: `表示されているのにクリック率が低い検索語句「${row.query}」`,
        page: row.page,
        query: row.query,
        evidence: `${row.impressions}回表示、CTR ${percent(row.ctr)}、平均掲載順位 ${row.position.toFixed(1)}`,
        action: "検索意図に合わせて title と meta description を具体化し、検索結果で選ぶ理由を明示してください",
      });
    }
    if (row.impressions >= 30 && row.position >= 4 && row.position <= 20) {
      opportunities.push({
        source: "gsc",
        kind: "striking-distance",
        priority: Math.min(90, 50 + Math.round(Math.log10(row.impressions + 1) * 10)),
        title: `上位表示を狙える検索語句「${row.query}」`,
        page: row.page,
        query: row.query,
        evidence: `${row.impressions}回表示、${row.clicks}クリック、平均掲載順位 ${row.position.toFixed(1)}`,
        action: "不足している論点を本文に追加し、関連ページから内部リンクを集めてください",
      });
    }
  }

  for (const row of ga4.landingPages) {
    if (row.sessions >= 10 && row.engagementRate !== null && row.engagementRate < 0.5) {
      opportunities.push({
        source: "ga4",
        kind: "low-engagement",
        priority: Math.min(85, 45 + Math.round(Math.log10(row.sessions + 1) * 10)),
        title: `自然検索流入後のエンゲージメントが低いページ`,
        page: row.path,
        evidence: `${row.sessions}セッション、エンゲージメント率 ${percent(row.engagementRate)}`,
        action: "冒頭で検索意図への回答を示し、次に読む内容や問い合わせへの導線を改善してください",
      });
    }
  }

  const seen = new Set<string>();
  return opportunities
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      const key = `${item.kind}|${item.query ?? ""}|${item.page ?? ""}|${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

export function compactAudit(audit: SiteAnalysisResult) {
  const summary = buildSiteSummary(audit);
  return {
    entryUrl: audit.entryUrl,
    origin: audit.origin,
    fetchedAt: audit.fetchedAt,
    overall: summary.overall,
    grade: summary.grade.grade,
    pageCount: summary.pageCount,
    counts: summary.counts,
    categories: summary.categories.map(({ id, label, score, min, max, worstUrl }) => ({
      id,
      label,
      score,
      min,
      max,
      worstUrl,
    })),
    improvements: summary.improvements.slice(0, 20).map((item) => ({
      id: item.id,
      label: item.label,
      category: item.category,
      status: item.status,
      gain: item.gain,
      evidence: item.evidence,
      advice: item.advice,
      affectedCount: item.affectedCount,
      affectedUrls: item.affectedUrls?.slice(0, 20),
    })),
    crawl: audit.crawl,
    notes: audit.notes,
  };
}
