/**
 * 表紙ヘッダー（design-spec §3.1）。
 *
 * 藍（brand）の帯にサイト名・対象 URL・診断日時・診断範囲・診断ページ数・所要時間と
 * グレード印を載せる。print-card は付けない（印刷で背景が消えると帯が成立しないため）。
 * グレード印は紺の上に判定色を直接置かず、白いタイルの中に置く（コントラスト確保）。
 */
import { formatDateTime } from "@/lib/report";
import type { GradeInfo } from "@/lib/ui/grade";

export interface ReportCoverProps {
  /** 大見出し。ホスト名（www. を除く） */
  host: string;
  /** ページの <title>（あれば全文） */
  pageTitle?: string | null;
  /** 対象 URL（page: finalUrl / site: entryUrl） */
  url: string;
  fetchedAt: string;
  /** 「このページ」/「サイト全体（全ページ）」 */
  scopeLabel: string;
  /** 「1 ページ」/「17 ページ（sitemap.xml と内部リンクから収集・取得失敗 0 件）」 */
  pagesLabel: string;
  durationLabel: string;
  grade: GradeInfo;
}

export function ReportCover({
  host,
  pageTitle,
  url,
  fetchedAt,
  scopeLabel,
  pagesLabel,
  durationLabel,
  grade,
}: ReportCoverProps) {
  return (
    <header className="rounded-t-sm border border-brand bg-brand px-5 py-6 text-on-brand @md:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.12em] text-on-brand-muted">
            AIO DIAGNOSTIC REPORT
          </p>
          <p className="mt-1 text-[22px] leading-snug font-bold @md:text-[26px]">
            AI検索最適化（AIO）診断報告書
          </p>
          <p className="mt-4 text-[18px] leading-snug font-bold break-all">{host}</p>
          {pageTitle && (
            <p className="mt-1 text-[13px] leading-relaxed break-words text-on-brand-muted">{pageTitle}</p>
          )}
        </div>
        <div className="shrink-0 text-center">
          <p className="text-[11px] text-on-brand-muted">総合評価</p>
          <p
            className="mx-auto mt-1 flex h-14 w-14 items-center justify-center rounded-xl border-2 bg-panel text-[32px] leading-none font-bold tabular-nums"
            style={{ borderColor: grade.color, color: grade.color }}
          >
            {grade.grade}
          </p>
          <p
            className="mt-1 inline-block rounded-full border bg-panel px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
            style={{ borderColor: grade.color, color: grade.color }}
          >
            {grade.label}
          </p>
        </div>
      </div>

      {/*
        メタ情報は 1 列 → 2 列（@md）→ 6 列（@2xl）。
        「2026年9月7日 09:25」は約 150px 必要で、6 列を @md（28rem）から始めると
        1 項目 117〜134px しか無く隣と重なるため、6 列は @2xl（42rem）から。
      */}
      <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-on-brand/20 pt-4 @md:grid-cols-2 @2xl:grid-cols-6">
        <div className="@md:col-span-2 @2xl:col-span-6">
          <dt className="text-[11px] text-on-brand-muted">対象 URL</dt>
          <dd className="mt-0.5 text-[13px] leading-snug break-all">{url}</dd>
        </div>
        <div className="@2xl:col-span-2">
          <dt className="text-[11px] text-on-brand-muted">診断範囲</dt>
          <dd className="mt-0.5 text-[14px] font-bold">{scopeLabel}</dd>
        </div>
        <div className="@2xl:col-span-2">
          <dt className="text-[11px] text-on-brand-muted">診断日時</dt>
          <dd className="mt-0.5 text-[14px] font-bold tabular-nums">{formatDateTime(fetchedAt)}</dd>
        </div>
        <div className="@2xl:col-span-2">
          <dt className="text-[11px] text-on-brand-muted">所要時間</dt>
          <dd className="mt-0.5 text-[14px] font-bold tabular-nums">{durationLabel}</dd>
        </div>
        <div className="@md:col-span-2 @2xl:col-span-6">
          <dt className="text-[11px] text-on-brand-muted">診断ページ数</dt>
          <dd className="mt-0.5 text-[14px] leading-snug font-bold">{pagesLabel}</dd>
        </div>
      </dl>

      <p className="mt-4 text-[11px] leading-relaxed text-on-brand-muted">
        公開 HTML・robots.txt・llms.txt・sitemap.xml を対象とした自動診断です。採点基準は付録 B をご覧ください。
      </p>
    </header>
  );
}
