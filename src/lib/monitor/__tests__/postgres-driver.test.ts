/**
 * 本番と同じ postgres ドライバーで jsonb の保存形式を確かめる。
 * PGlite では起きない差（文字列の二重 JSON 化）を拾うため。TEST_DATABASE_URL があるときだけ動く。
 *   TEST_DATABASE_URL=postgres://... npm test
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { snapshotOf } from "@/lib/report/history";
import { migrate, type Db } from "../db";
import { addAlerts, addSite, latestLinksBySite, listAlerts, saveRun } from "../store";
import { fakeResult } from "./helpers";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres driver", () => {
  const sql = postgres(url ?? "", { max: 1, prepare: false, onnotice: () => {} });
  const db: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[],
    exec: async (text: string) => {
      await sql.unsafe(text);
    },
  };
  afterAll(async () => {
    await sql.end();
  });

  it("stores jsonb as objects, not JSON strings", async () => {
    await sql.unsafe(`drop table if exists monitor_alerts, monitor_runs, monitor_sites cascade`);
    await migrate(db);
    const site = await addSite(db, { url: "https://example.com/", name: "x", frequency: "daily" });
    const result = fakeResult({
      links: { found: 1, checked: 1, unchecked: 0, durationMs: 1, broken: [{ url: "https://example.com/gone", status: 404, kind: "link", sources: [], sourceCount: 1 }] },
    });
    const runId = await saveRun(db, { siteId: site.id, trigger: "manual", startedAt: new Date(), finishedAt: new Date(), status: "success", snapshot: snapshotOf(result), result });
    await addAlerts(db, site.id, runId, [{ severity: "info", title: "t", details: ["a"] }]);

    const [types] = await sql`select jsonb_typeof(snapshot) as s, jsonb_typeof(result) as r from monitor_runs`;
    expect(types).toEqual({ s: "object", r: "object" });
    const [alertType] = await sql`select jsonb_typeof(details) as d from monitor_alerts`;
    expect(alertType.d).toBe("array");
    expect((await latestLinksBySite(db))[0].links?.broken[0].url).toBe("https://example.com/gone");
    expect((await listAlerts(db))[0].details).toEqual(["a"]);
  });

  it("repairs rows stored as JSON strings by the first version", async () => {
    await sql.unsafe(`update monitor_runs set result = to_jsonb(result::text), snapshot = to_jsonb(snapshot::text)`);
    await sql.unsafe(`update monitor_alerts set details = to_jsonb(details::text)`);
    await migrate(db);
    const [types] = await sql`select jsonb_typeof(snapshot) as s, jsonb_typeof(result) as r from monitor_runs`;
    expect(types).toEqual({ s: "object", r: "object" });
    expect((await listAlerts(db))[0].details).toEqual(["a"]);
  });
});
