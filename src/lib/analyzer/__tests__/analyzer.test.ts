import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { checkContent, extractContent, shouldUseFallback } from "../content";
import { normalizeUrl } from "../fetch";
import { checkHeadings, findLevelSkips } from "../headings";
import { checkStructuredData, extractJsonLd } from "../jsonld";
import { checkMeta } from "../meta";
import { checkCrawlers, evaluateRobots, inspectCrawlers, type SiteFiles } from "../robots";
import { buildCategories, overallScore, scoreCategory } from "../scoring";
import { check, optionalCheck } from "../check";
import { extractSitemaps } from "../robots";
import {
  canonicalizeUrl,
  extractSitemapLocs,
  MAX_AFFECTED_SAMPLES,
  pickPages,
  summarizeCategories,
  summarizeChecks,
} from "../site";
import type { AnalysisResult, CategoryId, SitePageResult } from "../types";

describe("normalizeUrl", () => {
  it("補完: スキーム無しは https を付ける", () => {
    expect(normalizeUrl("example.com/page").toString()).toBe("https://example.com/page");
  });
  it("拒否: http/https 以外", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow();
  });
  it("フラグメントは落とす", () => {
    expect(normalizeUrl("https://example.com/a#top").toString()).toBe("https://example.com/a");
  });
});

describe("evaluateRobots", () => {
  const pageUrl = "https://example.com/company";
  const robotsUrl = "https://example.com/robots.txt";

  it("robots.txt が無ければ全許可", () => {
    const r = evaluateRobots(null, pageUrl, robotsUrl);
    expect(r.exists).toBe(false);
    expect(r.blocked).toEqual([]);
  });

  it("特定 UA の Disallow を検出する", () => {
    const txt = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /";
    const r = evaluateRobots(txt, pageUrl, robotsUrl);
    expect(r.blocked).toEqual(["GPTBot"]);
    expect(r.allowed).toContain("ClaudeBot");
  });

  it("ワイルドカードで全ブロック", () => {
    const r = evaluateRobots("User-agent: *\nDisallow: /", pageUrl, robotsUrl);
    expect(r.allowed).toEqual([]);
  });

  it("パス単位の Disallow は対象 URL にだけ効く", () => {
    const txt = "User-agent: *\nDisallow: /admin/";
    const r = evaluateRobots(txt, pageUrl, robotsUrl);
    expect(r.blocked).toEqual([]);
  });
});

const SITE_FILES: SiteFiles = {
  origin: "https://example.com",
  robotsTxt: "User-agent: *\nAllow: /\n",
  sitemaps: [],
  llmsTxt: { present: false, length: 0, status: 404 },
  llmsFullTxt: { present: false, length: 0 },
};
const NOINDEX = '<html><head><meta name="robots" content="noindex,follow"></head><body></body></html>';

const withRobots = (robotsTxt: string): SiteFiles => ({ ...SITE_FILES, robotsTxt });

const stateOf = (url: string, html = NOINDEX, files = SITE_FILES, headers = new Headers()) => {
  const pageUrl = new URL(url);
  return inspectCrawlers(pageUrl, cheerio.load(html), headers, files);
};

const crawlerChecks = (url: string, html = NOINDEX, files = SITE_FILES, headers = new Headers()) => {
  const pageUrl = new URL(url);
  const checks = checkCrawlers(pageUrl, stateOf(url, html, files, headers), files);
  return Object.fromEntries(checks.map((c) => [c.id, c]));
};

