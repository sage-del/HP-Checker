/**
 * ブラウザ側で /api/site の NDJSON ストリームを読むためのヘルパ。
 *
 * このファイルは "use client" コンポーネントから import される前提なので、
 * node 専用モジュール（fetch.ts 経由の node:dns など）を import しない。
 */
import type { SiteAnalysisResult, SiteProgress } from "@/lib/analyzer/types";
import type { SiteStreamEvent } from "./types";

export type { SiteStreamEvent } from "./types";

/**
 * NDJSON（1 行 1 JSON）のレスポンスを行ごとに読む。
 * チャンク境界で行が途切れていても、改行が来るまでバッファして正しく組み立てる。
 * 空行は読み飛ばし、JSON として壊れた行は例外にする（途中で切れた最終行など）。
 */
export async function readNdjson(
  response: Response,
  onLine: (obj: unknown) => void,
): Promise<void> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const flushLines = (final: boolean) => {
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      emit(line);
    }
    if (final && buffer.length > 0) {
      const rest = buffer;
      buffer = "";
      emit(rest);
    }
  };

  const emit = (raw: string) => {
    const line = raw.replace(/\r$/, "").trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("サーバーからの応答を読み取れませんでした");
    }
    onLine(parsed);
  };

  if (!response.body) {
    buffer = await response.text();
    flushLines(true);
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flushLines(false);
    }
    buffer += decoder.decode();
    flushLines(true);
  } finally {
    reader.releaseLock();
  }
}

/** 受信した行が /api/site のイベントとして最低限の形をしているか */
export function isSiteStreamEvent(obj: unknown): obj is SiteStreamEvent {
  if (!obj || typeof obj !== "object") return false;
  const type = (obj as { type?: unknown }).type;
  return type === "progress" || type === "result" || type === "error";
}

export class SiteRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SiteRequestError";
  }
}

export interface RequestSiteAnalysisOptions {
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SiteProgress) => void;
  /** 既定は /api/site */
  endpoint?: string;
}

/**
 * /api/site を呼び、進捗を受け取りながら最終結果を返す。
 * 入力エラー（400）は HTTP ステータスで、クロール中のエラーはストリーム内の
 * error 行で届くので、どちらも SiteRequestError に揃える。
 */
export async function requestSiteAnalysis(
  url: string,
  options: RequestSiteAnalysisOptions = {},
): Promise<{ result: SiteAnalysisResult; cached: boolean }> {
  const res = await fetch(options.endpoint ?? "/api/site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      options.maxPages !== undefined ? { url, maxPages: options.maxPages } : { url },
    ),
    signal: options.signal,
  });

  if (!res.ok) {
    let message = `診断に失敗しました（HTTP ${res.status}）`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown; code?: unknown };
      if (typeof data.error === "string") message = data.error;
      if (typeof data.code === "string") code = data.code;
    } catch {
      /* JSON でなければ既定文言 */
    }
    throw new SiteRequestError(message, code, res.status);
  }

  let done: { result: SiteAnalysisResult; cached: boolean } | undefined;
  let failure: { error: string; code?: string } | undefined;

  await readNdjson(res, (obj) => {
    if (!isSiteStreamEvent(obj)) return;
    if (obj.type === "progress") {
      const { type: _type, ...progress } = obj;
      void _type;
      options.onProgress?.(progress);
    } else if (obj.type === "result") {
      done = { result: obj.result, cached: Boolean(obj.cached) };
    } else {
      failure = { error: obj.error, code: obj.code };
    }
  });

  if (failure) throw new SiteRequestError(failure.error, failure.code, res.status);
  if (!done) throw new SiteRequestError("診断結果を受信できませんでした（通信が途中で切れた可能性があります）");
  return done;
}
