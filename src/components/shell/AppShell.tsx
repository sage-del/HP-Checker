import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export interface AppShellProps {
  children: ReactNode;
  /** package.json の version（layout.tsx から渡す） */
  version: string;
}

/**
 * 全ページ共通のシェル。上にヘッダー、下にフッター、その間は中央 1 カラム。
 *
 * 以前はサイドバー付きのグリッドだったが、画面が無料診断の 1 本だけになったので
 * ナビゲーションを持たない縦積みにした。状態を持たないのでサーバーコンポーネント。
 *
 * <main> について: 無料診断（/）の Checker は自分の <main> を持ち、それを PDF 化の
 * 対象にしている。二重の <main> を避けるため、ここでは <main> を作らずに
 * 画面側へ委ねる（印刷時の余白は globals.css の @media print が main に当てる）。
 */
export function AppShell({ children, version }: AppShellProps) {
  return (
    <div className="app-shell flex min-h-screen flex-col print:block print:min-h-0">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter version={version} />
    </div>
  );
}
