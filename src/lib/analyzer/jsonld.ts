import * as cheerio from "cheerio";
import { check, optionalCheck } from "./check";
import type { CheckResult } from "./types";

export interface JsonLdInfo {
  /** script タグの数 */
  blocks: number;
  /** パースに失敗したブロック数 */
  parseErrors: number;
  /** 出現したすべての @type（重複なし） */
  types: string[];
  /** Organization 系に sameAs があるか */
  hasSameAs: boolean;
  /** WebSite に SearchAction（potentialAction）があるか */
  hasSearchAction: boolean;
}

const ORG_TYPES = new Set([
  "Organization",
  "LocalBusiness",
  "Corporation",
  "Person",
  "Store",
  "Restaurant",
  "MedicalBusiness",
  "ProfessionalService",
  "EducationalOrganization",
  "GovernmentOrganization",
  "NGO",
]);

const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "TechArticle"]);

/**
 * JSON-LD を抽出して @type を再帰的に集める。
 * `@graph` 配列・入れ子・複数 script タグ・配列の @type をすべて吸収する。
 */
export function extractJsonLd($: cheerio.CheerioAPI): JsonLdInfo {
  const info: JsonLdInfo = {
    blocks: 0,
    parseErrors: 0,
    types: [],
    hasSameAs: false,
    hasSearchAction: false,
  };
  const types = new Set<string>();

  $('script[type="application/ld+json"]').each((_, el) => {
    info.blocks += 1;
    const raw = $(el).text();
    if (!raw.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // 末尾カンマなど軽微な壊れ方は救済しない。エラーとして記録する
      info.parseErrors += 1;
      return;
    }
    walk(data, (node) => {
      const t = node["@type"];
      const nodeTypes = Array.isArray(t) ? t : t ? [t] : [];
      for (const name of nodeTypes) {
        if (typeof name === "string") types.add(stripPrefix(name));
      }
      const localTypes = nodeTypes.map((n) => (typeof n === "string" ? stripPrefix(n) : ""));
      if (localTypes.some((n) => ORG_TYPES.has(n)) && hasNonEmpty(node["sameAs"])) {
        info.hasSameAs = true;
      }
      if (localTypes.includes("WebSite") && node["potentialAction"]) {
        walk(node["potentialAction"], (action) => {
          const at = action["@type"];
          if (at === "SearchAction" || (Array.isArray(at) && at.includes("SearchAction"))) {
            info.hasSearchAction = true;
          }
        });
      }
    });
  });

  info.types = [...types];
  return info;
}