describe("noindex の採点", () => {
  const noindexOf = (url: string, html = NOINDEX, headers = new Headers()) =>
    crawlerChecks(url, html, SITE_FILES, headers)["noindex"];

  it("公開ページの noindex は未対応（配点 2）", () => {
    const c = noindexOf("https://example.com/company");
    expect(c.status).toBe("fail");
    expect(c.weight).toBe(2);
    expect(c.advice).toBeDefined();
  });

  it("X-Robots-Tag の noindex も拾う", () => {
    const c = noindexOf(
      "https://example.com/company",
      "<html><body></body></html>",
      new Headers({ "x-robots-tag": "noindex" }),
    );
    expect(c.status).toBe("fail");
  });

  // 検索結果・カート・送信完了などの noindex は意図した正しい設定。
  // 減点すると「外してください」という誤った助言になるので対象外にする
  it.each([
    ["https://example.com/search", "サイト内検索"],
    ["https://example.com/?s=%E6%96%99%E9%87%91", "サイト内検索"],
    ["https://example.com/catalogsearch/result/?q=shoes", "サイト内検索"],
    ["https://example.com/search.php", "サイト内検索"],
    ["https://example.com/cart", "カート"],
    ["https://example.com/contact/thanks", "確認・完了"],
    ["https://example.com/mypage/order", "ログイン"],
    ["https://example.com/news/1?print=1", "印刷"],
  ])("%s の noindex は減点しない", (url, kind) => {
    const c = noindexOf(url);
    expect(c.status).toBe("pass");
    // 配点（カテゴリの分母）はページ間で揃えたまま、減点だけを外す
    expect(c.weight).toBe(2);
    expect(c.earned).toBe(2);
    expect(c.label).toContain(kind);
    expect(c.evidence).toContain("対象外");
    expect(c.advice).toBeUndefined();
  });

  it("検索語の無い ?s= は検索結果とみなさない", () => {
    expect(noindexOf("https://example.com/?s=").status).toBe("fail");
  });

  it("noindex が無ければ根拠を出さずに pass", () => {
    const c = noindexOf("https://example.com/search", "<html><body></body></html>");
    expect(c.status).toBe("pass");
    expect(c.evidence).toBeUndefined();
  });
});

// もともと検索に載せないページは、採点しても直しようのない減点が並ぶだけなので
// サイト診断の集計から外す（付録に参考として残す）
describe("inspectCrawlers（採点対象にするかの判断）", () => {
  it("検索結果ページの noindex は採点対象から外す", () => {
    const { exclusion } = stateOf("https://example.com/search");
    expect(exclusion?.kind).toContain("サイト内検索");
    expect(exclusion?.by).toEqual(["noindex"]);
  });

  it("公開ページの noindex では外さない（設定ミスかもしれないため）", () => {
    expect(stateOf("https://example.com/company").exclusion).toBeNull();
  });

  it("noindex も robots.txt の拒否も無ければ外さない", () => {
    expect(stateOf("https://example.com/search", "<html><body></body></html>").exclusion).toBeNull();
  });

  it("このページだけ止める robots.txt でも外す", () => {
    const html = "<html><body></body></html>";
    const files = withRobots("User-agent: *\nDisallow: /search\n");
    expect(stateOf("https://example.com/search", html, files).exclusion?.by).toEqual(["robots"]);
    // 意図した拒否なので、クローラ可否の項目も減点しない
    const byId = crawlerChecks("https://example.com/search", html, files);
    expect(byId["ai-crawlers-allowed"].status).toBe("pass");
    expect(byId["ai-crawlers-allowed"].label).toContain("サイト内検索");
    expect(byId["ai-crawlers-allowed"].evidence).toContain("対象外");
  });

  // サイト全体を止めているなら、それは検索結果ページの都合ではなくサイトの問題
  it("サイト全体を止める robots.txt では外さず、今まで通り減点する", () => {
    const html = "<html><body></body></html>";
    const files = withRobots("User-agent: *\nDisallow: /\n");
    expect(stateOf("https://example.com/search", html, files).exclusion).toBeNull();
    expect(crawlerChecks("https://example.com/search", html, files)["ai-crawlers-allowed"].status).toBe(
      "fail",
    );
  });
});

