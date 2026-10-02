import { describe, expect, it } from "vitest";
import type { DiagnosisSnapshot } from "@/lib/report/history";
import { deriveAlerts } from "../alerts";

function snap(overrides: Partial<DiagnosisSnapshot> = {}): DiagnosisSnapshot {
  return {
    origin: "https://example.com",
    fetchedAt: "2026-10-01T00:00:00.000Z",
    overall: 80,
    pageCount: 10,
    counts: { fail: 0, warn: 0, info: 0 },
    categories: { meta: 80, headings: 90 },
    issues: {},
    brokenLinks: [],
    ...overrides,
  };
}

const titles = (a: ReturnType<typeof deriveAlerts>) => a.map((x) => `${x.severity}:${x.title}`);

describe("deriveAlerts", () => {
  it("is silent when nothing changed", () => {
    expect(deriveAlerts({ previousStatus: "success", previous: snap(), current: { status: "success", snapshot: snap() } })).toEqual(
      [],
    );
  });

  it("announces the first run, and broken links found on it", () => {
    const alerts = deriveAlerts({
      previousStatus: null,
      previous: null,
      current: { status: "success", snapshot: snap({ brokenLinks: ["https://example.com/old"] }) },
    });
    expect(titles(alerts)).toEqual(["info:初回の診断が完了しました（総合 80 点）", "critical:リンク切れが 1 件あります"]);
  });

  it("raises a critical alert when the site cannot be diagnosed, but only on the first failure", () => {
    const first = deriveAlerts({ previousStatus: "success", previous: snap(), current: { status: "error", error: "接続できません" } });
    expect(first).toEqual([{ severity: "critical", title: "サイトを診断できませんでした", details: ["接続できません"] }]);
    expect(deriveAlerts({ previousStatus: "error", previous: snap(), current: { status: "error", error: "x" } })).toEqual([]);
  });

  it("tells when diagnosis recovers", () => {
    const alerts = deriveAlerts({ previousStatus: "error", previous: snap(), current: { status: "success", snapshot: snap() } });
    expect(titles(alerts)).toEqual(["info:診断が再開できました"]);
  });

  it("flags new fails, new broken links, score drops and new warnings", () => {
    const before = snap({
      overall: 85,
      categories: { meta: 90, headings: 90 },
      issues: { "meta.description": { status: "warn", label: "説明文が短い", pages: 1 } },
      brokenLinks: ["https://example.com/a"],
    });
    const after = snap({
      overall: 78,
      categories: { meta: 70, headings: 88 },
      issues: {
        "meta.description": { status: "fail", label: "説明文がありません", pages: 3 },
        "headings.h1": { status: "warn", label: "h1 が複数", pages: 1 },
      },
      brokenLinks: ["https://example.com/a", "https://example.com/b"],
    });
    const alerts = deriveAlerts({ previousStatus: "success", previous: before, current: { status: "success", snapshot: after } });
    expect(titles(alerts)).toEqual([
      "critical:重大な問題が新たに 1 件見つかりました",
      "critical:リンク切れが新たに 1 件見つかりました",
      "warning:総合スコアが 85 → 78 点に下がりました",
      "warning:警告が新たに 1 件見つかりました",
    ]);
    expect(alerts[0].details).toEqual(["説明文がありません"]);
    expect(alerts[1].details).toEqual(["https://example.com/b"]);
    expect(alerts[2].details).toEqual(["メタ情報 90 → 70 点", "見出し 90 → 88 点"]);
  });

  it("reports fixes as info", () => {
    const before = snap({
      overall: 70,
      issues: { "meta.title": { status: "fail", label: "title がありません", pages: 2 } },
      brokenLinks: ["https://example.com/a"],
    });
    const after = snap({ overall: 72, issues: {}, brokenLinks: [] });
    const alerts = deriveAlerts({ previousStatus: "success", previous: before, current: { status: "success", snapshot: after } });
    expect(titles(alerts)).toEqual(["info:2 件の問題が解消しました"]);
    expect(alerts[0].details).toEqual(["解消: title がありません", "リンク切れ 1 件が直りました"]);
  });

  it("caps long detail lists", () => {
    const broken = Array.from({ length: 25 }, (_, i) => `https://example.com/p${i}`);
    const alerts = deriveAlerts({
      previousStatus: "success",
      previous: snap(),
      current: { status: "success", snapshot: snap({ brokenLinks: broken }) },
    });
    expect(alerts[0].details).toHaveLength(10);
    expect(alerts[0].details.at(-1)).toBe("ほか 16 件");
  });

  it("does not treat links as new when the previous run did not check them", () => {
    const alerts = deriveAlerts({
      previousStatus: "success",
      previous: snap({ brokenLinks: undefined }),
      current: { status: "success", snapshot: snap({ brokenLinks: [] }) },
    });
    expect(alerts).toEqual([]);
  });
});
