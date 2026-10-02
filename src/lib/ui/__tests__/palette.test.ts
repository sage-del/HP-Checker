import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeOf, gradeLabel, palette, scoreTone, toneColors } from "../palette";
import { toneOf } from "../grade";

/** globals.css の @theme から `--color-xxx: #hex` を全部読む */
function readThemeColors(): Record<string, string> {
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
  const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!theme) throw new Error("@theme block not found");
  const colors: Record<string, string> = {};
  for (const m of theme[1].matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    colors[m[1]] = m[2].toLowerCase();
  }
  return colors;
}

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

describe("palette は globals.css の @theme と一致する", () => {
  const colors = readThemeColors();

  it("単色トークン", () => {
    for (const [name, value] of Object.entries(palette)) {
      if (typeof value !== "string") continue;
      expect(colors[kebab(name)], `--color-${kebab(name)}`).toBe(value);
    }
  });

  it("系列色 chart-1〜6", () => {
    palette.chart.forEach((hex, i) => {
      expect(colors[`chart-${i + 1}`]).toBe(hex);
    });
  });

  it("グレード色 grade-a〜e", () => {
    for (const [g, hex] of Object.entries(palette.grade)) {
      expect(colors[`grade-${g.toLowerCase()}`]).toBe(hex);
    }
  });

  it("紫（元ツール）は定義しない", () => {
    expect(Object.values(colors)).not.toContain("#5b4de0");
  });
});

describe("scoreTone / gradeOf", () => {
  it("判定の閾値は 80 / 50", () => {
    expect(scoreTone(100)).toBe("pass");
    expect(scoreTone(80)).toBe("pass");
    expect(scoreTone(79)).toBe("warn");
    expect(scoreTone(50)).toBe("warn");
    expect(scoreTone(49)).toBe("fail");
    expect(scoreTone(0)).toBe("fail");
    expect(toneOf(80)).toBe("pass");
  });

  it("グレードの閾値は 90 / 80 / 65 / 50", () => {
    expect(gradeOf(100).grade).toBe("A");
    expect(gradeOf(90).grade).toBe("A");
    expect(gradeOf(89).grade).toBe("B");
    expect(gradeOf(80).grade).toBe("B");
    expect(gradeOf(79).grade).toBe("C");
    expect(gradeOf(65).grade).toBe("C");
    expect(gradeOf(64).grade).toBe("D");
    expect(gradeOf(50).grade).toBe("D");
    expect(gradeOf(49).grade).toBe("E");
    expect(gradeOf(0).grade).toBe("E");
  });

  it("グレードの色・ラベル・範囲", () => {
    const c = gradeOf(70);
    expect(c).toEqual({ grade: "C", label: "改善余地あり", color: palette.grade.C, min: 65, max: 79 });
    expect(gradeOf(95).max).toBe(100);
    expect(gradeOf(10).min).toBe(0);
    expect(gradeLabel("E")).toBe("要対策");
  });

  it("grade-c = warn、grade-e = fail は同色（意図的）", () => {
    expect(palette.grade.C).toBe(palette.warn);
    expect(palette.grade.E).toBe(palette.fail);
  });

  it("範囲外・NaN は丸める", () => {
    expect(gradeOf(120).grade).toBe("A");
    expect(gradeOf(-5).grade).toBe("E");
    expect(scoreTone(Number.NaN)).toBe("fail");
  });

  it("toneColors は soft 地を返す", () => {
    expect(toneColors("warn")).toEqual({ fg: palette.warn, bg: palette.warnSoft });
  });
});