describe("extractJsonLd", () => {
  it("@graph・入れ子・複数タグ・配列 @type を集める", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"X","sameAs":["https://x.com/x"]},
        {"@type":"WebSite","potentialAction":{"@type":"SearchAction","target":"https://e.com/?q={q}"}}
      ]}</script>
      <script type="application/ld+json">{"@type":["BreadcrumbList","Thing"],"itemListElement":[{"@type":"ListItem"}]}</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","acceptedAnswer":{"@type":"Answer"}}]}</script>
    `;
    const info = extractJsonLd(cheerio.load(html));
    expect(info.blocks).toBe(3);
    expect(info.parseErrors).toBe(0);
    expect(info.types).toEqual(
      expect.arrayContaining(["Organization", "WebSite", "SearchAction", "BreadcrumbList", "FAQPage", "Question", "Answer"]),
    );
    expect(info.hasSameAs).toBe(true);
    expect(info.hasSearchAction).toBe(true);
  });

  it("壊れた JSON はパースエラーとして数える", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization",}</script>`;
    const info = extractJsonLd(cheerio.load(html));
    expect(info.parseErrors).toBe(1);
    expect(info.types).toEqual([]);
  });

  it("schema:Organization のような接頭辞付きも扱う", () => {
    const html = `<script type="application/ld+json">{"@type":"schema:LocalBusiness"}</script>`;
    expect(extractJsonLd(cheerio.load(html)).types).toEqual(["LocalBusiness"]);
  });
});

describe("checkStructuredData", () => {
  const run = (html: string, url = "https://example.com/") =>
    Object.fromEntries(checkStructuredData(cheerio.load(html), url).map((r) => [r.id, r]));

  it("JSON-LD が無いと必須項目が fail になる", () => {
    const byId = run("<html><body></body></html>");
    expect(byId["jsonld-exists"].status).toBe("fail");
    expect(byId["jsonld-article"].status).toBe("info");
    expect(byId["jsonld-article"].weight).toBe(0);
  });

  // FAQ の無いページに FAQPage を足させるのは誤った助言なので、減点しない。
  // 配点（カテゴリの分母）はページ間で揃える必要があるので weight は残す
  it("FAQ が無いページでは FAQPage の不在を減点しない", () => {
    const byId = run("<html><body><p>会社概要です。</p></body></html>");
    expect(byId["jsonld-faq"].status).toBe("pass");
    expect(byId["jsonld-faq"].weight).toBe(2);
    expect(byId["jsonld-faq"].label).toContain("FAQPage は不要");
  });

  it("FAQ があるのに FAQPage が無ければ warn", () => {
    const html = `<html><body>
      <h2>よくあるご質問</h2>
      <h3>料金はいくらですか？</h3><p>月額 1,000 円です。</p>
      <h3>解約できますか？</h3><p>いつでも解約できます。</p>
    </body></html>`;
    const byId = run(html);
    expect(byId["jsonld-faq"].status).toBe("warn");
    expect(byId["jsonld-faq"].weight).toBe(2);
  });

  // 画面に無い内容を構造化データに書くのはガイドライン違反
  it("FAQ が無いのに FAQPage があれば warn", () => {
    const html = `<html><body><p>会社概要です。</p>
      <script type="application/ld+json">{"@type":"FAQPage"}</script></body></html>`;
    const byId = run(html);
    expect(byId["jsonld-faq"].status).toBe("warn");
    expect(byId["jsonld-faq"].label).toContain("画面に FAQ が無いのに");
  });

  // WebSite はトップページに 1 つあれば足りる
  it("下層ページでは WebSite の不在を減点しない", () => {
    const byId = run("<html><body></body></html>", "https://example.com/company/");
    expect(byId["jsonld-website"].status).toBe("pass");
    expect(byId["jsonld-website"].weight).toBe(1);
    expect(byId["jsonld-website"].label).toContain("トップページにあれば足りる");
  });

  it("トップページでは WebSite が無いと warn", () => {
    const byId = run("<html><body></body></html>", "https://example.com/");
    expect(byId["jsonld-website"].status).toBe("warn");
    expect(byId["jsonld-website"].weight).toBe(1);
  });

  // パンくずは上位階層への経路を示すもの。最上位のトップページには示す位置が無い
  it("トップページではパンくずの不在を減点しない", () => {
    const byId = run("<html><body></body></html>", "https://example.com/index.html");
    expect(byId["jsonld-breadcrumb"].status).toBe("pass");
    expect(byId["jsonld-breadcrumb"].weight).toBe(1);
    expect(byId["jsonld-breadcrumb"].label).toContain("トップページのため");
    expect(byId["jsonld-breadcrumb"].advice).toBeUndefined();
  });

  it("下層ページではパンくずが無いと warn", () => {
    const byId = run("<html><body></body></html>", "https://example.com/company/");
    expect(byId["jsonld-breadcrumb"].status).toBe("warn");
    expect(byId["jsonld-breadcrumb"].weight).toBe(1);
  });
});

