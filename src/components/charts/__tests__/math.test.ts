import { describe, expect, it } from "vitest";
import {
  circumference,
  donutDash,
  niceMax,
  percentages,
  polarToCartesian,
  ringSegmentPath,
  segmentAngles,
} from "../math";

describe("polarToCartesian", () => {
  it("0° は 12 時、90° は 3 時", () => {
    expect(polarToCartesian(80, 80, 64, 0)).toEqual({ x: 80, y: 16 });
    expect(polarToCartesian(80, 80, 64, 90)).toEqual({ x: 144, y: 80 });
    expect(polarToCartesian(80, 80, 64, 180)).toEqual({ x: 80, y: 144 });
  });
});

describe("donutDash", () => {
  it("r=64 の円周は 402.1、72 点なら 289.51", () => {
    const circ = circumference(64);
    expect(circ).toBe(402.1);
    expect(donutDash(72, 100, circ)).toEqual({ dasharray: "289.51 402.1", dashoffset: 0 });
  });
  it("範囲外は丸める", () => {
    expect(donutDash(150, 100, 100).dasharray).toBe("100 100");
    expect(donutDash(-3, 100, 100).dasharray).toBe("0 100");
    expect(donutDash(5, 0, 100).dasharray).toBe("0 100");
  });
});

describe("ringSegmentPath", () => {
  it("0 以下の角度は空", () => {
    expect(ringSegmentPath(0, 0, 10, 5, 90, 10)).toBe("");
  });
  it("環状の扇形は外周 → 内周で閉じる", () => {
    const d = ringSegmentPath(70, 70, 70, 52, 0, 90);
    expect(d.startsWith("M 70 0 A 70 70 0 0 1 140 70 L 122 70 A 52 52 0 0 0 70 18 Z")).toBe(true);
  });
  it("穴なし（円グラフ）は中心から始まる", () => {
    expect(ringSegmentPath(70, 70, 70, 0, 0, 90)).toBe("M 70 70 L 70 0 A 70 70 0 0 1 140 70 Z");
  });
  it("全周のリングは外周と内周の 2 つのサブパス", () => {
    const d = ringSegmentPath(70, 70, 70, 52, 0, 360);
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });
});

describe("segmentAngles", () => {
  it("合計が 360 になり、0 の区分は飛ばす", () => {
    const a = segmentAngles([25, 0, 75]);
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual({ index: 0, start: 0, end: 90, fraction: 0.25 });
    expect(a[1].index).toBe(2);
    expect(a[1].end).toBe(360);
  });
  it("全部 0 なら空", () => {
    expect(segmentAngles([0, 0])).toEqual([]);
  });
  it("1 区分だけなら全周", () => {
    expect(segmentAngles([0, 7, 0])).toEqual([{ index: 1, start: 0, end: 360, fraction: 1 }]);
  });
});

describe("niceMax", () => {
  it("きりのよい上限", () => {
    expect(niceMax(61, 4)).toBe(80);
    expect(niceMax(3, 4)).toBe(4);
    expect(niceMax(0, 4)).toBe(4);
    expect(niceMax(128, 4)).toBe(200);
    expect(niceMax(17, 4)).toBe(20);
    expect(niceMax(100, 4)).toBe(100);
  });
});


describe("percentages", () => {
  it("合計 100 に丸める", () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([3, 0, 1])).toEqual([75, 0, 25]);
  });
});
