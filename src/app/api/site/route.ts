import { NextRequest } from "next/server";
import { FetchError, type SiteAnalysisResult } from "@/lib/analyzer";
import { assertPublicHost, normalizeUrl } from "@/lib/analyzer/fetch";
import { analyzeSite } from "@/lib/analyzer/site";
import { globalCache } from "@/lib/cache";
import { resolveMaxPages } from "@/lib/crawl/crawler";
import type { SiteStreamEvent } from "@/lib/crawl/types";

export const runtime = "nodejs";
// サイト全体をクロールするため、1 ページ診断より長くかかる（クロールの時間予算は 240 秒）
export const maxDuration = 300;

// サイト診断の結果は 300 ページ分で 1 件 1 MB 近くなるため、保持数は少なくする
const cache = globalCache<SiteAnalysisResult>("site", 10 * 60 * 1000, 10);

/**
 * 同時に走らせるクロールの上限。
 *
 * 1 回の POST が対象サイトへ最大 60（サイトマップ）+ maxPages（既定 100）回の
 * リクエストを出すため、無制限に受け付けると他所のサイトを叩く踏み台になり、
 * メモリも同時実行数だけ積み上がる。上限を超えたら 429 で断る。
 */
const MAX_CONCURRENT_CRAWLS = 2;
/** 同じクライアント（IP）が同時に走らせられるクロール数 */
const MAX_CONCURRENT_PER_CLIENT = 1;

interface CrawlGate {
  /** 実行中のクロール数 */
  active: number;
  /** クライアントごとの実行中クロール数 */
  perClient: Map<string, number>;
}

/** dev のホットリロードで数えが飛ばないよう globalThis に置く */
function crawlGate(): CrawlGate {
  const g = globalThis as unknown as { __seo_checker_site_gate?: CrawlGate };
  g.__seo_checker_site_gate ??= { active: 0, perClient: new Map() };
  return g.__seo_checker_site_gate;
}

/** クライアントの識別子（プロキシ経由の元 IP → 直接接続の IP → 不明） */
function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/** 空きがあれば確保して解放関数を返す。空きが無ければ null */
function acquireCrawlSlot(client: string): (() => void) | null {
  const gate = crawlGate();
  if (gate.active >= MAX_CONCURRENT_CRAWLS) return null;
  if ((gate.perClient.get(client) ?? 0) >= MAX_CONCURRENT_PER_CLIENT) return null;
  gate.active += 1;
  gate.perClient.set(client, (gate.perClient.get(client) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    gate.active = Math.max(0, gate.active - 1);
    const left = (gate.perClient.get(client) ?? 1) - 1;
    if (left > 0) gate.perClient.set(client, left);
    else gate.perClient.delete(client);
  };
}

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  "X-Content-Type-Options": "nosniff",
  // nginx 系のプロキシが応答を溜め込まないように
  "X-Accel-Buffering": "no",
} as const;

const encoder = new TextEncoder();

function serializeLine(event: SiteStreamEvent): string {
  return JSON.stringify(event) + "\n";
}

function statusFor(err: FetchError): number {
  return err.code === "invalid_url" || err.code === "blocked_host" ? 400 : 502;
}

/**
 * POST { url, maxPages? }
 *
 * NDJSON（1 行 1 JSON）でストリーミングする:
 *   { type: "progress", phase, fetched, queued, discovered, analyzed, failed, url?, elapsedMs }
 *   … 1 ページごと …
 *   { type: "result", result, cached: false }   または   { type: "error", error, code? }
 * キャッシュ済みなら { type: "result", result, cached: true } の 1 行だけ返す。
 *
 * 入力の不備（URL 形式・内部ネットワーク）はストリームを始める前に 400 で返す。
 * ストリーム開始後はステータスを変えられないため、クロール中のエラーは error 行で届く。
 */
export async function POST(request: NextRequest) {
  let body: { url?: unknown; maxPages?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const { url, maxPages } = body;
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "URLを入力してください" }, { status: 400 });
  }
  if (maxPages !== undefined && maxPages !== null && typeof maxPages !== "number") {
    return Response.json({ error: "maxPages は数値で指定してください" }, { status: 400 });
  }

  // ストリームを始める前に、入力自体の問題は通常のエラー応答で返す
  try {
    const entry = normalizeUrl(url);
    await assertPublicHost(entry);
  } catch (err) {
    if (err instanceof FetchError) {
      return Response.json({ error: err.message, code: err.code }, { status: statusFor(err) });
    }
    throw err;
  }

  const pages = resolveMaxPages(typeof maxPages === "number" ? maxPages : undefined);
  const key = `${url.trim().toLowerCase()}|${pages}`;
  const cached = cache.get(key);
  if (cached) {
    return new Response(serializeLine({ type: "result", result: cached, cached: true }), {
      headers: NDJSON_HEADERS,
    });
  }

  // 実行中のクロールが多すぎるときはストリームを始めずに 429（キャッシュ命中は上で返している）
  const release = acquireCrawlSlot(clientKey(request));
  if (!release) {
    return Response.json(
      { error: "サイト全体の診断が混み合っています。しばらく待ってからお試しください", code: "busy" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // クライアントが切断したらクロールを止める（request.signal と stream の cancel の両方を見る）
  const abort = new AbortController();
  const onClientAbort = () => abort.abort();
  request.signal?.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SiteStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(serializeLine(event)));
        } catch {
          // 既に閉じられている（クライアント切断）
          closed = true;
        }
      };

      try {
        const result = await analyzeSite(url, {
          maxPages: pages,
          signal: abort.signal,
          onProgress: (progress) => send({ type: "progress", ...progress }),
        });
        if (!abort.signal.aborted) {
          cache.set(key, result);
          send({ type: "result", result, cached: false });
        }
      } catch (err) {
        if (err instanceof FetchError) {
          send({ type: "error", error: err.message, code: err.code });
        } else {
          console.error("[site] unexpected error", err);
          send({ type: "error", error: "診断中に予期しないエラーが発生しました" });
        }
      } finally {
        release();
        request.signal?.removeEventListener("abort", onClientAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          /* 既に閉じている */
        }
      }
    },
    cancel() {
      abort.abort();
      release();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
