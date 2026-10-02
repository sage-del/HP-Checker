import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SiteFiles } from "@/lib/analyzer/robots";
import { discoverSitemapUrls } from "../discover";

let server: Server;
let origin: string;
const hits: string[] = [];

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const index = (locs: string[]) =>
  xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
    .join("")}</sitemapindex>`);
const urlset = (locs: string[]) =>
  xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<url><loc>${l}</loc><lastmod>2026-01-01</lastmod></url>`)
    .join("")}</urlset>`);

function files(sitemaps: string[]): SiteFiles {
  return {
    origin,
    robotsTxt: null,
    sitemaps,
    llmsTxt: { present: false, length: 0, status: 404 },
    llmsFullTxt: { present: false, length: 0 },
  };
}

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.push(path);
    const send = (body: string, type = "application/xml") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    const routes: Record<string, () => void> = {
      // 索引 → 子 2 つ（うち 1 つは .gz）→ 孫
      "/idx/root.xml": () =>
        send(index([`${origin}/idx/posts.xml`, `${origin}/idx/pages.xml.gz`, `${origin}/idx/sub.xml`])),
      "/idx/posts.xml": () =>
        send(
          urlset([
            `${origin}/post/1`,
            `${origin}/post/2/`,
            `${origin}/post/2`,
            `http://${new URL(origin).host}/post/3`,
            `${origin}/files/a.pdf`,
            "https://other.example/x",
          ]),
        ),
      "/idx/sub.xml": () => send(index([`${origin}/idx/sub-child.xml`])),
      "/idx/sub-child.xml": () => send(urlset([`${origin}/deep/1`])),
      // 定番の場所（/sitemap.xml は無く /sitemap_index.xml だけある）
      "/sitemap_index.xml": () => send(index([`${origin}/fallback/child.xml`])),
      "/fallback/child.xml": () => send(urlset([`${origin}/fb/1`, `${origin}/fb/2`])),
      // テキスト形式
      "/text/sitemap.txt": () => send(`${origin}/t/1\n${origin}/t/2\n`, "text/plain"),
      // 深い索引の連鎖: d0 → d1 → d2 → d3 → urls
      "/deep/d0.xml": () => send(index([`${origin}/deep/d1.xml`]).replace("</sitemapindex>", `</sitemapindex>`)),
      "/deep/d1.xml": () => send(index([`${origin}/deep/d2.xml`])),
      "/deep/d2.xml": () => send(index([`${origin}/deep/d3.xml`])),
      "/deep/d3.xml": () => send(urlset([`${origin}/very/deep`])),
      // 404 が HTML で返るサイト
      "/html404.xml": () => send("<!doctype html><html><body>404</body></html>", "text/html"),
    };
    const handler = routes[path];
    if (handler) return handler();
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("discoverSitemapUrls", () => {
  it("索引を再帰的に展開し、同一オリジンの HTML URL だけを正規化して集める", async () => {
    const r = await discoverSitemapUrls(origin, files([`${origin}/idx/root.xml`]));
    expect(r.source).toBe("robots");
    expect(r.urls.sort()).toEqual(
      [`${origin}/post/1`, `${origin}/post/2`, `${origin}/post/3`, `${origin}/deep/1`].sort(),
    );
    // root + posts + sub + sub-child の 4 ファイル（.gz は読まない）
    expect(r.sitemapFiles).toBe(4);
    expect(r.notes.some((n) => n.includes(".gz"))).toBe(true);
  });

  it("robots.txt に Sitemap が無ければ定番の場所を当たる", async () => {
    hits.length = 0;
    const r = await discoverSitemapUrls(origin, files([]));
    expect(r.source).toBe("fallback");
    expect(r.urls.sort()).toEqual([`${origin}/fb/1`, `${origin}/fb/2`].sort());
    expect(hits).toContain("/sitemap.xml");
    expect(hits).toContain("/sitemap_index.xml");
  });

  it("robots.txt の Sitemap 行が http:// でも origin に揃えて読む", async () => {
    const httpUrl = `http://${new URL(origin).host}/idx/sub.xml`;
    const r = await discoverSitemapUrls(origin, files([httpUrl]));
    expect(r.urls).toEqual([`${origin}/deep/1`]);
  });

  it("テキスト形式のサイトマップも読める", async () => {
    const r = await discoverSitemapUrls(origin, files([`${origin}/text/sitemap.txt`]));
    expect(r.urls).toEqual([`${origin}/t/1`, `${origin}/t/2`]);
  });

  it("索引の深さとファイル数の上限で打ち切り、notes に残す", async () => {
    const shallow = await discoverSitemapUrls(origin, files([`${origin}/deep/d0.xml`]), {
      maxDepth: 1,
    });
    // 深さ 1 までは何も取れない → 定番の場所（/sitemap_index.xml）にフォールバックする
    expect(shallow.urls.sort()).toEqual([`${origin}/fb/1`, `${origin}/fb/2`].sort());
    expect(shallow.source).toBe("fallback");
    expect(shallow.notes.some((n) => n.includes("段"))).toBe(true);

    const full = await discoverSitemapUrls(origin, files([`${origin}/deep/d0.xml`]));
    expect(full.urls).toEqual([`${origin}/very/deep`]);

    const capped = await discoverSitemapUrls(origin, files([`${origin}/deep/d0.xml`]), {
      maxFiles: 2,
    });
    // 2 ファイルで上限に達し、フォールバックの候補も読めない
    expect(capped.urls).toEqual([]);
    expect(capped.sitemapsTried).toBe(2);
    expect(capped.notes.some((n) => n.includes("上限"))).toBe(true);
  });

  it("何も見つからなければ source は none", async () => {
    const r = await discoverSitemapUrls(origin, files([`${origin}/html404.xml`, `${origin}/nope.xml`]));
    // robots の候補が両方ダメ → 定番の場所 → /sitemap_index.xml が拾われる
    expect(r.source).toBe("fallback");

    const none = await discoverSitemapUrls(`${origin}`, files([]), { maxFiles: 1 });
    // /sitemap.xml だけ試して 404 → 何も無い
    expect(none.urls).toEqual([]);
    expect(none.source).toBe("none");
  });
});
