import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { palette } from "@/lib/ui/palette";
import { Donut } from "../Donut";
import { HBar } from "../HBar";
import { HeatCell, heatCellClass } from "../HeatCell";
import { Histogram } from "../Histogram";
import { Pie } from "../Pie";
import { SegmentBar } from "../SegmentBar";

/** チャートのハードルール（ui-notes §2）: 数値の width/height + viewBox、hex 直書き、var() 無し */
function expectSvgRules(html: string) {
  const svgs = html.match(/<svg[^>]*>/g) ?? [];
  expect(svgs.length).toBeGreaterThan(0);
  for (const tag of svgs) {
    expect(tag).toMatch(/ width="\d+(\.\d+)?"/);
    expect(tag).toMatch(/ height="\d+(\.\d+)?"/);
    expect(tag).toMatch(/ viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/);
    expect(tag).toMatch(/role="img"/);
    expect(tag).toMatch(/aria-label="[^"]+"/);
  }
  expect(html).toContain("<title>");
  expect(html).not.toMatch(/var\(--/);
  expect(html).not.toMatch(/fill-(accent|pass|warn|fail|chart)/);
  const colors = html.match(/(?:fill|stroke)="([^"]+)"/g) ?? [];
  for (const c of colors) {
    expect(c).toMatch(/="(#[0-9a-f]{6}|none)"/);
  }
}

describe("Donut", () => {
  it("160×160、r=64、グレード色、中央ラベル", () => {
    const html = renderToStaticMarkup(createElement(Donut, { value: 72 }));
    expectSvgRules(html);
    expect(html).toContain('width="160"');
    expect(html).toContain('r="64"');
    expect(html).toContain(`stroke="${palette.grade.C}"`);
    expect(html).toContain('stroke-dasharray="289.51 402.1"');
    expect(html).toContain('transform="rotate(-90 80 80)"');
    expect(html).toContain(">72<");
    expect(html).toContain("/100");
  });
});

describe("Pie", () => {
  it("区分ごとの path と凡例、0 件の行も残る", () => {
    const html = renderToStaticMarkup(
      createElement(Pie, {
        segments: [
          { label: "合格", value: 12, color: palette.pass },
          { label: "改善余地", value: 0, color: palette.warn },
          { label: "未対応", value: 4, color: palette.fail },
        ],
      }),
    );
    expectSvgRules(html);
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain(`fill="${palette.pass}"`);
    expect(html).toContain("改善余地");
    expect(html).toContain("75%");
    expect(html).toContain(">16<");
  });
  it("合計 0 は空状態", () => {
    const html = renderToStaticMarkup(createElement(Pie, { segments: [{ label: "a", value: 0, color: palette.pass }] }));
    expect(html).not.toContain("<svg");
    expect(html).toContain("表示できるデータがありません");
  });
});

describe("HBar", () => {
  it("目盛 50 / 80、レンジ帯、判定色の数値", () => {
    const html = renderToStaticMarkup(
      createElement(HBar, {
        rows: [
          { label: "構造化データ", value: 45, range: { min: 20, max: 90 } },
          { label: "メタ情報", value: 85 },
        ],
      }),
    );
    expectSvgRules(html);
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain('x1="200"');
    expect(html).toContain('x1="320"');
    expect(html).toContain(`fill="${palette.chart[2]}"`);
    expect(html).toContain("text-fail");
    expect(html).toContain("text-pass");
    expect(html).toContain("最低〜最高");
  });
  it("空", () => {
    expect(renderToStaticMarkup(createElement(HBar, { rows: [] }))).toContain("表示できるデータがありません");
  });
});

describe("Histogram", () => {
  it("5 区分 → 320×140、件数の text、マーカー", () => {
    const html = renderToStaticMarkup(
      createElement(Histogram, {
        bands: [
          { label: "E", sublabel: "0–49", count: 3, color: palette.grade.E },
          { label: "D", sublabel: "50–64", count: 10, color: palette.grade.D },
          { label: "C", sublabel: "65–79", count: 61, color: palette.grade.C },
          { label: "B", sublabel: "80–89", count: 20, color: palette.grade.B },
          { label: "A", sublabel: "90–100", count: 0, color: palette.grade.A },
        ],
        marker: { fraction: 0.68, label: "平均 68 点" },
      }),
    );
    expectSvgRules(html);
    expect(html).toContain('width="320"');
    expect(html).toContain('viewBox="0 0 320 140"');
    expect(html).toContain(">61</text>");
    expect(html).toContain('stroke-dasharray="4 3"');
    expect(html).toContain("平均 68 点");
    expect(html.match(/<rect /g)).toHaveLength(4);
  });
});

describe("SegmentBar", () => {
  it("1 本の区分棒 400×12（x が積算される）", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentBar, {
        segments: [
          { label: "AI クローラ", value: 20, color: palette.chart[0] },
          { label: "構造化データ", value: 25, color: palette.chart[1] },
          { label: "メタ情報", value: 20, color: palette.chart[2] },
          { label: "見出し", value: 15, color: palette.chart[3] },
          { label: "コンテンツ", value: 20, color: palette.chart[4] },
        ],
      }),
    );
    expectSvgRules(html);
    expect(html).toContain('x="80" y="0" width="100"');
    expect(html).toContain('x="180"');
    expect(html).toContain('x="320" y="0" width="80"');
  });
});

describe("HeatCell", () => {
  it("HeatCell は判定の地色 + 数値", () => {
    expect(heatCellClass(85)).toBe("bg-pass-soft");
    expect(heatCellClass(60)).toBe("bg-warn-soft");
    expect(heatCellClass(10)).toBe("bg-fail-soft");
    const html = renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement(HeatCell, { score: 42 })))));
    expect(html).toContain("bg-fail-soft");
    expect(html).toContain(">42</td>");
  });
});
