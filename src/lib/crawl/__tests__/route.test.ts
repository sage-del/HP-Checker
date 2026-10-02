import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/site/route";
import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import { readNdjson } from "../client";
import type { SiteStreamEvent } from "../types";

/**
 * Route Handler をそのまま呼び、NDJSON ストリームを client.ts の readNdjson で読む。
 * 入力エラーは通常の JSON（4xx）、クロール中のエラーはストリーム内の error 行、
 * キャッシュ命中は result 1 行だけ、という契約を確かめる。
 */

let server: Server;
let origin: string;

const html = (title: string, links: string[]) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
  <meta name="description" content="${"説".repeat(80)}"></head>
  <body><h1>${title}</h1><h2>本文</h2><p>${"これはテスト用の段落です。".repeat(60)}</p>
  ${links.map((l) => `<a href="${l}">${l}</a>`).join("")}</body></html>`;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const send = (body: string, type = "text/html; charset=utf-8") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    switch (path) {
      case "/":
        return send(html("トップ", ["/about", "/contact"]));
      case "/about":
        return send(html("会社概要", ["/"]));
      case "/contact":
        return send(html("お問い合わせ", ["/"]));
      case "/slow":
        // 同時実行の上限を試すために、わざと遅く返す
        setTimeout(() => send(html("遅いページ", ["/slow2"])), 400);
        return;
      case "/slow2":
        setTimeout(() => send(html("遅いページ 2", ["/slow"])), 400);
        return;
      case "/plain.txt":
        return send("just text", "text/plain");
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
});

function post(body: unknown, signal?: AbortSignal) {
  return POST(
    new NextRequest("http://localhost/api/site", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    }),
  );
}

async function events(res: Response): Promise<SiteStreamEvent[]> {
  const list: SiteStreamEvent[] = [];
  await readNdjson(res, (o) => list.push(o as SiteStreamEvent));
  return list;
}

describe("POST /api/site", () => {
  it("壊れた JSON / URL 無し / maxPages が数値でない → 400", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ url: "   " })).status).toBe(400);
    const r = await post({ url: `${origin}/`, maxPages: "3" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "maxPages は数値で指定してください" });
  });

  it("形式が不正な URL や内部ホストはストリームを始めずに 400 を返す", async () => {
    const bad = await post({ url: "ftp://example.com" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_url" });

    delete process.env.ALLOW_PRIVATE_HOSTS;
    try {
      const blocked = await post({ url: "http://localhost:3000/" });
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toMatchObject({ code: "blocked_host" });
    } finally {
      process.env.ALLOW_PRIVATE_HOSTS = "1";
    }
  });

  it("NDJSON で進捗を流し、最後に result 行を返す。2 回目はキャッシュから 1 行", async () => {
    const res = await post({ url: `${origin}/`, maxPages: 10 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const list = await events(res);
    const progress = list.filter((e) => e.type === "progress");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.some((e) => e.type === "progress" && e.phase === "discover")).toBe(true);
    expect(list[list.length - 1].type).toBe("result");

    const done = list[list.length - 1];
    if (done.type !== "result") throw new Error("unreachable");
    expect(done.cached).toBe(false);
    const result: SiteAnalysisResult = done.result;
    expect(result.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/about", "/contact"]);
    expect(result.discovery).toBe("links");
    expect(result.crawl).toMatchObject({ analyzed: 3, failed: 0, truncated: null, maxPages: 10 });
    expect(new URL(result.pages[0].url).pathname).toBe("/");

    const again = await events(await post({ url: `${origin}/`, maxPages: 10 }));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ type: "result", cached: true });
  });

  it("クロール中のエラーはストリーム内の error 行で返す（HTML でない入力ページ）", async () => {
    const res = await post({ url: `${origin}/plain.txt`, maxPages: 3 });
    expect(res.status).toBe(200);
    const list = await events(res);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: "error", code: "invalid_url" });
  });

  it("クロール中に同じクライアントから来た 2 本目は 429（終われば再び受け付ける）", async () => {
    const running = await post({ url: `${origin}/slow`, maxPages: 2 });
    expect(running.status).toBe(200);

    const busy = await post({ url: `${origin}/about`, maxPages: 2 });
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("60");
    expect(await busy.json()).toMatchObject({ code: "busy" });

    await events(running); // 1 本目を最後まで読み切る（＝枠が解放される）

    const after = await post({ url: `${origin}/about`, maxPages: 2 });
    expect(after.status).toBe(200);
    await events(after);
  });

  it("到達できないページは error 行", async () => {
    const res = await post({ url: `${origin}/missing`, maxPages: 3 });
    const list = await events(res);
    expect(list[list.length - 1]).toMatchObject({ type: "error", code: "network" });
  });
});
