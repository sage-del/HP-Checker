import { describe, expect, it } from "vitest";
import { isNavActive, NAV_GROUPS } from "../nav";

const items = NAV_GROUPS.flatMap((g) => g.items);
const activeAt = (pathname: string) => items.filter((i) => isNavActive(i, pathname)).map((i) => i.label);

describe("isNavActive", () => {
  it("selects exactly one tab per screen", () => {
    expect(activeAt("/")).toEqual(["サイト診断"]);
    expect(activeAt("/monitor")).toEqual(["ダッシュボード"]);
    expect(activeAt("/monitor/sites/3")).toEqual(["ダッシュボード"]);
    expect(activeAt("/monitor/new")).toEqual(["サイト追加"]);
    expect(activeAt("/monitor/links")).toEqual(["リンク切れ"]);
    expect(activeAt("/monitor/runs")).toEqual(["診断履歴"]);
    expect(activeAt("/monitor/runs/12")).toEqual(["診断履歴"]);
    expect(activeAt("/monitor/alerts")).toEqual(["通知"]);
    expect(activeAt("/settings")).toEqual(["設定"]);
  });

  it("has unique links", () => {
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });
});
