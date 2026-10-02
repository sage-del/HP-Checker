import { describe, expect, it } from "vitest";
import type { SiteAnalysisResult, SiteCheckSummary } from "@/lib/analyzer/types";
import { buildIssuesCsv, csvCell, ISSUE_CSV_HEADER } from "../csv";
import { compareSnapshots, loadHistory, previousSnapshot, saveSnapshot, snapshotOf } from "../history";

function mkCheck(id: string, category: SiteCheckSummary["category"], extra: Partial<SiteCheckSummary>): SiteCheckSummary {
  return {
    id,
    category,
    label: `${id} のラベル`,
    counts: { pass: 0, warn: 0, fail: 0, info: 0 },
    spread: "uniform",
    affected: [],
    ...extra,
  };
}

function mkResult(checks: SiteCheckSummary[], extra: Partial<SiteAnalysisResult> = {}): SiteAnalysisResult {
  return {
    entryUrl: "https://example.com/",
    origin: "https://example.com",
    pages: [
      { url: "https://example.com/", overall: 70, scores: {} as never, page: {} as never },
      { url: "https://example.com/a", overall: 60, scores: {} as never, page: {} as never },
    ],
    excluded: [],
    failures: [],
    overall: 65,
    categories: [
      { id: "crawlers", label: "AIクローラ可否", score: 80, min: 80, max: 80, worstUrl: "" },
      { id: "trust", label: "信頼性", score: 40, min: 40, max: 40, worstUrl: "" },
    ],
    checks,
    discovery: "sitemap",
    crawl: {} as never,
    notes: [],
    fetchedAt: "2026-09-06T05:00:00.000Z",
    ...extra,
  };
}

const checks = [
  mkCheck("jsonld-search-action", "structuredData", {
    counts: { pass: 0, warn: 0, fail: 0, info: 2 },
    affected: [{ url: "https://example.com/", status: "info" }],
  }),
  mkCheck("description", "meta", {
    counts: { pass: 1, warn: 1, fail: 0, info: 0 },
    affected: [{ url: "https://example.com/a", status: "warn", evidence: "短すぎます" }],
    advice: "説明文を \"120 字\" 程度に, 書き直す",
  }),
  mkCheck("trust-privacy", "trust", {
    counts: { pass: 0, warn: 0, fail: 2, info: 0 },
    affected: [
      { url: "https://example.com/a", status: "fail" },
      { url: "https://example.com/", status: "fail" },
    ],
  }),
  mkCheck("title", "meta", { counts: { pass: 2, warn: 0, fail: 0, info: 0 } }),
];

describe("buildIssuesCsv", () => {
  const lines = buildIssuesCsv(mkResult(checks)).split("\r\n");

  it("見出し行 + 課題 × ページの行を、重大 → 警告 → 情報の順に出す", () => {
    expect(lines[0]).toBe(ISSUE_CSV_HEADER.join(","));
    expect(lines).toHaveLength(1 + 2 + 1 + 1);
    expect(lines[1].startsWith("重大,信頼性,trust-privacy のラベル,2,2,2,https://example.com/,")).toBe(true);
    expect(lines[2]).toContain("https://example.com/a");
    expect(lines[3].startsWith("警告,メタ情報,")).toBe(true);
    expect(lines[4].startsWith("情報,構造化データ,")).toBe(true);
  });

  it("カンマ・引用符を含むセルはクォートし、数式になる先頭文字は無害化する", () => {
    expect(lines[3]).toContain('"説明文を ""120 字"" 程度に, 書き直す"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(12)).toBe("12");
  });
});

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("前回の診断との比較", () => {
  const before = snapshotOf(mkResult(checks, { fetchedAt: "2026-09-01T00:00:00.000Z" }));
  const afterChecks = [
    checks[0],
    mkCheck("description", "meta", { counts: { pass: 2, warn: 0, fail: 0, info: 0 } }),
    mkCheck("trust-privacy", "trust", { counts: { pass: 1, warn: 1, fail: 0, info: 0 } }),
    mkCheck("title", "meta", { counts: { pass: 1, warn: 0, fail: 1, info: 0 } }),
  ];
  const after = snapshotOf(
    mkResult(afterChecks, {
      fetchedAt: "2026-09-06T05:00:00.000Z",
      overall: 75,
      categories: [
        { id: "crawlers", label: "AIクローラ可否", score: 80, min: 80, max: 80, worstUrl: "" },
        { id: "trust", label: "信頼性", score: 75, min: 50, max: 100, worstUrl: "" },
        { id: "mobile", label: "モバイル対応", score: 100, min: 100, max: 100, worstUrl: "" },
      ],
    }),
  );

  it("総合・件数・カテゴリの増減と、解消 / 新規 / 判定変化の項目を出す", () => {
    const c = compareSnapshots(before, after);
    expect(c.overall).toEqual({ before: 65, after: 75, delta: 10 });
    expect(c.counts.fail).toEqual({ before: 2, after: 1, delta: -1 });
    expect(c.categories.find((x) => x.id === "trust")).toMatchObject({ before: 40, after: 75, delta: 35 });
    expect(c.categories.find((x) => x.id === "mobile")).toMatchObject({ before: null, delta: null });
    expect(c.resolved.map((i) => i.id)).toEqual(["description"]);
    expect(c.appeared.map((i) => i.id)).toEqual(["title"]);
    expect(c.changed.map((i) => [i.id, i.before, i.after])).toEqual([["trust-privacy", "fail", "warn"]]);
  });

  it("ブラウザに残した前回の結果を探す。同じ診断日時（キャッシュ）は比較しない", () => {
    const storage = new MemoryStorage();
    expect(previousSnapshot(after, storage)).toBeNull();
    saveSnapshot(before, storage);
    saveSnapshot(after, storage);
    saveSnapshot(after, storage);
    expect(loadHistory("https://example.com", storage).map((s) => s.fetchedAt)).toEqual([
      after.fetchedAt,
      before.fetchedAt,
    ]);
    expect(previousSnapshot(after, storage)?.fetchedAt).toBe(before.fetchedAt);
    expect(previousSnapshot(before, storage)).toBeNull();
  });

  it("壊れた保存データや保存できない環境でも落ちない", () => {
    const storage = new MemoryStorage();
    storage.setItem("site-diagnosis-history:v1", "{not json");
    expect(loadHistory("https://example.com", storage)).toEqual([]);
    expect(() => saveSnapshot(after, null)).not.toThrow();
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => saveSnapshot(after, full)).not.toThrow();
  });
});
