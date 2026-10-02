import robotsParser from "robots-parser";
import * as cheerio from "cheerio";
import { check, optionalCheck } from "./check";
import { fetchText, type FetchedText } from "./fetch";
import type {
  CheckResult,
  CheckStatus,
  ExclusionSignal,
  SearchExclusion,
} from "./types";

/* ─────────────────────────────────────────────────────────────
   AI クローラは用途で 2 つに分かれ、robots.txt でも別々に指定できる。

   - search  : AI の回答や AI 検索に「引用元として載せる」ための巡回。
               止めると AI 検索で引用される機会そのものが無くなる。
   - training: モデルの学習データ収集。止めても AI 検索への掲載は減らない。

   学習用を拒否するのは各社が正式に認めている運用であり、経営判断として
   まっとうな選択なので減点しない（状態は参考情報として表示する）。
   採点するのは検索用だけにする。
   ───────────────────────────────────────────────────────────── */
export type CrawlerPurpose = "search" | "training";

export const AI_CRAWLERS = [
  { ua: "OAI-SearchBot", owner: "OpenAI（ChatGPT検索）", purpose: "search" },
  { ua: "ChatGPT-User", owner: "OpenAI（ユーザー操作）", purpose: "search" },
  { ua: "Claude-SearchBot", owner: "Anthropic（検索）", purpose: "search" },
  { ua: "Claude-User", owner: "Anthropic（ユーザー操作）", purpose: "search" },
  { ua: "PerplexityBot", owner: "Perplexity（検索）", purpose: "search" },
  { ua: "GPTBot", owner: "OpenAI（学習）", purpose: "training" },
  { ua: "ClaudeBot", owner: "Anthropic（学習）", purpose: "training" },
  { ua: "Google-Extended", owner: "Google（Gemini の学習・グラウンディング）", purpose: "training" },
  { ua: "Applebot-Extended", owner: "Apple（学習）", purpose: "training" },
  { ua: "CCBot", owner: "Common Crawl（学習データ）", purpose: "training" },
] as const satisfies readonly { ua: string; owner: string; purpose: CrawlerPurpose }[];

export const SEARCH_CRAWLERS = AI_CRAWLERS.filter((c) => c.purpose === "search");
export const TRAINING_CRAWLERS = AI_CRAWLERS.filter((c) => c.purpose === "training");

/** ua がどちらの用途か。未知の名前は search 扱い（採点を甘くしない） */
export function purposeOf(ua: string): CrawlerPurpose {
  return AI_CRAWLERS.find((c) => c.ua === ua)?.purpose ?? "search";
}

export interface RobotsInfo {
  exists: boolean;
  /** 拒否されているクローラ名 */
  blocked: string[];
  /** 許可されているクローラ名 */
  allowed: string[];
}

/** robots.txt を解析し、対象 URL への各 AI クローラのアクセス可否を返す */
export function evaluateRobots(robotsTxt: string | null, pageUrl: string, robotsUrl: string): RobotsInfo {
  if (robotsTxt === null) {
    return { exists: false, blocked: [], allowed: AI_CRAWLERS.map((c) => c.ua) };
  }
  const robots = robotsParser(robotsUrl, robotsTxt);
  const blocked: string[] = [];
  const allowed: string[] = [];
  for (const crawler of AI_CRAWLERS) {
    // isAllowed が undefined を返すのは URL がホスト外のとき。ここでは許可扱い
    if (robots.isAllowed(pageUrl, crawler.ua) === false) blocked.push(crawler.ua);
    else allowed.push(crawler.ua);
  }
  return { exists: true, blocked, allowed };
}

/**
 * オリジン単位で共通のファイル。ページごとに変わらないため、サイト診断では
 * 1 度だけ取得して全ページで使い回す。
 */
export interface SiteFiles {
  origin: string;
  /** robots.txt の中身。取得できなければ null */
  robotsTxt: string | null;
  /** robots.txt 内の Sitemap: 行 */
  sitemaps: string[];
  llmsTxt: { present: boolean; length: number; status: number };
  llmsFullTxt: { present: boolean; length: number };
}

