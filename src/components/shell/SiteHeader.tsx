import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { LogoMark } from "./LogoMark";

/**
 * 全ページ共通のヘッダー。機能が 1 本なのでナビゲーションは持たず、
 * ブランドと「無料」であることだけを示す。
 *
 * 外部サイトへのリンクは置かない（OEM 提供のため、利用者を運営元以外へ
 * 送る導線を画面に出さない）。
 * 印刷 / PDF では no-print で消える。
 */
export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 md:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {/* ロゴは 2 色のまま置く（地色を敷くと線画が潰れる） */}
          <LogoMark className="h-10 w-10 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
              {BRAND.name}
            </span>
            <span className="hidden truncate text-[11px] leading-tight text-muted sm:block">{BRAND.tagline}</span>
          </span>
        </Link>

        <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent">
          無料
        </span>

      </div>
    </header>
  );
}