describe("checkMeta", () => {
  it("すべて揃っていれば pass", () => {
    const html = `<html lang="ja"><head>
      <title>株式会社Wolf | 会社情報</title>
      <meta name="description" content="${"あ".repeat(60)}">
      <meta property="og:title" content="t"><meta property="og:description" content="d">
      <link rel="canonical" href="https://example.com/">
    </head></html>`;
    const results = checkMeta(cheerio.load(html));
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  it("title 無し・description 無しは fail", () => {
    const results = checkMeta(cheerio.load("<html><head></head></html>"));
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId.title).toBe("fail");
    expect(byId.description).toBe("fail");
    expect(byId.ogp).toBe("fail");
  });
});

describe("headings", () => {
  it("階層飛びを数える", () => {
    expect(findLevelSkips([1, 2, 3, 2, 3])).toBe(0);
    expect(findLevelSkips([1, 3])).toBe(1);
    expect(findLevelSkips([2, 4, 2, 5])).toBe(2);
  });

  it("h1 が 1 つで h2 があれば pass", () => {
    const html = "<h1>Title</h1><h2>A</h2><h3>a1</h3><h2>B</h2>";
    const results = checkHeadings(cheerio.load(html));
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });

  it("h1 が複数なら warn、h1 無しなら fail", () => {
    expect(checkHeadings(cheerio.load("<h1>a</h1><h1>b</h1><h2>c</h2>"))[0].status).toBe("warn");
    expect(checkHeadings(cheerio.load("<h2>c</h2>"))[0].status).toBe("fail");
  });

  it("空の見出しは無視する", () => {
    expect(checkHeadings(cheerio.load("<h1></h1><h1>real</h1><h2>x</h2>"))[0].status).toBe("pass");
  });
});

describe("content", () => {
  function page(bodyText: string, scripts = 0) {
    const s = Array.from({ length: scripts }, (_, i) => `<script src="/app${i}.js"></script>`).join("");
    return `<html><head><title>t</title>${s}</head><body><nav>menu menu</nav><main><h1>見出し</h1><p>${bodyText}</p></main><footer>foot</footer></body></html>`;
  }

  // 文字数そのものは採点しない（Google は推奨文字数を持たないと明言している）。
  // 参考値として必ず出るが、配点は 0
  it("本文の分量は参考値で、採点には効かない", () => {
    const html = page("日本語の本文です。".repeat(250));
    const $ = cheerio.load(html);
    const info = extractContent(html, "https://example.com/", $);
    expect(info.mainTextLength).toBeGreaterThanOrEqual(1500);
    const len = checkContent(info).find((r) => r.id === "content-length");
    expect(len?.status).toBe("info");
    expect(len?.weight).toBe(0);
  });

  // 長くても具体的な事実が無いページは通さない。逆に短くても具体的なら通す
  it("長いだけで具体情報が無い本文は content-specificity で fail", () => {
    const html = page("弊社は価値を提供する会社です。".repeat(250));
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    const spec = checkContent(info).find((r) => r.id === "content-specificity");
    expect(spec?.status).toBe("fail");
  });

  it("短くても具体情報があれば content-specificity は pass", () => {
    const html = page(
      "お問い合わせは電話 03-1234-5678 までご連絡ください。受付時間は平日 9:00 から 18:00 です。創業は 1998 年です。",
    );
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    expect(info.mainTextLength).toBeLessThan(1500);
    const spec = checkContent(info).find((r) => r.id === "content-specificity");
    expect(spec?.status).toBe("pass");
  });

  // 一覧・受付など文章がほとんど無いページは fail にしない
  it("文がほとんど無いページは fail ではなく warn に留める", () => {
    const html = page("会社案内");
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    const spec = checkContent(info).find((r) => r.id === "content-specificity");
    expect(spec?.status).toBe("warn");
  });

  it("テキストがほぼ無く script が多ければ JS 依存を疑う", () => {
    const html = page("", 4);
    const $ = cheerio.load(html);
    const info = extractContent(html, "https://example.com/", $);
    const byId = Object.fromEntries(checkContent(info).map((r) => [r.id, r.status]));
    expect(byId["js-rendering"]).toBe("fail");
  });

  it("見出しだけで本文の無いページを拾う", () => {
    const html = `<html><body><main>
      <h2>サービス</h2><h2>会社概要</h2><h2>お問い合わせ</h2>
    </main></body></html>`;
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    expect(info.mainHeadings).toBe(3);
    expect(info.headingsWithoutBody).toBe(3);
    const hb = checkContent(info).find((r) => r.id === "content-heading-body");
    expect(hb?.status).toBe("fail");
  });

  it("見出しに本文が伴っていれば pass", () => {
    const html = `<html><body><main>
      <h2>サービス</h2><p>2015 年から 300 社以上に導入しています。</p>
      <h2>料金</h2><p>初期費用は 50,000 円、月額は 10,000 円です。</p>
    </main></body></html>`;
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    expect(info.headingsWithoutBody).toBe(0);
    const hb = checkContent(info).find((r) => r.id === "content-heading-body");
    expect(hb?.status).toBe("pass");
  });

  it("alt の無い画像を数える", () => {
    const html = `<body><img src="a.png" alt="A"><img src="b.png"><img src="c.png" alt=""></body>`;
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    expect(info.images).toBe(3);
    expect(info.imagesWithoutAlt).toBe(2);
  });

  // 画像の有無でカテゴリの満点（分母）が変わると、同じサイトのページ同士を
  // 比べたときに本文量が同じでもスコアがずれる
  it("画像が 0 枚でも image-alt を pass として必ず出す", () => {
    const html = page("日本語の本文です。".repeat(250));
    const info = extractContent(html, "https://example.com/", cheerio.load(html));
    const alt = checkContent(info).find((r) => r.id === "image-alt");
    expect(alt).toBeDefined();
    expect(alt!.status).toBe("pass");
    expect(alt!.weight).toBe(1);
  });

  it("画像の有無でコンテンツカテゴリの配点合計が変わらない", () => {
    const body = "日本語の本文です。".repeat(60); // content-length が warn になる程度
    const withoutImages = page(body);
    const withImages = page(body).replace("</main>", '<img src="a.png" alt="A"></main>');

    const totals = [withoutImages, withImages].map((html) => {
      const info = extractContent(html, "https://example.com/", cheerio.load(html));
      return checkContent(info).reduce((sum, c) => sum + c.weight, 0);
    });
    expect(totals[0]).toBe(totals[1]);

    // 配点が揃うので、alt が完備なら両ページのカテゴリ点も一致する
    const scores = [withoutImages, withImages].map((html) => {
      const info = extractContent(html, "https://example.com/", cheerio.load(html));
      return scoreCategory(checkContent(info));
    });
    expect(scores[0]).toBe(scores[1]);
  });
});

describe("shouldUseFallback", () => {
  it("抽出結果が 300 文字未満ならフォールバック", () => {
    expect(shouldUseFallback(0)).toBe(true);
    expect(shouldUseFallback(299)).toBe(true);
  });

  it("300 文字以上あればフォールバックしない", () => {
    expect(shouldUseFallback(300)).toBe(false);
    expect(shouldUseFallback(2000)).toBe(false);
  });
});

describe("scoring", () => {
  it("warn は半分、info は無視", () => {
    const checks = [
      check({ id: "a", category: "meta", status: "pass", weight: 2, label: "" }),
      check({ id: "b", category: "meta", status: "warn", weight: 2, label: "" }),
      check({ id: "c", category: "meta", status: "fail", weight: 1, label: "" }),
      optionalCheck({ id: "d", category: "meta", present: false, label: "" }),
    ];
    // (2 + 1 + 0) / 5 = 60
    expect(scoreCategory(checks)).toBe(60);
  });

  it("空カテゴリは 100", () => {
    expect(scoreCategory([])).toBe(100);
  });

  it("総合はカテゴリ重みの加重平均", () => {
    const categories = buildCategories([
      check({ id: "x", category: "crawlers", status: "fail", weight: 1, label: "" }),
    ]);
    // crawlers 0点 (重み15), 他 9 カテゴリは 100 点 (重み合計85) → 85
    expect(overallScore(categories)).toBe(85);
  });
});

describe("extractSitemaps", () => {
  it("robots.txt の Sitemap 行を集める", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /admin/",
      "Sitemap: https://example.com/sitemap.xml",
      "sitemap:https://example.com/news-sitemap.xml",
      "Sitemap: https://example.com/sitemap.xml",
    ].join("\n");
    expect(extractSitemaps(txt)).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/news-sitemap.xml",
    ]);
  });

  it("robots.txt が無ければ空", () => {
    expect(extractSitemaps(null)).toEqual([]);
  });
});