/**
 * 任意ファイルを取得する。大きすぎ・時間切れでも診断全体は止めない。
 * llms-full.txt はサイト全文を入れるファイルなので数 MB を超えることが珍しくなく、
 * 上限を超えても先頭だけ読めば「置いてあるか」は判定できる。
 * 取得できなかったときは「無い」として扱う。
 */
async function fetchOptionalFile(url: string): Promise<FetchedText> {
  try {
    return await fetchText(url, { timeoutMs: 8000, truncate: true });
  } catch {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: "",
      body: "",
      headers: new Headers(),
    };
  }
}

/** robots.txt / llms.txt / llms-full.txt をまとめて取得する */
export async function fetchSiteFiles(origin: string): Promise<SiteFiles> {
  const [robotsRes, llmsRes, llmsFullRes] = await Promise.all([
    fetchOptionalFile(`${origin}/robots.txt`),
    fetchOptionalFile(`${origin}/llms.txt`),
    fetchOptionalFile(`${origin}/llms-full.txt`),
  ]);

  const robotsTxt = robotsRes.ok && !looksLikeHtml(robotsRes) ? robotsRes.body : null;
  const llmsOk = llmsRes.ok && !looksLikeHtml(llmsRes) && llmsRes.body.trim().length > 0;
  const llmsFullOk =
    llmsFullRes.ok && !looksLikeHtml(llmsFullRes) && llmsFullRes.body.trim().length > 0;

  return {
    origin,
    robotsTxt,
    sitemaps: extractSitemaps(robotsTxt),
    llmsTxt: {
      present: llmsOk,
      length: llmsOk ? llmsRes.body.trim().length : 0,
      status: llmsRes.status,
    },
    llmsFullTxt: {
      present: llmsFullOk,
      length: llmsFullOk ? llmsFullRes.body.trim().length : 0,
    },
  };
}

/** robots.txt の `Sitemap: <url>` 行を集める */
export function extractSitemaps(robotsTxt: string | null): string[] {
  if (!robotsTxt) return [];
  const urls: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) urls.push(m[1]);
  }
  return [...new Set(urls)];
}

/* ─────────────────────────────────────────────────────────────
   もともと検索に載せないページ。

   サイト内検索の結果・カート・ログイン・送信完了・印刷用ページなどを索引に
   載せると、中身の薄いページや重複ページが増えるだけで、Google 自身も
   サイト内検索の結果は索引させないよう案内している。こうしたページを
   noindex にしたり robots.txt で止めたりするのは正しい運用なので、
   「未対応」として減点すると設定を外す方向の誤った助言になる。

   判断材料は URL しか無いので、索引に載せたい理由がまず考えられない型だけを
   並べる（記事一覧・タグページのように、載せるかどうかが方針で分かれるものは
   入れない）。ここに該当しないページの noindex は今まで通り減点する。
   ───────────────────────────────────────────────────────────── */

const SEARCH_RESULT_PAGE = "サイト内検索の結果ページ";
const PREVIEW_PAGE = "下書き・プレビュー用のページ";
const PRINT_PAGE = "印刷用のページ";

/** パスの 1 区切りとして現れたら、その種類のページとみなす名前 */
const NOINDEX_EXPECTED_PATHS: readonly { kind: string; names: readonly string[] }[] = [
  {
    kind: SEARCH_RESULT_PAGE,
    names: [
      "search",
      "searches",
      "searchresult",
      "searchresults",
      "search-result",
      "search-results",
      "catalogsearch",
      "検索",
    ],
  },
  {
    kind: "カート・購入手続きのページ",
    names: ["cart", "carts", "basket", "checkout", "checkouts", "shopping-cart", "shoppingcart", "カート"],
  },
  {
    kind: "ログイン・会員専用のページ",
    names: [
      "login",
      "signin",
      "sign-in",
      "logout",
      "signout",
      "sign-out",
      "mypage",
      "my-page",
      "myaccount",
      "my-account",
      "password",
    ],
  },
  {
    kind: "管理画面のページ",
    names: ["admin", "wp-admin", "administrator"],
  },
  {
    kind: PREVIEW_PAGE,
    names: ["preview", "previews", "draft", "drafts"],
  },
  {
    kind: "入力フォームの確認・完了ページ",
    names: [
      "confirm",
      "confirmation",
      "complete",
      "completed",
      "completion",
      "thanks",
      "thankyou",
      "thank-you",
      "finish",
      "sent",
      "完了",
      "送信完了",
      "ありがとうございました",
    ],
  },
  {
    kind: PRINT_PAGE,
    names: ["print", "printview", "print-view", "printer-friendly"],
  },
  {
    kind: "エラーページ",
    names: ["404", "403", "500", "error", "not-found", "notfound"],
  },
];

