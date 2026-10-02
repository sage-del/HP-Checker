"use client";

/**
 * 診断中の進捗パネル（no-print）。
 * /api/site の NDJSON 進捗行（取得 N / 発見 M）を出し、いつでも中止できる。
 */
import { Button, ProgressBar } from "@/components/ui";
import type { SiteProgress } from "@/lib/analyzer/types";
import { fmt, formatClock, truncateMiddle } from "@/lib/report";

const PHASE_TEXT: Record<SiteProgress["phase"], string> = {
  discover: "sitemap と内部リンクからページを収集しています",
  crawl: "ページを取得して診断しています",
};

export function ProgressPanel({
  progress,
  elapsedMs,
  onAbort,
}: {
  progress: SiteProgress | null;
  elapsedMs: number;
  onAbort: () => void;
}) {
  const discovered = progress?.discovered ?? 0;
  const fetched = progress?.fetched ?? 0;
  const headline = progress ? PHASE_TEXT[progress.phase] : "サイトの構成を調べています";
  const indeterminate = !progress || progress.phase === "discover" || discovered <= 0;

  return (
    <section
      className="no-print mb-6 rounded-lg border border-line bg-panel p-4"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] font-bold text-ink">{headline}…</p>
        <p className="text-[12px] text-muted tabular-nums">経過 {formatClock(elapsedMs)}</p>
      </div>

      <ProgressBar
        className="mt-3"
        value={fetched}
        max={Math.max(discovered, 1)}
        indeterminate={indeterminate}
        label={
          <span className="text-[13px] text-ink">
            取得 <span className="font-bold tabular-nums">{fmt(fetched)}</span> / 発見{" "}
            <span className="font-bold tabular-nums">{fmt(discovered)}</span> ページ
            {progress && progress.failed > 0 && (
              <span className="ml-2 text-[12px] text-muted">失敗 {fmt(progress.failed)} 件</span>
            )}
          </span>
        }
      />

      {progress?.url && (
        <p className="mt-2 text-[12px] break-all text-muted">現在: {truncateMiddle(progress.url, 64)}</p>
      )}

      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={onAbort}>
          中止
        </Button>
      </div>
    </section>
  );
}
