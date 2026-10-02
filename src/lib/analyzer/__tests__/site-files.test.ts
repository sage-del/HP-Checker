import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchSiteFiles } from "../robots";

/**
 * robots.txt / llms.txt / llms-full.txt は任意ファイル。
 * どれかが大きすぎたり応答しなかったりしても、診断全体を止めてはいけない。
 */

let server: Server;
let origin: string;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (path === "/llms-full.txt") {
      // 既定の上限（3MB）を超える全文ファイル
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`# サイト全文\n${"本文".repeat(700_000)}`);
      return;
    }
    if (path === "/llms.txt") {
      // ヘッダーだけ返して本文を送らない（受信途中の時間切れ）
      res.writeHead(200, { "content-type": "text/plain" });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ALLOW_PRIVATE_HOSTS;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fetchSiteFiles", () => {
  it("llms-full.txt が大きすぎても、llms.txt が応答しなくても止まらない", async () => {
    const files = await fetchSiteFiles(origin);
    expect(files.robotsTxt).toContain("User-agent");
    expect(files.llmsFullTxt.present).toBe(true);
    expect(files.llmsTxt.present).toBe(false);
  }, 15_000);
});
