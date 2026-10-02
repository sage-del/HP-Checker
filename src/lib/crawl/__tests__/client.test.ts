import { afterEach, describe, expect, it, vi } from "vitest";
import { readNdjson, requestSiteAnalysis, SiteRequestError } from "../client";

/** バイト列を指定の位置で分割してストリームにする */
function chunkedResponse(text: string, cuts: number[], init: ResponseInit = {}): Response {
  const bytes = new TextEncoder().encode(text);
  const bounds = [0, ...cuts, bytes.length];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bounds.length - 1; i++) {
        controller.enqueue(bytes.slice(bounds[i], bounds[i + 1]));
      }
      controller.close();
    },
  });
  return new Response(stream, init);
}

describe("readNdjson", () => {
  it("チャンク境界で行が途切れていても組み立てる（多バイト文字の途中でも）", async () => {
    const lines = [
      { type: "progress", url: "https://例え.jp/ページ", fetched: 1 },
      { type: "progress", fetched: 2 },
      { type: "result", result: { ok: true } },
    ];
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const bytes = new TextEncoder().encode(text);
    // 「例」の 3 バイトの真ん中と、2 行目の途中で切る
    const cutInsideKanji = text.indexOf("例");
    const byteIndex = new TextEncoder().encode(text.slice(0, cutInsideKanji)).length + 1;
    const cuts = [byteIndex, byteIndex + 5, bytes.length - 7];

    const got: unknown[] = [];
    await readNdjson(chunkedResponse(text, cuts), (o) => got.push(o));
    expect(got).toEqual(lines);
  });

  it("CRLF・空行・改行無しの最終行を扱う", async () => {
    const text = `{"a":1}\r\n\r\n{"b":2}\n{"c":3}`;
    const got: unknown[] = [];
    await readNdjson(chunkedResponse(text, [3]), (o) => got.push(o));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("body が無い Response でも落ちない", async () => {
    const got: unknown[] = [];
    await readNdjson(new Response(null), (o) => got.push(o));
    expect(got).toEqual([]);
  });

  it("壊れた行は例外にする", async () => {
    await expect(
      readNdjson(chunkedResponse(`{"a":1}\n{"broken`, []), () => {}),
    ).rejects.toThrow();
  });
});

describe("requestSiteAnalysis", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("進捗を通知しつつ result 行を返す", async () => {
    const text =
      JSON.stringify({ type: "progress", phase: "crawl", fetched: 1, queued: 2, discovered: 3, analyzed: 1, failed: 0, elapsedMs: 10 }) +
      "\n" +
      JSON.stringify({ type: "result", result: { origin: "https://e.com" }, cached: false }) +
      "\n";
    globalThis.fetch = vi.fn(async () => chunkedResponse(text, [20, 60])) as typeof fetch;
    const progress: unknown[] = [];
    const r = await requestSiteAnalysis("https://e.com", {
      maxPages: 5,
      onProgress: (p) => progress.push(p),
    });
    expect(r.cached).toBe(false);
    expect(r.result).toEqual({ origin: "https://e.com" });
    expect(progress).toEqual([
      { phase: "crawl", fetched: 1, queued: 2, discovered: 3, analyzed: 1, failed: 0, elapsedMs: 10 },
    ]);
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/site");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ url: "https://e.com", maxPages: 5 });
  });

  it("error 行は SiteRequestError にする", async () => {
    const text = JSON.stringify({ type: "error", error: "だめでした", code: "network" }) + "\n";
    globalThis.fetch = vi.fn(async () => chunkedResponse(text, [])) as typeof fetch;
    await expect(requestSiteAnalysis("https://e.com")).rejects.toMatchObject({
      name: "SiteRequestError",
      message: "だめでした",
      code: "network",
    });
  });

  it("HTTP エラー（400）の JSON も SiteRequestError にする", async () => {
    globalThis.fetch = vi.fn(
      async () => Response.json({ error: "URLを入力してください", code: "invalid_url" }, { status: 400 }),
    ) as typeof fetch;
    const err = await requestSiteAnalysis("").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SiteRequestError);
    expect((err as SiteRequestError).status).toBe(400);
    expect((err as SiteRequestError).message).toBe("URLを入力してください");
  });

  it("result 行が来ないまま終わったらエラー", async () => {
    globalThis.fetch = vi.fn(async () => chunkedResponse(`{"type":"progress","fetched":1}\n`, [])) as typeof fetch;
    await expect(requestSiteAnalysis("https://e.com")).rejects.toThrow("受信できません");
  });
});
