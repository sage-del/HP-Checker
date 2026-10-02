import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { runMonitor } from "../run";
import { addSite, getRun, getSite, listAlerts, listRuns } from "../store";
import { memoryDb } from "./helpers";

let server: Server;
let origin: string;
let db: Db & { close: () => Promise<void> };
/** 2 回目の診断でリンク切れを起こすためのスイッチ */
let breakImage = false;
let down = false;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>${title}</h1>${body}</body></html>`;

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_HOSTS = "1";
  server = createServer((req, res) => {
    if (down) {
      res.writeHead(503).end();
      return;
    }
    const path = (req.url ?? "/").split("?")[0];
    const html = (s: string) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(s);
    if (path === "/") return html(page("トップ", `<a href="/about">会社概要</a><a href="/old">旧ページ</a><img src="/logo.png" alt="ロゴ">`));
    if (path === "/about") return html(page("会社概要", `<a href="/">トップ</a>`));
    if (path === "/logo.png" && !breakImage) return res.writeHead(200, { "content-type": "image/png" }).end("png");
    res.writeHead(404, { "content-type": "text/html" }).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db = await memoryDb();
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe("runMonitor", () => {
  it("records runs, broken links and alerts across consecutive diagnoses", async () => {
    const site = await addSite(db, { url: `${origin}/`, name: "テスト", frequency: "daily" });

    // 1 回目: /old が 404
    const first = await runMonitor(db, site, { trigger: "manual", timeBudgetMs: 60_000 });
    expect(first.status).toBe("success");
    const run1 = await getRun(db, first.runId);
    expect(run1?.result?.links?.broken.map((b) => [new URL(b.url).pathname, b.status, b.kind])).toEqual([
      ["/old", 404, "link"],
    ]);
    expect(run1?.brokenCount).toBe(1);
    expect(run1?.snapshot?.brokenLinks).toEqual([`${origin}/old`]);
    expect(first.alerts.map((a) => a.severity)).toEqual(["info", "critical"]);
    expect((await getSite(db, site.id))?.lastRunAt).not.toBeNull();

    // 2 回目: 画像も切れた → 新たなリンク切れだけを知らせる
    breakImage = true;
    const second = await runMonitor(db, site, { trigger: "schedule", timeBudgetMs: 60_000 });
    expect(second.alerts.map((a) => a.title)).toContain("リンク切れが新たに 1 件見つかりました");
    expect(second.alerts.find((a) => a.title.startsWith("リンク切れ"))?.details).toEqual([`${origin}/logo.png`]);

    // 3 回目: サイトが落ちた → 失敗を記録して知らせる
    down = true;
    const third = await runMonitor(db, site, { trigger: "schedule", timeBudgetMs: 60_000 });
    expect(third.status).toBe("error");
    expect(third.alerts.map((a) => a.title)).toEqual(["サイトを診断できませんでした"]);

    // 4 回目: 復旧 → 復旧を知らせる（比較の相手は 2 回目）
    down = false;
    const fourth = await runMonitor(db, site, { trigger: "schedule", timeBudgetMs: 60_000 });
    expect(fourth.status).toBe("success");
    expect(fourth.alerts.map((a) => a.title)).toEqual(["診断が再開できました"]);

    expect((await listRuns(db, site.id)).map((r) => r.status)).toEqual(["success", "error", "success", "success"]);
    expect((await listAlerts(db)).length).toBe(1 + 1 + 1 + 1 + 1);
  }, 60_000);
});

describe("runMonitor (aborted)", () => {
  it("does not record a run that was aborted midway", async () => {
    const site = await addSite(db, { url: `${origin}/about`, name: "中止", frequency: "daily" });
    const abort = new AbortController();
    abort.abort();
    await expect(runMonitor(db, site, { trigger: "manual", timeBudgetMs: 60_000, signal: abort.signal })).rejects.toThrow(
      "診断を中止しました",
    );
    expect(await listRuns(db, site.id)).toEqual([]);
  });
});