/** schema:Organization のような接頭辞や URL 形式の @type を素の名前にする */
function stripPrefix(name: string): string {
  const last = name.split(/[/#:]/).pop();
  return last || name;
}

function hasNonEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.length > 0;
}

type JsonObject = Record<string, unknown>;

function walk(node: unknown, visit: (obj: JsonObject) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as JsonObject;
    visit(obj);
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") walk(value, visit);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   構造化データは「その画面に実在する内容」を記述するもの。
   FAQ の無いページに FAQPage を、下層ページに WebSite を足させるのは
   Google の構造化データの general guidelines に反する指示になるため、
   採点する範囲をページ側の実態で決める。
   ───────────────────────────────────────────────────────────── */

/** 「よくある質問」らしき見出し・語 */
const RE_FAQ_LABEL = /よくあるご?質問|FAQ|Q\s*&\s*A|Q\s*＆\s*A|質問と回答/i;

/**
 * 画面に FAQ 相当の内容が実在するか。
 * 次のいずれかを満たせば「ある」とみなす:
 *   - <details><summary> が 2 組以上（アコーディオン型の FAQ）
 *   - 疑問符で終わる見出しが 2 つ以上
 *   - 「よくある質問」等の語があり、かつ疑問符で終わる見出し / dt が 1 つ以上
 */
export function hasFaqContent($: cheerio.CheerioAPI): boolean {
  const details = $("details:has(summary)").length;
  if (details >= 2) return true;

  const endsWithQuestion = (text: string) => /[?？]\s*$/.test(text.trim());
  const questionHeadings = $("h2, h3, h4, dt, summary")
    .toArray()
    .filter((el) => endsWithQuestion($(el).text())).length;
  if (questionHeadings >= 2) return true;

  const labelled = $("h1, h2, h3, h4")
    .toArray()
    .some((el) => RE_FAQ_LABEL.test($(el).text()));
  return labelled && questionHeadings >= 1;
}

/** サイトのトップページか（/ と /index.* を同じとみなす） */
export function isHomePage(pageUrl: string): boolean {
  try {
    const { pathname } = new URL(pageUrl);
    return pathname === "/" || /^\/index\.[a-z0-9]+$/i.test(pathname);
  } catch {
    return false;
  }
}

export function checkStructuredData($: cheerio.CheerioAPI, pageUrl: string): CheckResult[] {
  const info = extractJsonLd($);
  const has = (...names: string[]) => names.some((n) => info.types.includes(n));
  const results: CheckResult[] = [];

  const hasAny = info.types.length > 0;
  results.push(
    check({
      id: "jsonld-exists",
      category: "structuredData",
      status: hasAny ? "pass" : "fail",
      weight: 3,
      label: hasAny ? "構造化データ（JSON-LD）がある" : "構造化データ（JSON-LD）がない",
      evidence: hasAny
        ? `検出した @type: ${info.types.join(", ")}`
        : info.blocks > 0
          ? `script タグは ${info.blocks} 個ありますが有効な @type がありません`
          : undefined,
      advice:
        "構造化データ（JSON-LD）は、ページの内容を「これは会社情報」「これはFAQ」と機械が読める形で伝える仕組みです。<head> 内に <script type=\"application/ld+json\"> を置き、まずは Organization と WebSite から設定してください。",
    }),
  );

  // js-rendering と同じ理由で、エラーが無いページでも pass として必ず出す
  // （カテゴリの配点合計をページ間で揃え、見込み加点を実際の伸びと一致させる）
  results.push(
    check({
      id: "jsonld-parse-error",
      category: "structuredData",
      status: info.parseErrors > 0 ? "fail" : "pass",
      weight: 2,
      label: info.parseErrors > 0 ? "JSON-LD に文法エラーがある" : "JSON-LD に文法エラーはない",
      evidence:
        info.parseErrors > 0
          ? `${info.parseErrors} 個の JSON-LD ブロックがパースできません`
          : info.blocks > 0
            ? `${info.blocks} 個の JSON-LD ブロックはすべて読み取れました`
            : "JSON-LD のブロックがありません",
      advice:
        "JSON として読めない JSON-LD は無視されます。末尾カンマ、引用符の不一致、コメントの混入などがないか、Google のリッチリザルトテストや JSON バリデータで確認してください。",
    }),
  );

  const hasOrg = [...ORG_TYPES].some((t) => info.types.includes(t));
  results.push(
    check({
      id: "jsonld-organization",
      category: "structuredData",
      status: hasOrg ? "pass" : "warn",
      weight: 2,
      label: hasOrg
        ? "運営者(Organization)の構造化データがある"
        : "運営者(Organization)の構造化データがない",
      advice:
        "Organization（または LocalBusiness / Person）の構造化データは、「このサイトを運営しているのは誰か」を AI に伝えます。name・url・logo・sameAs（公式SNS）を含めて設定すると、AI が運営者を正しく認識し、信頼性の判断材料になります。",
    }),
  );

  // WebSite はトップページに 1 つ置けばよく、全ページに入れる必要はない
  // （Google のサイト名の仕様がホームページに置くよう明記している）。
  // 下層ページでは「該当なし」として pass にする。image-alt と同じ考え方で、
  // 配点（= カテゴリの分母）をページ間で揃えたまま減点だけを外す。
  const home = isHomePage(pageUrl);
  results.push(
    check({
      id: "jsonld-website",
      category: "structuredData",
      status: !home || has("WebSite") ? "pass" : "warn",
      weight: 1,
      label: !home
        ? "WebSite 構造化データはトップページにあれば足りる"
        : has("WebSite")
          ? "WebSite 構造化データがある"
          : "トップページに WebSite 構造化データがない",
      evidence: !home ? "下層ページのため、この項目は対象外です" : undefined,
      advice:
        "WebSite の構造化データは、サイト名と URL を明示します。サイト名が検索結果や AI の回答で正しく表示されやすくなります。トップページに 1 つ置けば足り、下層ページに入れる必要はありません。",
    }),
  );

  results.push(
    optionalCheck({
      id: "jsonld-search-action",
      category: "structuredData",
      present: info.hasSearchAction,
      label: info.hasSearchAction
        ? "サイト内検索（SearchAction）の構造化データがある"
        : "サイト内検索（SearchAction）の構造化データがない",
      advice:
        "SearchAction（サイトリンク検索ボックス）は、Google が対応する表示機能を終了しているため、検索結果のための対応は不要です。この項目は採点しておらず、無くても不利にはなりません。既に設置されている場合、そのままにしておいて差し支えありません。",
    }),
  );

  // パンくずは「そのページが上位のどこにぶら下がっているか」を示すもの。
  // トップページは最上位で上位階層が無く、「ホーム」1 件だけの BreadcrumbList は
  // 位置を何も伝えない（Google も現在のページに至る経路を示すものとしている）。
  // WebSite の裏返しで、トップページでは「該当なし」として pass にする。
  const hasBreadcrumb = has("BreadcrumbList");
  results.push(
    check({
      id: "jsonld-breadcrumb",
      category: "structuredData",
      status: home || hasBreadcrumb ? "pass" : "warn",
      weight: 1,
      label: home
        ? "トップページのためパンくず(BreadcrumbList)は不要"
        : hasBreadcrumb
          ? "パンくず(BreadcrumbList)構造化データがある"
          : "パンくず(BreadcrumbList)構造化データがない",
      evidence: home
        ? "トップページは最上位で上位階層が無いため、この項目は対象外です"
        : undefined,
      advice:
        "BreadcrumbList は、このページがサイトのどの階層にあるかを伝えます。トップ > サービス > 詳細 のような位置関係が AI に伝わり、ページの文脈を理解しやすくなります。トップページは最上位のため不要です。",
    }),
  );

  // FAQPage は「画面に FAQ が実在するページ」でだけ問題として扱う。
  // 構造化データは画面に無い内容を記述してはならないため、FAQ の無いページに
  // FAQPage を足させるのは誤った助言になる。ここも WebSite と同じく、
  // 該当しないページは pass にして配点だけ残す。
  // 逆に、FAQ が無いのに FAQPage が書かれている場合はガイドライン違反として指摘する。
  const faqOnPage = hasFaqContent($);
  const faqMarkup = has("FAQPage");
  const faqOk = faqOnPage === faqMarkup;
  results.push(
    check({
      id: "jsonld-faq",
      category: "structuredData",
      status: faqOk ? "pass" : "warn",
      weight: 2,
      label: faqOnPage
        ? faqMarkup
          ? "FAQ に FAQPage 構造化データが設定されている"
          : "FAQ があるのに FAQPage 構造化データがない"
        : faqMarkup
          ? "画面に FAQ が無いのに FAQPage 構造化データがある"
          : "このページに FAQ は無いため FAQPage は不要",
      evidence: faqOnPage
        ? "画面によくある質問と回答らしき内容があります"
        : "画面によくある質問と回答が見当たりません",
      advice: faqOnPage
        ? "このページには質問と回答が載っています。FAQPage の構造化データで印を付けると、AI が「これは質問とその答え」と認識でき、回答をそのまま引用しやすくなります。なお Google の FAQ リッチリザルト（検索結果での折りたたみ表示）は終了しているため、狙いは検索結果の見た目ではなく AI に正確に読ませることです。"
        : "画面に存在しない内容を構造化データに書くことは、Google の構造化データに関するガイドラインで禁止されています。FAQPage の記述を削除するか、対応する質問と回答をページ本文に掲載してください。",
    }),
  );

  results.push(
    check({
      id: "jsonld-sameas",
      category: "structuredData",
      status: info.hasSameAs ? "pass" : hasOrg ? "warn" : "fail",
      weight: 1,
      label: info.hasSameAs
        ? "sameAs(公式SNS/Wikipedia等)が設定されている"
        : "sameAs(公式SNS/Wikipedia等)が設定されていない",
      advice:
        "sameAs は、Organization に公式SNS・Wikipedia・法人番号公表サイトなどの URL を並べる項目です。AI が「この会社は本物で、他の情報源とも一致する」と確認できるため、同名の別会社との混同を防ぎ、信頼性が上がります。",
    }),
  );

  const hasArticle = [...ARTICLE_TYPES].some((t) => info.types.includes(t));
  results.push(
    optionalCheck({
      id: "jsonld-article",
      category: "structuredData",
      present: hasArticle,
      label: hasArticle ? "記事（Article）構造化データがある" : "記事（Article）構造化データがない",
      advice:
        "Article（記事）の構造化データは、そのページがニュースやブログなどの記事であることを、著者や公開日とともに AI に伝えるデータです（設定は任意）。記事ページがある場合に設定すると、AI が記事として正しく認識しやすくなります。",
    }),
  );

  results.push(
    optionalCheck({
      id: "jsonld-product",
      category: "structuredData",
      present: has("Product"),
      label: has("Product") ? "製品（Product）構造化データがある" : "製品（Product）構造化データがない",
      advice:
        "Product（製品）の構造化データは、商品名・価格・在庫などの商品情報を AI に正確に伝えるデータです（設定は任意）。商品ページがある場合に設定すると、商品情報が AI に正しく伝わり、検索や AI の回答で扱われやすくなります。",
    }),
  );

  return results;
}
