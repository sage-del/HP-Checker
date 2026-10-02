import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchError, fetchText } from "../fetch";

/**
 * リダイレクト追跡の SSRF 対策。
 *
 * `redirect: "follow"` を fetch に任せると、外部サイトが 302 で内部アドレス
 * （169.254.169.254 / 10.x / 127.0.0.1 など）へ飛ばすだけで内部の応答を
 * 読み出せてしまう。ここでは 127.0.0.1 のダミーサーバーが自分自身の別ポートへ
 * 転送する形を使い、転送先が検査されて止まることを確かめる。
 *
 * ALLOW_PRIVATE_HOSTS は立てない（立てると検査を丸ごと素通りさせる開発用の抜け道）。
 */

let server: Server;
let origin: string;
let secretServer: Server;
let secretOrigin: string;

beforeAll(async () => {
  // 「内部にしか無い」サーバー。本文が漏れていないことの目印になる
  secretServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><head><title>内部ホストのページ</title></head><body>SECRET</body></html>");
  });
  await new Promise<void>((resolve) => secretServer.listen(0, "127.0.0.1", resolve));
  secretOrigin = `http://127.0.0.1:${(secretServer.address() as AddressInfo).port}`;

  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/to-internal") {
      res.writeHead(302, { location: `${secretOrigin}/metadata` });
      res.end();
      return;
    }
    if (url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
      return;
    }
    if (url === "/hop") {
      res.writeHead(302, { location: "/ok" });
      res.end();
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><title>重いページ</title></head><body>${"x".repeat(4096)}</body></html>`);
      return;
    }
    if (url === "/slow") {
      // 先頭だけ送って残りを送らない（受信途中の時間切れ）
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.write("<html><head><title>遅いページ</title></head><body>");
      return;
    }
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body>OK</body></html>");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => secretServer.close(() => resolve()));
});

describe("fetchText のホスト検査", () => {
  it("内部アドレスを直接渡しても接続前に blocked_host で止める", async () => {
    // canonical や llms.txt のリンクなど、第三者が書いた URL がそのまま
    // fetchText に渡ることがある。1 ホップ目を検査しないと内部ホストの
    // 到達性を調べる踏み台になる
    await expect(fetchText(`${secretOrigin}/metadata`)).rejects.toMatchObject({
      name: "FetchError",
      code: "blocked_host",
    });
  });

  it("http / https 以外のスキームは取得しない", async () => {
    await expect(fetchText("file:///etc/passwd")).rejects.toMatchObject({
      name: "FetchError",
      code: "blocked_host",
    });
  });
});

describe("fetchText のリダイレクト追跡", () => {
  it("内部アドレスへの転送は blocked_host で止め、本文を返さない", async () => {
    await expect(fetchText(`${origin}/to-internal`)).rejects.toMatchObject({
      name: "FetchError",
      code: "blocked_host",
    });
    // 本文が返らないことを別経路でも確認する（漏れていれば SECRET が入る）
    let leaked = "";
    try {
      const r = await fetchText(`${origin}/to-internal`);
      leaked = r.body;
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
    }
    expect(leaked).toBe("");
  });

  // 以下 2 件は転送先も 127.0.0.1 になるため、開発用の抜け道を立てて
  // 「転送を追う経路そのもの」だけを見る
  it("許可されたホストへの転送は今までどおり追う（finalUrl は転送先）", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      const r = await fetchText(`${origin}/hop`);
      expect(r.ok).toBe(true);
      expect(r.status).toBe(200);
      expect(r.finalUrl).toBe(`${origin}/ok`);
      expect(r.body).toContain("OK");
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });

  it("転送が続きすぎるときは打ち切る", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      await expect(fetchText(`${origin}/loop`)).rejects.toMatchObject({
        name: "FetchError",
        code: "network",
      });
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });
});

describe("fetchText のサイズ上限", () => {
  it("既定では上限を超えると too_large で止める", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      await expect(fetchText(`${origin}/big`, { maxBytes: 1024 })).rejects.toMatchObject({
        name: "FetchError",
        code: "too_large",
      });
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });

  it("truncate なら上限までで打ち切って返す（先頭の title は読める）", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      const r = await fetchText(`${origin}/big`, { maxBytes: 1024, truncate: true });
      expect(r.ok).toBe(true);
      expect(r.body).toContain("<title>重いページ</title>");
      expect(r.timing?.bytes).toBe(1024);
      expect(r.timing?.truncated).toBe(true);
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });

  it("truncate なら本文の受信中に時間切れになっても受信できた分を返す", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      const r = await fetchText(`${origin}/slow`, { timeoutMs: 300, truncate: true });
      expect(r.body).toContain("<title>遅いページ</title>");
      expect(r.timing?.truncated).toBe(true);
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });

  it("truncate なしで受信中に時間切れになれば timeout で止める", async () => {
    process.env.ALLOW_PRIVATE_HOSTS = "1";
    try {
      await expect(fetchText(`${origin}/slow`, { timeoutMs: 300 })).rejects.toMatchObject({
        name: "FetchError",
        code: "timeout",
      });
    } finally {
      delete process.env.ALLOW_PRIVATE_HOSTS;
    }
  });
});
