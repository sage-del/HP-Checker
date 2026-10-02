import { describe, expect, it } from "vitest";
import { checkLinks, isBrokenStatus } from "../check";
import { extractRefs, MAX_SOURCES, RefCollector } from "../extract";

const origin = "https://example.com";

describe("extractRefs", () => {
  it("collects same-site links, images, stylesheets and scripts", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="/css/site.css">
      <link rel="preload icon" href="/favicon.ico">
      <script src="/js/app.js?utm_source=x"></script>
      <script>inline()</script>
    </head><body>
      <a href="/about/">会社概要</a>
      <a href="http://example.com/contact">http のままの内部リンク</a>
      <a href="https://other.example/">外部</a>
      <a href="#top">ページ内</a>
      <a href="mailto:info@example.com">メール</a>
      <img src="/img/logo.png" alt="">
      <img src="data:image/png;base64,AAAA" alt="">
      <!-- <a href="/commented-out">消したリンク</a> -->
      <a href="/about">重複</a>
    </body></html>`;
    expect(extractRefs(html, "https://example.com/", origin)).toEqual([
      { url: "https://example.com/css/site.css", kind: "stylesheet" },
      { url: "https://example.com/js/app.js", kind: "script" },
      { url: "https://example.com/about", kind: "link" },
      { url: "https://example.com/contact", kind: "link" },
      { url: "https://example.com/img/logo.png", kind: "image" },
    ]);
  });

  it("resolves relative URLs against <base href>", () => {
    const html = `<base href="https://example.com/blog/"><a href="post-1">記事</a>`;
    expect(extractRefs(html, "https://example.com/", origin)).toEqual([
      { url: "https://example.com/blog/post-1", kind: "link" },
    ]);
  });
});

describe("RefCollector", () => {
  it("groups sources per target and caps the samples", () => {
    const c = new RefCollector();
    for (let i = 0; i < MAX_SOURCES + 3; i++) {
      c.add(`https://example.com/p${i}`, [{ url: "https://example.com/gone", kind: "link" }]);
    }
    // 自分自身へのリンクは数えない
    c.add("https://example.com/gone", [{ url: "https://example.com/gone", kind: "link" }]);
    const t = c.targets.get("https://example.com/gone")!;
    expect(t.sourceCount).toBe(MAX_SOURCES + 3);
    expect(t.sources).toHaveLength(MAX_SOURCES);
  });
});

describe("checkLinks", () => {
  it("classifies broken statuses", () => {
    expect([0, 404, 410, 500, 503].every(isBrokenStatus)).toBe(true);
    expect([200, 301, 401, 403, 429].some(isBrokenStatus)).toBe(false);
  });

  it("uses crawl statuses, probes the rest, and sorts broken links by severity and impact", async () => {
    const c = new RefCollector();
    c.add("https://example.com/", [
      { url: "https://example.com/ok", kind: "link" },
      { url: "https://example.com/crawled-404", kind: "link" },
      { url: "https://example.com/img/missing.png", kind: "image" },
      { url: "https://example.com/down", kind: "link" },
      { url: "https://example.com/forbidden", kind: "link" },
    ]);
    c.add("https://example.com/a", [{ url: "https://example.com/img/missing.png", kind: "image" }]);

    const probed: string[] = [];
    const statuses: Record<string, number> = {
      "https://example.com/img/missing.png": 404,
      "https://example.com/down": 0,
      "https://example.com/forbidden": 403,
    };
    const result = await checkLinks({
      targets: c.targets,
      known: new Map([
        ["https://example.com/ok", 200],
        ["https://example.com/crawled-404", 404],
      ]),
      probe: async (url) => {
        probed.push(url);
        return statuses[url];
      },
    });

    expect(probed.sort()).toEqual(
      ["https://example.com/down", "https://example.com/forbidden", "https://example.com/img/missing.png"].sort(),
    );
    expect(result.found).toBe(5);
    expect(result.checked).toBe(5);
    expect(result.unchecked).toBe(0);
    expect(result.broken.map((b) => [b.url, b.status, b.sourceCount])).toEqual([
      ["https://example.com/img/missing.png", 404, 2],
      ["https://example.com/crawled-404", 404, 1],
      ["https://example.com/down", 0, 1],
    ]);
  });

  it("stops at the check limit and reports what was left unchecked", async () => {
    const c = new RefCollector();
    c.add(
      "https://example.com/",
      Array.from({ length: 5 }, (_, i) => ({ url: `https://example.com/p${i}`, kind: "link" as const })),
    );
    const result = await checkLinks({ targets: c.targets, maxChecks: 2, probe: async () => 200 });
    expect(result.checked).toBe(2);
    expect(result.unchecked).toBe(3);
  });
});
