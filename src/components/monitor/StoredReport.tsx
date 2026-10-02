"use client";

import { useSyncExternalStore } from "react";
import { SiteReport } from "@/components/free/SiteReport";
import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import type { DiagnosisComparison } from "@/lib/report";

const subscribe = () => () => {};

/**
 * 保存した診断結果を、無料診断と同じレポートの形で描く（SiteReport はクライアント部品）。
 *
 * レポートの日時は実行環境の時刻帯で書かれる（src/lib/report/format.ts）。サーバー（Vercel は UTC）
 * で描くと閲覧者のブラウザ（日本時間）とずれるので、ブラウザに来てから描く。
 */
export function StoredReport({ result, comparison }: { result: SiteAnalysisResult; comparison: DiagnosisComparison | null }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <p className="text-[13px] text-muted">レポートを表示しています…</p>;
  return <SiteReport result={result} elapsedMs={result.crawl?.durationMs ?? 0} comparison={comparison} />;
}
