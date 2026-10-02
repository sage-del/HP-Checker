import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { isMonitorConfigured } from "@/lib/monitor/db";
import { Sidebar } from "./Sidebar";
import { SiteFooter } from "./SiteFooter";

export interface AppShellProps {
  children: ReactNode;
  /** package.json の version（layout.tsx から渡す） */
  version: string;
}

/**
 * 全ページ共通の管理画面シェル。左に機能ごとのタブ（Sidebar）、右に画面本体とフッター。
 * スマホではサイドバーが上部のバー + ドロワーになる。
 *
 * <main> について: 各画面が自分の <main> を持つ（無料診断の Checker はそれを PDF 化の
 * 対象にしている）。二重の <main> を避けるため、ここでは <main> を作らない
 * （印刷時は globals.css の @media print が .app-shell を通常フローに戻し、サイドバーを消す）。
 */
export function AppShell({ children, version }: AppShellProps) {
  return (
    <div className="app-shell flex min-h-screen flex-col md:flex-row print:block print:min-h-0">
      <Sidebar name={BRAND.name} tagline={BRAND.tagline} monitorEnabled={isMonitorConfigured()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1">{children}</div>
        <SiteFooter version={version} />
      </div>
    </div>
  );
}
