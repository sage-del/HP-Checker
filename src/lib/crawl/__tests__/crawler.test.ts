import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FetchedText } from "@/lib/analyzer/fetch";
import type { SiteFiles } from "@/lib/analyzer/robots";
import { crawlSite, resolveMaxPages } from "../crawler";
import type { CrawlProgress } from "../types";

let server: Server;
let other: Server;
let origin: string;
let otherOrigin: string;
const hits: string[] = [];

const page = (title: string, links: string[]) =>
  `<!doctype html><html lang="ja"><head><title>${title}</title></head><body><h1>${title}</h1>${links
    .map((l) => `<a href="${l}">${l}</a>`)
    .join("")}</body></html>`;

function files(sitemaps: string[] = []): SiteFiles {
  return {
    origin,
    robotsTxt: null,
    sitemaps,
    llmsTxt: { present: false, length: 0, status: 404 },
    llmsFullTxt: { present: false, length: 0 },
  };
}

/** visit() で受け取った URL を集めるだけの共通オプション */
function collector() {
  const visited: string[] = [];
  const progress: CrawlProgress[] = [];
  return {
    visited,
    progress,
    onProgress: (p: CrawlProgress) => progress.push(p),
    visit: (_page: FetchedText, url: string) => {
      visited.push(new URL(url).pathname);
    },
  };
}

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";

  other = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page("other site " + req.url, []));
  });
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;

  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    hits.push(req.url ?? "/");
    const html = (body: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    const redirect = (to: string, status = 302) => {
      res.writeHead(status, { location: to });
      res.end();
    };

    // 遅いページ群（時間予算のテスト）
    if (path.startsWith("/slow")) {
      const links = path === "/slow" ? [1, 2, 3, 4, 5, 6].map((i) => `/slow/${i}`) : [];
      setTimeout(() => html(page(path, links)), 150);
      return;
    }

    switch (path) {
      // リンクだけのサイト（2 段以上の深さ）
      case "/links":
        return html(page("top", ["/links/a", "/links/b", "/links/a"]));
      case "/links/a":
        return html(page("a", ["/links/a/1", "/links"]));
      case "/links/b":
        return html(page("b", ["/links"]));
      case "/links/a/1":
        return html(page("a1", ["/links/a/1/x"]));
      case "/links/a/1/x":
        return html(page("a1x", ["/links"]));

      // 循環・重複（末尾スラッシュ / 計測パラメータ / フラグメント）
      case "/dup":
        return html(
          page("dup", [
            "/dup/",
            "/dup?utm_source=mail",
            "/dup#frag",
            "/dup/child/",
            "/dup/child?gclid=1",
            "/dup/child#z",
          ]),
        );
      case "/dup/child":
        return html(page("child", ["/dup", "/dup/", "/dup/child"]));

      // クエリでページを出し分けるサイト（?p=1 と ?p=2 は別ページ）
      case "/q":
        return html(page("q", ["/q?p=1", "/q?p=2", "/q?p=1&utm_source=x"]));

      // 非 HTML
      case "/assets":
        return html(
          page("assets", [
            "/assets/file.pdf",
            "/assets/img.png",
            "/assets/style.css",
            "/assets/data.json",
            "/assets/page.html",
            "/assets/api",
            "mailto:a@example.com",
            "tel:03",
            "javascript:void(0)",
          ]),
        );
      case "/assets/page.html":
        return html(page("page", []));
      case "/assets/api":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));

      // リダイレクト
      case "/redir":
        return html(page("redir", ["/redir/away", "/redir/old", "/redir/new", "/redir/missing"]));
      case "/redir/away":
        return redirect(`${otherOrigin}/landing`);
      case "/redir/old":
        return redirect("/redir/new", 301);
      case "/redir/new":
        return html(page("new", []));

      // サイトマップ + リンク
      case "/sm":
        return html(page("sm", ["/sm/p3"]));
      case "/sm/p1":
      case "/sm/p2":
      case "/sm/p3":
        return html(page(path, []));
      case "/sm/sitemap.xml":
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(
          `<urlset>${["/sm", "/sm/p1", "/sm/p2"].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("")}</urlset>`,
        );

      default:
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => other.close(() => resolve()));
});

