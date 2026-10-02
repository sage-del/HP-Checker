import * as cheerio from "cheerio";
import { check } from "./check";
import type { CheckResult } from "./types";

export interface HeadingInfo {
  h1: string[];
  counts: Record<1 | 2 | 3 | 4 | 5 | 6, number>;
  /** 出現順のレベル列。階層飛びの判定に使う */
  sequence: number[];
}

export function extractHeadings($: cheerio.CheerioAPI): HeadingInfo {
  const info: HeadingInfo = {
    h1: [],
    counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    sequence: [],
  };
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = Number(el.tagName.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return; // 空見出しは無視
    info.counts[level] += 1;
    info.sequence.push(level);
    if (level === 1) info.h1.push(text);
  });
  return info;
}

/** h2 → h4 のように 1 段以上飛んで深くなる箇所があるか */
export function findLevelSkips(sequence: number[]): number {
  let skips = 0;
  let prev = 0;
  for (const level of sequence) {
    if (prev > 0 && level > prev + 1) skips += 1;
    prev = level;
  }
  return skips;
}

export function checkHeadings($: cheerio.CheerioAPI): CheckResult[] {
  const info = extractHeadings($);
  const results: CheckResult[] = [];
  const h1Count = info.counts[1];

  results.push(
    check({
      id: "h1",
      category: "headings",
      status: h1Count === 1 ? "pass" : h1Count === 0 ? "fail" : "warn",
      weight: 3,
      label:
        h1Count === 1
          ? "H1見出しが適切にある"
          : h1Count === 0
            ? "H1見出しがない"
            : "H1見出しが複数ある",
      evidence:
        h1Count === 0 ? undefined : `h1: ${info.h1.map((t) => `「${t}」`).join(" ")}`,
      advice:
        h1Count === 0
          ? "H1 はページの主題を示す最上位の見出しです。AI はまず H1 で「このページは何の話か」を掴みます。ページに 1 つ、内容を端的に表す H1 を置いてください。"
          : "H1 が複数あると、ページの主題が分散して伝わります。最も重要な 1 つだけを H1 にし、残りは H2 以下に下げてください。",
    }),
  );

  const subHeadings = info.counts[2] + info.counts[3];
  const skips = findLevelSkips(info.sequence);
  const structured = subHeadings >= 1 && skips === 0;
  results.push(
    check({
      id: "heading-structure",
      category: "headings",
      status: structured ? "pass" : subHeadings >= 1 ? "warn" : "fail",
      weight: 2,
      label: structured
        ? "見出し構造がある"
        : subHeadings >= 1
          ? "見出しの階層が飛んでいる"
          : "見出し構造がない",
      evidence: `h1:${info.counts[1]} h2:${info.counts[2]} h3:${info.counts[3]} h4:${info.counts[4]}${
        skips > 0 ? ` / 階層飛び ${skips} 箇所` : ""
      }`,
      advice:
        subHeadings >= 1
          ? "h2 の直後に h4 が来るなど、見出しレベルが飛んでいます。h1 → h2 → h3 の順に段階的に使うと、AI が文章の構造（どの話題の下にどの話題があるか）を正しく読み取れます。"
          : "H2・H3 の小見出しがありません。本文を話題ごとに区切り、各ブロックに H2（必要なら H3）を付けると、AI が「この段落は何について書かれているか」を理解しやすくなります。",
    }),
  );

  return results;
}
