/**
 * 診断項目の配点（analyzer の各 check() 呼び出しと同じ値の写し）。
 *
 * ページ単位の結果（CheckResult）は weight を持っているが、サイト単位の集計
 * （SiteCheckSummary）は持っていない。サイトモードで「未対応ページ数 × 配点」
 * の優先順位や見込み加点を出すためにここで参照する。
 * src/lib/report/__tests__/weights.test.ts が analyzer の実際の出力と一致することを検証する。
 */
import {
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type CategoryId,
} from "@/lib/analyzer/types";

export const CHECK_WEIGHTS: Record<string, number> = {
  // AI クローラ可否
  "ai-crawlers-allowed": 3,
  "ai-crawlers-training": 0,
  noindex: 2,
  "llms-txt": 0,
  "llms-full-txt": 0,
  // 構造化データ
  "jsonld-exists": 3,
  "jsonld-parse-error": 2,
  "jsonld-organization": 2,
  "jsonld-website": 1,
  "jsonld-search-action": 0,
  "jsonld-breadcrumb": 1,
  "jsonld-faq": 2,
  "jsonld-sameas": 1,
  "jsonld-article": 0,
  "jsonld-product": 0,
  // メタ情報
  title: 3,
  description: 3,
  ogp: 2,
  canonical: 1,
  lang: 1,
  // 見出し
  h1: 3,
  "heading-structure": 2,
  // コンテンツ
  "js-rendering": 3,
  "content-specificity": 3,
  "content-length": 0,
  "content-heading-body": 1,
  "image-alt": 1,
  // 信頼性
  "trust-about": 2,
  "trust-privacy": 2,
  "company-info-consistency": 2,
  // 問い合わせ導線
  "contact-link": 3,
  "contact-tel-link": 1,
  // 表示速度
  "response-time": 3,
  "html-size": 1,
  "render-blocking-scripts": 1,
  "image-dimensions": 1,
  // セキュリティ
  https: 3,
  "mixed-content": 2,
  hsts: 0,
  // モバイル対応
  viewport: 3,
  "zoom-enabled": 1,
};

/** 項目 ID → 配点。未知の ID は 1 とみなす */
export function checkWeight(id: string): number {
  const w = CHECK_WEIGHTS[id];
  return typeof w === "number" ? w : 1;
}

/** カテゴリの表示順（scoring.ts と同じ） */
export const CATEGORY_ORDER: readonly CategoryId[] = [
  "crawlers",
  "structuredData",
  "meta",
  "headings",
  "content",
  "trust",
  "contact",
  "performance",
  "security",
  "mobile",
];

export function categoryIndex(id: CategoryId): number {
  const i = CATEGORY_ORDER.indexOf(id);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** 付録 B「診断方法と採点基準」に載せる、カテゴリごとの主な確認内容 */
export const CATEGORY_CRITERIA: Record<CategoryId, string> = {
  crawlers:
    "robots.txt での AI 検索用クローラ（OAI-SearchBot・PerplexityBot・Claude-SearchBot など）の許可、noindex の有無。サイト内検索の結果・カート・送信完了など、索引に載せないのが通例のページの noindex は採点していません。学習用クローラ（GPTBot など）の拒否と llms.txt の有無も情報として表示し、採点していません",
  structuredData:
    "JSON-LD の有無と文法、Organization / パンくず / sameAs（公式 SNS 等）。WebSite はトップページのみ、パンくずは下層ページのみ、FAQPage は画面に FAQ が実在するページのみを採点します",
  meta: "title・meta description の有無と長さ、OGP、canonical、html の lang 属性",
  headings: "h1 の数、h2 / h3 による見出し階層と階層飛び",
  content:
    "AI が引用できる具体的な情報（数値・日付・組織名・連絡先）の有無、見出しに本文が伴っているか、JavaScript 描画への依存、画像の alt 属性。本文の文字数は情報として表示し、採点していません",
  trust:
    "会社概要・プライバシーポリシーへのリンク、会社情報（社名・電話番号・郵便番号）がページ間・構造化データと画面表記の間で一致しているか",
  contact:
    "問い合わせページへのリンク・問い合わせフォーム・電話 / メールのリンクがあるか、画面の電話番号がタップで発信できるか",
  performance:
    "診断サーバーから見たサーバーの応答時間（0.8 秒以下で合格・1.8 秒超で重大）、HTML の大きさ、表示を止めるスクリプトの数、画像の大きさの指定。画像などを含めた実際の表示時間（Core Web Vitals）ではありません",
  security: "HTTPS での配信、https のページへの http の読み込みの混在。HSTS は情報として表示し、採点していません",
  mobile: "スマートフォン向けの viewport 指定、拡大表示を禁止していないか",
};

export { CATEGORY_LABELS, CATEGORY_WEIGHTS };
