import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { BRAND } from "@/lib/brand";
import pkg from "../../package.json";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} | ${BRAND.tagline}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: BRAND.name,
    title: `${BRAND.name} | ${BRAND.tagline}`,
    description: BRAND.description,
  },
};

/**
 * ルートレイアウト。
 *
 * 認証は一切持たない（すべてのページが公開）。サービスの呼び名は
 * src/lib/brand.ts が唯一の定義で、ここはそれを metadata に写すだけ。
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-surface text-ink">
        <AppShell version={process.env.NEXT_PUBLIC_APP_VERSION || pkg.version}>{children}</AppShell>
      </body>
    </html>
  );
}
