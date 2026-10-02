/**
 * クロールで使う URL まわりの純関数。
 *
 * ネットワークに出ないので、無料診断（analyzer/site.ts）と A1 サイト診断の
 * 両方から安全に import できる。
 */

/** 明らかに HTML ではない URL を弾く（パス末尾の拡張子で判定） */
export const NON_HTML_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|rss|atom|zip|gz|tgz|tar|7z|rar|mp[34]|m4a|wav|ogg|mov|webm|woff2?|ttf|eot|otf|docx?|xlsx?|pptx?|csv|txt|bmp|tiff?|apk|dmg|exe)$/i;

/**
 * 計測用パラメータ。ページの中身を変えないので落として同一視する。
 * 前方一致（utm_ など）と完全一致の両方を見る。
 */
const TRACKING_PARAM_PREFIXES = ["utm_", "pk_", "mtm_", "_hs", "vero_", "oly_", "hsa_"];
const TRACKING_PARAMS = new Set([
  "utm",
  "gclid",
  "gclsrc",
  "dclid",
  "wbraid",
  "gbraid",
  "fbclid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref",
  "ref_src",
  "spm",
  "cmpid",
  "campaignid",
  "adgroupid",
  "s_kwcid",
  "icid",
  "trk",
  "yadcid",
  "yadid",
]);

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  if (TRACKING_PARAMS.has(key)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * URL を「同じページ」と見なす形に揃える。
 *
 * 末尾スラッシュ・フラグメント・認証情報・計測用パラメータ（utm_* や gclid など）
 * の差で同じページを二重に診断しないための正規化。
 *
 * クエリ文字列そのものは残す。`?p=123` や `?id=5` のようにクエリでページを
 * 出し分ける CMS は多く、まとめて落とすと別々のページが 1 つに潰れて
 * 「全ページを診断する」という前提が崩れるため。残したパラメータは
 * 並び順の違いで別 URL 扱いにならないよう名前順に整える。
 *
 * http/https 以外（mailto: / tel: / javascript: など）は null。
 */
export function canonicalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";

  if (url.search) {
    const kept: [string, string][] = [];
    for (const [name, value] of url.searchParams) {
      if (!isTrackingParam(name)) kept.push([name, value]);
    }
    kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    const params = new URLSearchParams();
    for (const [name, value] of kept) params.append(name, value);
    const query = params.toString();
    url.search = query ? `?${query}` : "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

/** HTML ページらしい URL か（拡張子ベースの簡易判定） */
export function looksLikeHtmlUrl(url: string): boolean {
  try {
    return !NON_HTML_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * origin と同じサイトの URL なら、origin のスキームに揃えて返す。
 * robots.txt の Sitemap 行や sitemap.xml の <loc> が http:// のまま残っている
 * サイトは多く、https の origin と単純比較すると全部落ちてしまうため。
 * ホスト（ポート含む）が違えば null。
 */
export function alignToOrigin(url: string, origin: string): string | null {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(origin);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (target.host !== base.host) return null;
  if (target.protocol !== base.protocol) target.protocol = base.protocol;
  return target.toString();
}

/** パスの階層数（"/" = 0, "/a/b" = 2）。URL が壊れていれば大きな値 */
export function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * 階層の浅い順に並べる（同じ深さなら元の順序を保つ）。
 * クロールの種を「トップ → 主要ページ → 記事」の順に取りに行くために使う。
 */
export function sortShallowFirst(urls: readonly string[]): string[] {
  return urls
    .map((url, index) => ({ url, index, depth: pathDepth(url) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((x) => x.url);
}

/**
 * 数値文字参照を 1 文字に戻す。
 * Unicode の範囲外（`&#x110000;` など）は String.fromCodePoint が RangeError を投げるので、
 * 元の文字列のまま返す。第三者のページやサイトマップの壊れた文字参照で
 * クロール全体が落ちないようにするため。
 */
function codePointOrRaw(raw: string, digits: string, radix: number): string {
  const cp = parseInt(digits, radix);
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return raw;
  return String.fromCodePoint(cp);
}

/** XML / HTML の基本的な文字参照を戻す */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m: string, hex: string) => codePointOrRaw(m, hex, 16))
    .replace(/&#(\d+);/g, (m: string, dec: string) => codePointOrRaw(m, dec, 10))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** sitemap.xml / sitemapindex から <loc> を取り出す（種類は区別しない） */
export function extractSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    locs.push(decodeEntities(m[1]));
  }
  return locs;
}

/** URL がサイトマップファイルを指していそうか */
export function isSitemapUrl(url: string): boolean {
  return /sitemap[^/?#]*\.xml(\.gz)?(?:[?#]|$)/i.test(url) || /\.xml\.gz(?:[?#]|$)/i.test(url);
}

export interface SitemapEntries {
  /** 子サイトマップ（sitemapindex の <sitemap><loc>） */
  sitemaps: string[];
  /** ページ URL（urlset の <url><loc>、またはテキスト形式の 1 行 1 URL） */
  urls: string[];
  kind: "index" | "urlset" | "text" | "unknown";
}

/**
 * サイトマップの中身を「子サイトマップ」と「ページ URL」に分ける。
 * - `<sitemapindex>` … すべて子サイトマップ
 * - `<urlset>` … すべてページ URL（`<image:loc>` などは `<loc>` に一致しないので混ざらない）
 * - どちらのタグも無い XML … URL の見た目で判定
 * - XML ですらない … 1 行 1 URL のテキスト形式として読む
 */
export function extractSitemapEntries(body: string): SitemapEntries {
  const head = body.slice(0, 4096);
  if (/<sitemapindex[\s>]/i.test(head)) {
    return { sitemaps: extractSitemapLocs(body), urls: [], kind: "index" };
  }
  if (/<urlset[\s>]/i.test(head)) {
    return { sitemaps: [], urls: extractSitemapLocs(body), kind: "urlset" };
  }
  if (/<loc>/i.test(body)) {
    const locs = extractSitemapLocs(body);
    return {
      sitemaps: locs.filter(isSitemapUrl),
      urls: locs.filter((u) => !isSitemapUrl(u)),
      kind: "unknown",
    };
  }
  if (!/^\s*</.test(head)) {
    const urls = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\/\S+$/i.test(l));
    if (urls.length > 0) {
      return {
        sitemaps: urls.filter(isSitemapUrl),
        urls: urls.filter((u) => !isSitemapUrl(u)),
        kind: "text",
      };
    }
  }
  return { sitemaps: [], urls: [], kind: "unknown" };
}

const SKIP_SCHEME = /^(mailto|tel|sms|javascript|data|ftp|file|blob|about):/i;

/**
 * HTML から内部リンク候補を集める（<a href> / <area href>）。
 * `<base href>` を尊重し、相対 URL は `baseUrl` で解決、canonicalizeUrl で揃えて
 * 文書順のまま重複を除く。オリジンの判定は呼び出し側で行う。
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  let base = baseUrl;
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  if (baseTag) {
    const candidate = decodeEntities((baseTag[1] ?? baseTag[2] ?? baseTag[3] ?? "").trim());
    try {
      base = new URL(candidate, baseUrl).toString();
    } catch {
      /* 壊れた base は無視 */
    }
  }

  const found = new Set<string>();
  for (const tag of html.matchAll(/<(?:a|area)\b[^>]*>/gi)) {
    const attr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
    if (!attr) continue;
    const raw = decodeEntities((attr[1] ?? attr[2] ?? attr[3] ?? "").trim());
    if (!raw || raw.startsWith("#") || SKIP_SCHEME.test(raw)) continue;
    const abs = canonicalizeUrl(raw, base);
    if (abs) found.add(abs);
  }
  return [...found];
}

/** 取得結果が HTML かどうか（Content-Type または本文の先頭で判定） */
export function looksLikeHtmlResponse(page: { contentType: string; body: string }): boolean {
  if (/html|xhtml/i.test(page.contentType)) return true;
  const head = page.body.slice(0, 2000);
  return /<!doctype\s+html/i.test(head) || /<html[\s>]/i.test(head);
}