describe("extractSitemapLocs", () => {
  it("<loc> を取り出して実体参照を戻す", () => {
    const xml = `<urlset><url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/company</loc></url>
      <url><loc>https://example.com/s?a=1&amp;b=2</loc></url></urlset>`;
    expect(extractSitemapLocs(xml)).toEqual([
      "https://example.com/",
      "https://example.com/company",
      "https://example.com/s?a=1&b=2",
    ]);
  });
});

describe("canonicalizeUrl", () => {
  it("フラグメント・末尾スラッシュ・計測パラメータを揃える", () => {
    expect(canonicalizeUrl("https://example.com/company/")).toBe("https://example.com/company");
    expect(canonicalizeUrl("https://example.com/company?utm=1#a")).toBe(
      "https://example.com/company",
    );
    // トップのスラッシュは残す
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
    // 意味のあるクエリは別ページとして残す
    expect(canonicalizeUrl("https://example.com/?p=12")).toBe("https://example.com/?p=12");
  });

  it("相対 URL を base で解決する", () => {
    expect(canonicalizeUrl("/company", "https://example.com/top")).toBe(
      "https://example.com/company",
    );
  });

  it("http/https 以外は捨てる", () => {
    expect(canonicalizeUrl("mailto:a@example.com")).toBeNull();
    expect(canonicalizeUrl("javascript:void(0)")).toBeNull();
  });
});

