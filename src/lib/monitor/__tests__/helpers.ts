import { PGlite } from "@electric-sql/pglite";
import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import { migrate, type Db } from "../db";

/** WASM の Postgres（PGlite）に本番と同じ Db の口を付ける */
export async function memoryDb(): Promise<Db & { close: () => Promise<void> }> {
  const pg = new PGlite();
  const db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    exec: async (text: string) => {
      await pg.exec(text);
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

/** 採点結果の最小の組み立て（保存・比較のテスト用） */
export function fakeResult(overrides: Partial<SiteAnalysisResult> = {}): SiteAnalysisResult {
  return {
    entryUrl: "https://example.com/",
    origin: "https://example.com",
    pages: [],
    excluded: [],
    failures: [],
    overall: 80,
    categories: [],
    checks: [],
    discovery: "sitemap",
    crawl: {
      discovered: 1,
      fetched: 1,
      analyzed: 1,
      excluded: 0,
      failed: 0,
      skipped: 0,
      durationMs: 1000,
      truncated: null,
      sitemapCount: 1,
      linkCount: 0,
      maxPages: 100,
    },
    notes: [],
    fetchedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}