/**
 * クエリ名で分かる種類。
 * `requireValue` は値が空のときに無視するかどうか（`?s=` だけの URL は
 * WordPress では検索ではなく一覧に落ちるため、検索語がある場合だけ数える）。
 */
const NOINDEX_EXPECTED_QUERIES: readonly {
  kind: string;
  names: readonly string[];
  requireValue: boolean;
}[] = [
  {
    kind: SEARCH_RESULT_PAGE,
    names: ["s", "q", "query", "keyword", "keywords", "search", "search_word", "searchword", "sword", "word"],
    requireValue: true,
  },
  { kind: PREVIEW_PAGE, names: ["preview", "preview_id", "preview_nonce"], requireValue: false },
  { kind: PRINT_PAGE, names: ["print"], requireValue: false },
];

/** パスを小文字の名前の並びにする（% エンコードと拡張子は外す） */
function pathSegments(pageUrl: URL): string[] {
  let path = pageUrl.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // 壊れた % エンコードはそのまま扱う
  }
  return path
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/\.(html?|php|aspx?|jsp|cgi)$/, ""));
}

/**
 * URL の形から「もともと検索に載せないページ」と分かるか。
 * 該当すればレポートに出す種類名を、しなければ null を返す。
 */
export function notForSearchKind(pageUrl: URL): string | null {
  const segments = pathSegments(pageUrl);
  for (const { kind, names } of NOINDEX_EXPECTED_PATHS) {
    if (segments.some((seg) => names.includes(seg))) return kind;
  }
  for (const [rawName, value] of pageUrl.searchParams) {
    const name = rawName.toLowerCase();
    for (const { kind, names, requireValue } of NOINDEX_EXPECTED_QUERIES) {
      if (names.includes(name) && (!requireValue || value.trim() !== "")) return kind;
    }
  }
  return null;
}

/**
 * ページ単位のクローラまわりの状態。
 * 採点（checkCrawlers）と「このページを採点対象にするか」の判断が同じものを見るよう、
 * robots.txt の評価と noindex の読み取りはここで 1 度だけ行う。
 */
export interface CrawlerState {
  robots: RobotsInfo;
  /** 拒否されている検索用クローラ */
  blockedSearch: string[];
  /** 拒否されている学習用クローラ */
  blockedTraining: string[];
  /** meta robots の content（小文字） */
  metaRobots: string;
  /** X-Robots-Tag（小文字） */
  xRobots: string;
  noindex: boolean;
  /** 検索対象から外されているページなら、その種類と根拠 */
  exclusion: SearchExclusion | null;
}