describe("pickPages", () => {
  it("入力 URL を先頭にし、残りは階層の浅い順", () => {
    const picked = pickPages(
      "https://example.com/company",
      [
        "https://example.com/blog/2024/01/deep-article",
        "https://example.com/",
        "https://example.com/company",
        "https://example.com/service",
      ],
      3,
    );
    expect(picked).toEqual([
      "https://example.com/company",
      "https://example.com/",
      "https://example.com/service",
    ]);
  });
});

// --- サイト集計 --------------------------------------------------------------

function fakeAnalysis(
  url: string,
  checks: { id: string; category: CategoryId; status: "pass" | "warn" | "fail" }[],
): { url: string; result: AnalysisResult } {
  const built = checks.map((c) =>
    check({ ...c, weight: 1, label: `${c.id}:${c.status}`, advice: "こう直す" }),
  );
  return {
    url,
    result: {
      page: {
        url,
        finalUrl: url,
        status: 200,
        title: null,
        description: null,
        lang: null,
        mainText: "",
        mainTextLength: 0,
        rawTextLength: 0,
        jsonLdTypes: [],
        h1Count: 1,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      },
      exclusion: null,
      overall: 0,
      categories: buildCategories(built),
      notes: [],
    },
  };
}

describe("summarizeChecks", () => {
  const analyses = [
    fakeAnalysis("https://example.com/", [
      { id: "jsonld-breadcrumb", category: "structuredData", status: "warn" },
      { id: "jsonld-website", category: "structuredData", status: "pass" },
      { id: "llms-txt", category: "crawlers", status: "warn" },
    ]),
    fakeAnalysis("https://example.com/company", [
      { id: "jsonld-breadcrumb", category: "structuredData", status: "pass" },
      { id: "jsonld-website", category: "structuredData", status: "pass" },
      { id: "llms-txt", category: "crawlers", status: "warn" },
    ]),
  ];

  it("ページで判定が分かれた項目を mixed にする", () => {
    const byId = Object.fromEntries(summarizeChecks(analyses).map((s) => [s.id, s]));
    expect(byId["jsonld-breadcrumb"].spread).toBe("mixed");
    expect(byId["jsonld-breadcrumb"].counts).toMatchObject({ pass: 1, warn: 1 });
    expect(byId["jsonld-breadcrumb"].affected.map((a) => a.url)).toEqual(["https://example.com/"]);
  });

  it("全ページ同じ判定なら uniform", () => {
    const byId = Object.fromEntries(summarizeChecks(analyses).map((s) => [s.id, s]));
    expect(byId["llms-txt"].spread).toBe("uniform");
    expect(byId["llms-txt"].affected).toHaveLength(2);
    expect(byId["jsonld-website"].spread).toBe("uniform");
    expect(byId["jsonld-website"].affected).toEqual([]);
  });

  it("ばらついた項目を先頭に並べる", () => {
    expect(summarizeChecks(analyses)[0].id).toBe("jsonld-breadcrumb");
  });

  it("該当ページの実例は上限まで（件数は counts が持つ）", () => {
    const many = Array.from({ length: MAX_AFFECTED_SAMPLES + 12 }, (_, i) =>
      fakeAnalysis(`https://example.com/p${i}`, [
        { id: "llms-txt", category: "crawlers", status: "fail" },
      ]),
    );
    const [summary] = summarizeChecks(many);
    expect(summary.counts.fail).toBe(MAX_AFFECTED_SAMPLES + 12);
    expect(summary.affected).toHaveLength(MAX_AFFECTED_SAMPLES);
  });
});

describe("summarizeCategories", () => {
  const pages: SitePageResult[] = [
    {
      url: "https://example.com/",
      overall: 80,
      scores: { crawlers: 70, structuredData: 90, meta: 100, headings: 100, content: 100, trust: 100, contact: 100, performance: 100, security: 100, mobile: 100 },
      page: fakeAnalysis("https://example.com/", []).result.page,
    },
    {
      url: "https://example.com/company",
      overall: 60,
      scores: { crawlers: 70, structuredData: 60, meta: 80, headings: 100, content: 50, trust: 100, contact: 100, performance: 100, security: 100, mobile: 100 },
      page: fakeAnalysis("https://example.com/company", []).result.page,
    },
  ];

  it("平均・最小・最大と最低点のページを出す", () => {
    const byId = Object.fromEntries(summarizeCategories(pages).map((c) => [c.id, c]));
    expect(byId.structuredData).toMatchObject({
      score: 75,
      min: 60,
      max: 90,
      worstUrl: "https://example.com/company",
    });
    // 全ページ同点のカテゴリは幅が出ない
    expect(byId.crawlers).toMatchObject({ score: 70, min: 70, max: 70 });
  });
});