describe("resolveMaxPages", () => {
  it("SITE_MAX_PAGES が上限と既定を決め、リクエストはそれ以下に丸める", () => {
    const before = process.env.SITE_MAX_PAGES;
    delete process.env.SITE_MAX_PAGES;
    expect(resolveMaxPages()).toBe(100);
    expect(resolveMaxPages(5000)).toBe(100);
    expect(resolveMaxPages(0)).toBe(1);
    expect(resolveMaxPages(2.7)).toBe(2);
    process.env.SITE_MAX_PAGES = "50";
    expect(resolveMaxPages()).toBe(50);
    expect(resolveMaxPages(80)).toBe(50);
    process.env.SITE_MAX_PAGES = "99999";
    expect(resolveMaxPages()).toBe(100);
    process.env.SITE_MAX_PAGES = "abc";
    expect(resolveMaxPages()).toBe(100);
    if (before === undefined) delete process.env.SITE_MAX_PAGES;
    else process.env.SITE_MAX_PAGES = before;
  });
});

describe("crawlSite", () => {
  it("サイトマップが無くても内部リンクを幅優先で 2 段以上辿る", async () => {
    const c = collector();
    // 順序を確かめたいので直列に取得する
    const r = await crawlSite({
      entryUrl: `${origin}/links`,
      origin,
      siteFiles: files(),
      concurrency: 1,
      ...c,
    });
    expect([...c.visited].sort()).toEqual(
      ["/links", "/links/a", "/links/b", "/links/a/1", "/links/a/1/x"].sort(),
    );
    expect(r.visited).toBe(5);
    expect(r.fetched).toBe(5);
    expect(r.discovered).toBe(5);
    expect(r.linkCount).toBe(4);
    expect(r.sitemapCount).toBe(0);
    expect(r.truncated).toBeNull();
    expect(r.failures).toEqual([]);
    // 幅優先: 入力ページ → 1 段目 → 2 段目 → 3 段目
    expect(c.visited).toEqual(["/links", "/links/a", "/links/b", "/links/a/1", "/links/a/1/x"]);
    // 進捗は discover 1 回 + ページごと
    expect(c.progress[0].phase).toBe("discover");
    expect(c.progress.filter((p) => p.phase === "crawl")).toHaveLength(5);
    expect(c.progress[c.progress.length - 1].fetched).toBe(5);
  });

  it("maxPages で打ち切り、truncated に理由を残す", async () => {
    const c = collector();
    const r = await crawlSite({
      entryUrl: `${origin}/links`,
      origin,
      siteFiles: files(),
      maxPages: 3,
      ...c,
    });
    expect(r.fetched).toBe(3);
    expect(r.visited).toBe(3);
    expect(r.truncated).toEqual({ reason: "max-pages", limit: 3 });
    expect(c.visited[0]).toBe("/links");
  });

  it("時間予算を超えたら打ち切る", async () => {
    const c = collector();
    const r = await crawlSite({
      entryUrl: `${origin}/slow`,
      origin,
      siteFiles: files(),
      concurrency: 1,
      timeBudgetMs: 200,
      ...c,
    });
    expect(r.truncated?.reason).toBe("time-budget");
    expect(r.truncated?.limit).toBe(200);
    expect(r.fetched).toBeLessThan(7);
    expect(r.fetched).toBeGreaterThanOrEqual(1);
  });

  it("末尾スラッシュ・計測パラメータ・フラグメント違いと循環は 1 回だけ取得する", async () => {
    hits.length = 0;
    const c = collector();
    const r = await crawlSite({ entryUrl: `${origin}/dup`, origin, siteFiles: files(), ...c });
    expect(c.visited.sort()).toEqual(["/dup", "/dup/child"]);
    expect(r.fetched).toBe(2);
    expect(r.discovered).toBe(2);
    expect(hits.filter((h) => !h.endsWith(".xml"))).toHaveLength(2);
  });

  it("クエリでページを出し分けるサイトは別ページとして数える", async () => {
    hits.length = 0;
    const c = collector();
    const r = await crawlSite({ entryUrl: `${origin}/q`, origin, siteFiles: files(), ...c });
    // ?p=1 と ?p=2 は別ページ。?p=1&utm_source=x は ?p=1 と同じ
    // collector は pathname だけを見るので、ここは取得件数で判定する
    expect(c.visited.sort()).toEqual(["/q", "/q", "/q"]);
    expect(r.fetched).toBe(3);
    expect(hits.filter((h) => h.startsWith("/q")).sort()).toEqual([
      "/q",
      "/q?p=1",
      "/q?p=2",
    ]);
  });

  it("非 HTML のリンクは取得せず、HTML でない応答は診断しない", async () => {
    hits.length = 0;
    const c = collector();
    const r = await crawlSite({ entryUrl: `${origin}/assets`, origin, siteFiles: files(), ...c });
    expect(c.visited.sort()).toEqual(["/assets", "/assets/page.html"]);
    // /assets/api は拡張子が無いので取得はするが、JSON なので対象外
    expect(r.fetched).toBe(3);
    expect(r.skipped).toBe(1);
    const fetchedPaths = hits.filter((h) => !h.endsWith(".xml"));
    expect(fetchedPaths).not.toContain("/assets/file.pdf");
    expect(fetchedPaths).not.toContain("/assets/img.png");
  });

  it("別オリジンへのリダイレクトは追わず、同一オリジンのリダイレクトは 1 回だけ診断する", async () => {
    const c = collector();
    const r = await crawlSite({ entryUrl: `${origin}/redir`, origin, siteFiles: files(), ...c });
    // /redir/new は直接リンクと /redir/old からのリダイレクトの 2 経路あるが 1 回だけ
    expect(c.visited.filter((p) => p === "/redir/new" || p === "/redir/old")).toHaveLength(1);
    expect(c.visited).not.toContain("/redir/away");
    expect(r.failures.map((f) => new URL(f.url).pathname)).toEqual(["/redir/missing"]);
    expect(r.failures[0].message).toContain("404");
    // away（別オリジン）+ old/new の重複 = 2
    expect(r.skipped).toBe(2);
    expect(r.visited).toBe(2);
  });

  it("サイトマップの URL を種にして、リンクだけのページも足す", async () => {
    const c = collector();
    const r = await crawlSite({
      entryUrl: `${origin}/sm`,
      origin,
      siteFiles: files([`${origin}/sm/sitemap.xml`]),
      ...c,
    });
    expect(c.visited.sort()).toEqual(["/sm", "/sm/p1", "/sm/p2", "/sm/p3"]);
    expect(r.sitemapCount).toBe(2); // /sm は入力 URL として既に見ているので数えない
    expect(r.linkCount).toBe(1);
    expect(r.sitemapFiles).toBe(1);
  });

  it("取得済みの入力ページを渡すと取り直さない", async () => {
    hits.length = 0;
    const c = collector();
    const entryPage: FetchedText = {
      ok: true,
      status: 200,
      finalUrl: `${origin}/links`,
      contentType: "text/html",
      body: page("prefetched", ["/links/b"]),
      headers: new Headers(),
    };
    await crawlSite({ entryUrl: `${origin}/links`, origin, siteFiles: files(), entryPage, ...c });
    expect(hits.filter((h) => !h.endsWith(".xml"))).toEqual(["/links/b"]);
    expect(c.visited).toEqual(["/links", "/links/b"]);
  });

  it("visit() の例外はそのページの失敗として記録し、クロールは続く", async () => {
    const r = await crawlSite({
      entryUrl: `${origin}/links`,
      origin,
      siteFiles: files(),
      visit: (_p, url) => {
        if (url.endsWith("/links/b")) throw new Error("boom");
      },
    });
    expect(r.visited).toBe(4);
    expect(r.failures.map((f) => new URL(f.url).pathname)).toEqual(["/links/b"]);
  });

  it("AbortSignal で中断できる", async () => {
    const abort = new AbortController();
    const r = await crawlSite({
      entryUrl: `${origin}/links`,
      origin,
      siteFiles: files(),
      concurrency: 1,
      signal: abort.signal,
      onProgress: (p) => {
        if (p.phase === "crawl") abort.abort();
      },
      visit: () => {},
    });
    expect(r.aborted).toBe(true);
    expect(r.fetched).toBe(1);
  });
});
