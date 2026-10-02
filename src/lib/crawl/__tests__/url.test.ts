import { describe, expect, it } from "vitest";
import {
  alignToOrigin,
  canonicalizeUrl,
  decodeEntities,
  extractLinks,
  extractSitemapEntries,
  isSitemapUrl,
  looksLikeHtmlResponse,
  looksLikeHtmlUrl,
  sortShallowFirst,
} from "../url";

describe("canonicalizeUrl", () => {
  it("末尾スラッシュ・フラグメント・認証情報を落とす", () => {
    expect(canonicalizeUrl("https://example.com/a/#top")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://user:pw@example.com/")).toBe("https://example.com/");
    expect(canonicalizeUrl("/rel", "https://example.com/base/")).toBe("https://example.com/rel");
  });
  it("意味のあるクエリは残す（クエリで出し分ける CMS を別ページとして数える）", () => {
    expect(canonicalizeUrl("https://example.com/a?x=1#top")).toBe("https://example.com/a?x=1");
    expect(canonicalizeUrl("https://example.com/?p=123")).toBe("https://example.com/?p=123");
    // 並び順が違うだけの URL は同じページとして扱う
    expect(canonicalizeUrl("https://example.com/a?b=2&a=1")).toBe(
      canonicalizeUrl("https://example.com/a?a=1&b=2"),
    );
  });
  it("計測用パラメータだけを落とす", () => {
    expect(canonicalizeUrl("https://example.com/a?utm_source=x")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://example.com/a?gclid=1&fbclid=2")).toBe("https://example.com/a");
    expect(canonicalizeUrl("https://example.com/a?utm_medium=m&id=7")).toBe(
      "https://example.com/a?id=7",
    );
  });
  it("http/https 以外は null", () => {
    expect(canonicalizeUrl("mailto:a@example.com")).toBeNull();
    expect(canonicalizeUrl("javascript:void(0)")).toBeNull();
    expect(canonicalizeUrl("::nope")).toBeNull();
  });
});

describe("looksLikeHtmlUrl / alignToOrigin", () => {
  it("拡張子で非 HTML を弾く（クエリは見ない）", () => {
    expect(looksLikeHtmlUrl("https://example.com/a.pdf")).toBe(false);
    expect(looksLikeHtmlUrl("https://example.com/a.PNG")).toBe(false);
    expect(looksLikeHtmlUrl("https://example.com/page.php")).toBe(true);
    expect(looksLikeHtmlUrl("https://example.com/dir/")).toBe(true);
  });
  it("同じホストなら origin のスキームに揃え、別ホストは null", () => {
    expect(alignToOrigin("http://example.com/sitemap.xml", "https://example.com")).toBe(
      "https://example.com/sitemap.xml",
    );
    expect(alignToOrigin("https://www.example.com/", "https://example.com")).toBeNull();
    expect(alignToOrigin("ftp://example.com/x", "https://example.com")).toBeNull();
  });
});

describe("sortShallowFirst", () => {
  it("階層の浅い順、同じ深さは元の順序", () => {
    expect(
      sortShallowFirst([
        "https://e.com/blog/2024/a",
        "https://e.com/service",
        "https://e.com/",
        "https://e.com/company",
      ]),
    ).toEqual([
      "https://e.com/",
      "https://e.com/service",
      "https://e.com/company",
      "https://e.com/blog/2024/a",
    ]);
  });
});

describe("extractSitemapEntries", () => {
  it("sitemapindex は全部子サイトマップ", () => {
    const r = extractSitemapEntries(
      `<?xml version="1.0"?><sitemapindex xmlns="x"><sitemap><loc>https://e.com/a.xml</loc></sitemap><sitemap><loc>https://e.com/b.xml</loc></sitemap></sitemapindex>`,
    );
    expect(r.kind).toBe("index");
    expect(r.sitemaps).toEqual(["https://e.com/a.xml", "https://e.com/b.xml"]);
    expect(r.urls).toEqual([]);
  });
  it("urlset は全部ページ URL（image:loc は混ざらない、実体参照は戻す）", () => {
    const r = extractSitemapEntries(
      `<urlset xmlns="x" xmlns:image="y"><url><loc>https://e.com/p?a=1&amp;b=2</loc><image:loc>https://e.com/i.png</image:loc></url></urlset>`,
    );
    expect(r.kind).toBe("urlset");
    expect(r.urls).toEqual(["https://e.com/p?a=1&b=2"]);
    expect(r.sitemaps).toEqual([]);
  });
  it("タグが無ければ URL の見た目で分ける", () => {
    const r = extractSitemapEntries(
      `<loc>https://e.com/sitemap-posts.xml</loc><loc>https://e.com/page</loc>`,
    );
    expect(r.sitemaps).toEqual(["https://e.com/sitemap-posts.xml"]);
    expect(r.urls).toEqual(["https://e.com/page"]);
  });
  it("テキスト形式（1 行 1 URL）も読む", () => {
    const r = extractSitemapEntries("https://e.com/a\n\nhttps://e.com/b\r\nnot a url\n");
    expect(r.kind).toBe("text");
    expect(r.urls).toEqual(["https://e.com/a", "https://e.com/b"]);
  });
  it("HTML（404 ページなど）は何も返さない", () => {
    const r = extractSitemapEntries("<!doctype html><html><body>not found</body></html>");
    expect(r.urls).toEqual([]);
    expect(r.sitemaps).toEqual([]);
  });
});

describe("isSitemapUrl", () => {
  it("sitemap*.xml / .xml.gz を判定する", () => {
    expect(isSitemapUrl("https://e.com/sitemap.xml")).toBe(true);
    expect(isSitemapUrl("https://e.com/sitemap-posts.xml?page=2")).toBe(true);
    expect(isSitemapUrl("https://e.com/post-sitemap.xml.gz")).toBe(true);
    expect(isSitemapUrl("https://e.com/sitemap/")).toBe(false);
    expect(isSitemapUrl("https://e.com/page")).toBe(false);
  });
});

describe("extractLinks", () => {
  it("相対 URL を解決し、非ページ系スキームとフラグメントだけのリンクを除く", () => {
    const html = `
      <a href="/a">a</a>
      <a href='b/'>b</a>
      <a href=c?x=1>c</a>
      <a href="#top">top</a>
      <a href="mailto:x@e.com">mail</a>
      <a href="tel:0312345678">tel</a>
      <a href="javascript:void(0)">js</a>
      <a href="https://other.example/x">ext</a>
      <a href="/a#frag">dup</a>
      <a class="x" href="/d&amp;e" rel="nofollow">amp</a>
      <area href="/map">
    `;
    expect(extractLinks(html, "https://e.com/dir/page")).toEqual([
      "https://e.com/a",
      "https://e.com/dir/b",
      "https://e.com/dir/c?x=1",
      "https://other.example/x",
      "https://e.com/d&e",
      "https://e.com/map",
    ]);
  });
  it("<base href> を尊重する", () => {
    const html = `<head><base href="https://e.com/sub/"></head><a href="x">x</a>`;
    expect(extractLinks(html, "https://e.com/")).toEqual(["https://e.com/sub/x"]);
  });
});

describe("looksLikeHtmlResponse", () => {
  it("Content-Type か本文の先頭で判定する", () => {
    expect(looksLikeHtmlResponse({ contentType: "text/html; charset=utf-8", body: "" })).toBe(true);
    expect(looksLikeHtmlResponse({ contentType: "", body: "<!DOCTYPE html><html>" })).toBe(true);
    expect(looksLikeHtmlResponse({ contentType: "application/json", body: "{}" })).toBe(false);
  });
});

describe("decodeEntities", () => {
  it("基本的な文字参照を戻す", () => {
    expect(decodeEntities("a&amp;b&#x3042;&#12356;&quot;&lt;&gt;&#39;")).toBe('a&bあい"<>\'');
  });
  it("Unicode の範囲外・壊れた数値文字参照は元の文字列のまま残す（例外を投げない）", () => {
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
    expect(decodeEntities("&#xFFFFFFFF;")).toBe("&#xFFFFFFFF;");
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
    expect(decodeEntities("https://e.com/a?x=1&#x110000;&amp;y=2")).toBe(
      "https://e.com/a?x=1&#x110000;&y=2",
    );
  });
});

describe("extractLinks / extractSitemapEntries は壊れた文字参照でも落ちない", () => {
  it("範囲外の文字参照を含む href とサイトマップ", () => {
    expect(() =>
      extractLinks(`<a href="/a&#x110000;">x</a>`, "https://e.com/"),
    ).not.toThrow();
    expect(() =>
      extractSitemapEntries("<urlset><loc>https://e.com/&#99999999;</loc></urlset>"),
    ).not.toThrow();
  });
});
