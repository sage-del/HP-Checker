/**
 * PWA マニフェスト。ホーム画面に追加したときの名前とアイコンを決める。
 *
 * アイコンの元は src/app/icon.svg（ヘッダーの LogoMark と同じ形）。
 * PNG は scripts/generate-icons.mjs で作り直せる。
 */
import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} | ${BRAND.tagline}`,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    lang: "ja",
    background_color: "#f6f8f9",
    // ロゴと同じネイビー。アドレスバーの色もこれに合う
    theme_color: "#1b3a63",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