export function inspectCrawlers(
  pageUrl: URL,
  $: cheerio.CheerioAPI,
  pageHeaders: Headers,
  files: SiteFiles,
): CrawlerState {
  const robotsUrl = `${pageUrl.origin}/robots.txt`;
  const robots = evaluateRobots(files.robotsTxt, pageUrl.toString(), robotsUrl);
  const isSearch = (ua: string) => purposeOf(ua) === "search";
  const blockedSearch = robots.blocked.filter(isSearch);
  const blockedTraining = robots.blocked.filter((ua) => purposeOf(ua) === "training");

  const metaRobots = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  const xRobots = (pageHeaders.get("x-robots-tag") ?? "").toLowerCase();
  const noindex = metaRobots.includes("noindex") || xRobots.includes("noindex");

  // robots.txt でサイト全体を拒否しているなら、それは「このページだけ外している」
  // ではなくサイト全体の問題。トップページも拒否されていないときだけ、
  // このページを狙って外していると見なす
  const allSearchBlocked =
    SEARCH_CRAWLERS.length > 0 && blockedSearch.length === SEARCH_CRAWLERS.length;
  const blockedHereOnly =
    allSearchBlocked &&
    evaluateRobots(files.robotsTxt, `${pageUrl.origin}/`, robotsUrl).blocked.filter(isSearch)
      .length < SEARCH_CRAWLERS.length;

  const kind = notForSearchKind(pageUrl);
  const by: ExclusionSignal[] = [];
  if (noindex) by.push("noindex");
  if (blockedHereOnly) by.push("robots");

  return {
    robots,
    blockedSearch,
    blockedTraining,
    metaRobots,
    xRobots,
    noindex,
    exclusion: kind && by.length > 0 ? { kind, by } : null,
  };
}

