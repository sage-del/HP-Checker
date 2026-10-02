import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * 診断対象サイトへ送る名乗り。相手のアクセスログに残るので、
 * OEM 提供元が特定できる URL やリポジトリは入れない。
 */
export const USER_AGENT = "Mozilla/5.0 (compatible; SiteKenshin/0.1)";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

/**
 * 診断するページ（HTML）の受信上限。超えた分は読まずに先頭だけで採点する。
 *
 * Vercel の無料枠（Hobby）の関数メモリは 2GB。HTML はデコード後の文字列と
 * cheerio の DOM で元の十数倍に膨らむため、同時取得 4 本 × 10MB でも 1GB 未満に収まる。
 * 受信した本文は採点後に捨てるので、ページ数が増えてもメモリは積み上がらない。
 */
export const PAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_url"
      | "blocked_host"
      | "timeout"
      | "network"
      | "too_large",
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/** 入力 URL を正規化する。スキーム省略時は https を補う */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new FetchError("URLを入力してください", "invalid_url");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FetchError("URLの形式が正しくありません", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("http / https のURLのみ診断できます", "invalid_url");
  }
  url.hash = "";
  return url;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd"))
    return true;
  // IPv4-mapped (::ffff:127.0.0.1)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * SSRF 対策: localhost / プライベートアドレスへの到達を拒否する。
 * サーバー側でユーザー指定のURLを fetch するツールでは必須。
 */
export async function assertPublicHost(url: URL): Promise<void> {
  // ローカル開発中に手元のサイト（localhost:3000 など）を診断したいときだけ許可する
  if (process.env.ALLOW_PRIVATE_HOSTS === "1") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new FetchError("ローカルホストは診断できません", "blocked_host");
  }
  const ipVersion = isIP(host);
  const addresses: string[] = [];
  if (ipVersion) {
    addresses.push(host);
  } else {
    try {
      const results = await lookup(host, { all: true });
      addresses.push(...results.map((r) => r.address));
    } catch {
      throw new FetchError("ホスト名を解決できませんでした", "network");
    }
  }
  for (const address of addresses) {
    const v = isIP(address);
    if ((v === 4 && isPrivateIPv4(address)) || (v === 6 && isPrivateIPv6(address))) {
      throw new FetchError("内部ネットワークのアドレスは診断できません", "blocked_host");
    }
  }
}

export interface FetchedText {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
  headers: Headers;
  /**
   * 診断サーバーから見た取得時間（ミリ秒）。リダイレクトを含めて最初の要求から数える。
   * 取得できなかったとき・手組みのテストデータでは無い（「未取得」として扱い、0 と混同しない）。
   */
  timing?: FetchTiming;
}

export interface FetchTiming {
  /** 最終的なレスポンスのヘッダーを受け取るまで（TTFB 相当） */
  ttfbMs: number;
  /** HTML の受信が終わるまで */
  totalMs: number;
  /** 受信したバイト数（デコード前）。`truncated` のときは上限までの数で、実際はこれより大きい */
  bytes: number;
  /** サイズ上限に達したため途中で受信を打ち切った */
  truncated?: boolean;
}

/** 追跡してよいリダイレクトの回数 */
const MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * リダイレクトを自分で追う。
 *
 * `redirect: "follow"` に任せると転送先のホストを検査できず、
 * 外部サイトが内部アドレス（169.254.169.254 / 10.x / 127.0.0.1 など）へ
 * 302 するだけでサーバーを踏み台にできてしまう。
 *
 * 検査は「接続する直前」に毎回行う。最初のホップも例外ではない：
 * 呼び出し側が渡す URL には、取得したページの canonical や llms.txt の
 * リンクなど第三者が書いた値が混ざるため、ここで止めないと内部ホストの
 * 到達性やポートの開閉を調べる踏み台（SSRF）になってしまう。
 */
async function fetchFollowingRedirects(
  url: string,
  init: RequestInit,
): Promise<{ res: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    // ここを通ってから初めてそのホストへ接続する（1 ホップ目を含む）
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      throw new FetchError("URLの形式が正しくありません", "invalid_url");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new FetchError("http / https のURLのみ診断できます", "blocked_host");
    }
    await assertPublicHost(target);

    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (!REDIRECT_STATUS.has(res.status) || !location) {
      return { res, finalUrl: res.url || current };
    }
    if (hop >= MAX_REDIRECTS) {
      res.body?.cancel().catch(() => {});
      throw new FetchError("リダイレクトが多すぎます", "network");
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      res.body?.cancel().catch(() => {});
      throw new FetchError("転送先のURLの形式が正しくありません", "invalid_url");
    }
    res.body?.cancel().catch(() => {});
    next.hash = "";
    current = next.toString();
  }
}

/**
 * テキスト系リソースを取得する。タイムアウトとサイズ上限付き。
 * ネットワーク例外は投げず `ok: false, status: 0` として返す（robots.txt 等の任意ファイル向け）。
 * リダイレクトは自分で追い、最初のホップを含めて毎回 `assertPublicHost` を通す
 * （内部アドレスは接続前に `blocked_host` の FetchError になる）。
 *
 * サイズ上限を超えたときは既定で `too_large` の FetchError を投げる。
 * `truncate: true` なら上限までで受信を打ち切り、`timing.truncated` を立てて返す
 * （重いページでも、HTML の先頭にある title・meta・見出しなどは採点できるため）。
 * 本文の受信中に時間切れになったときも、`truncate: true` なら受信できた分を返す。
 */
export async function fetchText(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number; truncate?: boolean } = {},
): Promise<FetchedText> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const started = performance.now();
  try {
    const { res, finalUrl } = await fetchFollowingRedirects(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "accept-language": "ja,en;q=0.8",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const ttfbMs = performance.now() - started;

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          // 重いページの受信途中で時間切れ: 受信できた分で採点する
          if (options.truncate && received > 0 && (err as Error).name === "AbortError") {
            truncated = true;
            break;
          }
          throw err;
        }
        const { done, value } = chunk;
        if (done) break;
        if (received + value.byteLength > maxBytes) {
          reader.cancel().catch(() => {});
          if (!options.truncate) {
            throw new FetchError("ページサイズが大きすぎます", "too_large");
          }
          const rest = maxBytes - received;
          if (rest > 0) chunks.push(value.subarray(0, rest));
          received = maxBytes;
          truncated = true;
          break;
        }
        received += value.byteLength;
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const body = decodeBody(merged, contentType);

    return {
      ok: res.ok,
      status: res.status,
      finalUrl: finalUrl || url,
      contentType,
      body,
      headers: res.headers,
      timing: {
        ttfbMs: Math.round(ttfbMs),
        totalMs: Math.round(performance.now() - started),
        bytes: received,
        ...(truncated ? { truncated } : {}),
      },
    };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new FetchError("ページの取得がタイムアウトしました", "timeout");
    }
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: "",
      body: "",
      headers: new Headers(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Content-Type / meta charset を見て文字コードを決めてデコードする */
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  let charset = fromHeader?.toLowerCase();
  if (!charset) {
    // 先頭 2KB を ASCII として読んで meta charset を探す
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset =
      /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ??
      "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
