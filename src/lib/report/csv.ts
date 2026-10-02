/**
 * 課題一覧の CSV（純関数）。
 *
 * 1 行 = 1 つの課題 × 1 ページ。重大 → 警告 → 情報の順に並べ、社内の表計算ソフトで
 * 担当者を割り振ったり、対応状況を管理したりできるようにする。Excel で文字化け
 * しないよう、先頭に BOM を付けて UTF-8 で出す（付けるのはダウンロード側）。
 */
import { CATEGORY_LABELS, type CheckStatus, type SiteAnalysisResult } from "@/lib/analyzer/types";
import { TONE_LABELS } from "@/lib/ui/palette";
import { categoryIndex, checkWeight } from "./weights";

const SEVERITY: readonly CheckStatus[] = ["fail", "warn", "info"];

export const ISSUE_CSV_HEADER = [
  "重要度",
  "カテゴリ",
  "診断項目",
  "配点",
  "該当ページ数",
  "診断ページ数",
  "ページ URL",
  "判定根拠",
  "対応方法",
] as const;

/** RFC 4180 のクォート。数式として解釈される先頭文字（= + - @）は ' を前置する */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildIssuesCsv(result: SiteAnalysisResult): string {
  const pageCount = result.pages.length;
  const rows: (string | number)[][] = [];
  const checks = [...(result.checks ?? [])].sort((a, b) => {
    const worst = (c: typeof a) => SEVERITY.findIndex((s) => (c.counts?.[s] ?? 0) > 0);
    const wa = worst(a);
    const wb = worst(b);
    return (
      (wa === -1 ? 9 : wa) - (wb === -1 ? 9 : wb) ||
      categoryIndex(a.category) - categoryIndex(b.category) ||
      a.id.localeCompare(b.id)
    );
  });

  for (const c of checks) {
    const affected = [...(c.affected ?? [])].sort(
      (a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status) || a.url.localeCompare(b.url),
    );
    const affectedCount = SEVERITY.reduce((n, s) => n + (c.counts?.[s] ?? 0), 0);
    for (const a of affected) {
      if (a.status === "pass") continue;
      rows.push([
        TONE_LABELS[a.status],
        CATEGORY_LABELS[c.category] ?? c.category,
        c.label,
        a.status === "info" ? 0 : checkWeight(c.id),
        affectedCount,
        pageCount,
        a.url,
        a.evidence ?? "",
        c.advice ?? "",
      ]);
    }
  }

  return [ISSUE_CSV_HEADER as readonly (string | number)[], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/** reportFileName() の値から「aio-report-site_example.com_20260906_issues.csv」を作る */
export function issuesCsvFileName(reportName: string): string {
  return `${reportName.replace(/\.pdf$/i, "")}_issues.csv`;
}