export function checkCrawlers(
  pageUrl: URL,
  state: CrawlerState,
  files: SiteFiles,
): CheckResult[] {
  const origin = pageUrl.origin;
  const { robots: info, blockedSearch, blockedTraining, exclusion } = state;

  const results: CheckResult[] = [];

  // --- robots.txt による AI クローラ許可 -------------------------------------
  // 採点するのは検索用クローラだけ。学習用の拒否は正当な運用なので減点しない。
  // サイト内検索の結果のように、もともと検索に載せないページをこのページだけ
  // 止めているときも、意図した設定なので減点しない
  const allowedSearch = SEARCH_CRAWLERS.map((c) => c.ua).filter(
    (ua) => !blockedSearch.includes(ua),
  );
  const blockedOnPurpose = exclusion?.by.includes("robots") ?? false;

  const searchStatus: CheckStatus =
    blockedSearch.length === 0 || blockedOnPurpose
      ? "pass"
      : blockedSearch.length === SEARCH_CRAWLERS.length
        ? "fail"
        : "warn";
  results.push(
    check({
      id: "ai-crawlers-allowed",
      category: "crawlers",
      status: searchStatus,
      weight: 3,
      label: blockedOnPurpose
        ? `${exclusion?.kind}のため robots.txt で止めていて問題ない`
        : searchStatus === "pass"
          ? "AI 検索用クローラがアクセス可能"
          : searchStatus === "fail"
            ? "AI 検索用クローラがすべてブロックされている"
            : "一部の AI 検索用クローラがブロックされている",
      evidence: blockedOnPurpose
        ? `拒否: ${blockedSearch.join(", ")}（${exclusion?.kind}は検索に載せないのが通例のため、この項目は対象外です）`
        : blockedSearch.length === 0
          ? info.exists
            ? `robots.txt で検索用 ${SEARCH_CRAWLERS.length} 種がすべて許可されています`
            : "robots.txt が無いため、すべてのクローラが許可されています"
          : `拒否: ${blockedSearch.join(", ")}${allowedSearch.length > 0 ? ` / 許可: ${allowedSearch.join(", ")}` : ""}`,
      advice:
        "OAI-SearchBot・PerplexityBot・Claude-SearchBot などの検索用クローラは、AI が回答に引用元として載せるためにページを読みに来ます。これを robots.txt で拒否すると、AI 検索に出る機会そのものが無くなります。学習用（GPTBot など）とは別の User-agent なので、学習だけ止めて検索は許可する、という指定ができます。",
    }),
  );

  // 学習用は参考表示のみ（配点 0）。止めているのは正当な選択でありうる
  results.push(
    check({
      id: "ai-crawlers-training",
      category: "crawlers",
      status: "info",
      label:
        blockedTraining.length === 0
          ? "学習用 AI クローラも許可されている（情報）"
          : `学習用 AI クローラを ${blockedTraining.length} 種拒否している（情報）`,
      evidence:
        blockedTraining.length === 0
          ? `学習用 ${TRAINING_CRAWLERS.length} 種はすべて許可されています`
          : `拒否: ${blockedTraining.join(", ")}`,
      advice:
        "学習用クローラ（GPTBot・ClaudeBot・Google-Extended・CCBot など）を拒否しても、AI 検索での引用や Google の検索結果への掲載は減りません。コンテンツを学習に使わせたくない場合の正式な手段なので、この項目は採点していません。",
    }),
  );

  // --- noindex ---------------------------------------------------------------
  // サイト内検索の結果・カート・送信完了など、索引に載せないのが通例のページは
  // noindex が正しい設定なので減点しない（notForSearchKind のコメント参照）。
  // WebSite や image-alt と同じく、配点（= カテゴリの分母）はページ間で揃えたまま
  // 判定だけ pass にする。
  const { metaRobots, xRobots, noindex } = state;
  const noindexKind = exclusion?.by.includes("noindex") ? exclusion.kind : null;
  const robotsSetting = `meta robots="${metaRobots || "-"}" / X-Robots-Tag="${xRobots || "-"}"`;
  results.push(
    check({
      id: "noindex",
      category: "crawlers",
      status: !noindex || noindexKind ? "pass" : "fail",
      weight: 2,
      label: !noindex
        ? "noindex が設定されていない"
        : noindexKind
          ? `${noindexKind}のため noindex で問題ない`
          : "noindex が設定されている",
      evidence: !noindex
        ? undefined
        : noindexKind
          ? `${robotsSetting}（${noindexKind}は索引に載せないのが通例のため、この項目は対象外です）`
          : robotsSetting,
      advice:
        "このページは noindex が指定されており、検索エンジンにも AI 検索にも登録されません。公開したいページであれば meta robots / X-Robots-Tag の noindex を外してください。サイト内検索の結果や送信完了ページのように、意図して検索結果から外している場合はそのままで問題ありません。",
    }),
  );

  // --- llms.txt --------------------------------------------------------------
  // 参考表示のみ（配点 0）。llms.txt は提案段階の仕様で、これを読むと表明した
  // 主要な AI クローラはまだ無く、Google も AI 検索への掲載に専用ファイルは
  // 不要だとしている。無いことを減点する根拠が無い。
  const hasLlms = files.llmsTxt.present;
  results.push(
    check({
      id: "llms-txt",
      category: "crawlers",
      status: "info",
      label: hasLlms ? "llms.txt が設置されている（情報）" : "llms.txt は設置されていない（情報）",
      evidence: hasLlms
        ? `${origin}/llms.txt（${files.llmsTxt.length} 文字）`
        : `${origin}/llms.txt → HTTP ${files.llmsTxt.status || "取得失敗"}`,
      advice:
        "llms.txt は、サイトの概要と主要ページを AI 向けに Markdown でまとめる提案仕様です。読み取ることを表明した主要な AI クローラはまだ無く、Google も AI 検索への掲載に専用ファイルは不要だとしています。無くても不利にはならないため採点していません。設置する場合も、通常の HTML と robots.txt を整えることが先です。",
    }),
  );

  const hasLlmsFull = files.llmsFullTxt.present;
  results.push(
    optionalCheck({
      id: "llms-full-txt",
      category: "crawlers",
      present: hasLlmsFull,
      label: hasLlmsFull ? "/llms-full.txt がある" : "/llms-full.txt がない",
      evidence: hasLlmsFull
        ? `${origin}/llms-full.txt（${files.llmsFullTxt.length} 文字）`
        : undefined,
      advice:
        "llms-full.txt は、サイトの主要コンテンツ全文を 1 ファイルにまとめたものです（設定は任意）。ドキュメントやサービス説明が多いサイトでは、AI が一度に全体を読めるようになるため効果的です。",
    }),
  );

  return results;
}

/** 404 ページが 200 で返ってくるサイト対策: HTML が返ってきたらテキストファイルとみなさない */
function looksLikeHtml(res: { contentType: string; body: string }): boolean {
  if (res.contentType.includes("text/html")) return true;
  const head = res.body.slice(0, 500).trim().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}
