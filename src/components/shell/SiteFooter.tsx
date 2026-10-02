import { BRAND } from "@/lib/brand";

/**
 * 全ページ共通のフッター（画面本体の下）。名乗りと、採点がルールベースであること（AI の推測ではない）を示す。
 * 印刷 / PDF では no-print で消える。
 */
export function SiteFooter({ version }: { version: string }) {
  return (
    <footer className="no-print mt-16 border-t border-line">
      <div className="flex w-full flex-col gap-1 px-4 py-5 text-[12px] text-muted md:flex-row md:items-center md:justify-between md:px-8">
        <p>
          <span className="font-bold text-ink">{BRAND.name}</span> · {BRAND.tagline}
        </p>
        <p>
          ルールベース診断 · <span className="tabular-nums">v{version}</span>
        </p>
      </div>
    </footer>
  );
}
