import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { checkContent, extractContent } from "../content";
import {
  guessLang,
  hasFact,
  langFromTag,
  langOf,
  readLangContext,
  splitBlock,
  splitSentences,
} from "../sentences";

/**
 * 句点を持たない言語のページでも文を数えられることの検証。
 *
 * きっかけ: 英語ページが、本文を 2 倍に増やしても毎回「1 / 全 1 文」で
 * 「改善余地」と報告されていた。文の分割が句点（。）固定だったため本文全体が
 * 1 文になり、さらに分母 1 のまま比率で判定していたのが原因。
 */

const URL = "https://example.com/en";

function page(body: string, lang: string | null = "en"): string {
  const attr = lang === null ? "" : ` lang="${lang}"`;
  return `<html${attr}><head><meta charset="utf-8"><title>t</title></head><body><nav>Home Menu Contact</nav><main>${body}</main><footer>footer</footer></body></html>`;
}

function analyze(html: string) {
  return extractContent(html, URL, cheerio.load(html));
}

function specificity(html: string) {
  const info = analyze(html);
  const result = checkContent(info).find((r) => r.id === "content-specificity");
  return { info, result };
}

/* ─────────────────────────────────────────────────────────────
   言語の判定
   ───────────────────────────────────────────────────────────── */

describe("言語の判定", () => {
  it("lang 属性を読む（ja / zh は句点区切り、それ以外はピリオド区切り）", () => {
    expect(langFromTag("ja")).toBe("ja");
    expect(langFromTag("ja-JP")).toBe("ja");
    expect(langFromTag("zh-Hans")).toBe("ja");
    expect(langFromTag("en")).toBe("latin");
    expect(langFromTag("en-US")).toBe("latin");
    expect(langFromTag("")).toBeNull();
    expect(langFromTag(undefined)).toBeNull();
  });

  it("lang が無ければ文字種（かな・漢字の比率）で推定する", () => {
    expect(guessLang("当社は東京都にあります。")).toBe("ja");
    expect(guessLang("We are based in Tokyo.")).toBe("latin");
    // 日本語の文に英語の固有名詞が混ざっても日本語のまま
    expect(guessLang("当社の正式名称は Wolf Incorporated です。")).toBe("ja");
    // 数字と記号だけでは判断できない
    expect(guessLang("2024 / 2025")).toBeNull();
  });

  it("要素の lang 属性は、そのブロックだけ言語を上書きする", () => {
    const html = `<html lang="ja"><body><main>
      <p>当社は東京都にあります。</p>
      <p lang="en">2024. 2025. 2026.</p>
    </main></body></html>`;
    const $ = cheerio.load(html);
    const ctx = readLangContext($, "当社は東京都にあります。 2024. 2025. 2026.");
    expect(ctx.page).toBe("ja");
    expect(ctx.tag).toBe("ja");
    // 数字だけのブロックは文字種で判断できない。lang 属性が無ければページ既定（ja）だが、
    // lang="en" が宣言されているのでピリオドで切る
    expect(langOf("2024. 2025. 2026.", ctx)).toBe("latin");
    expect(langOf("当社は東京都にあります。", ctx)).toBe("ja");
    expect(splitSentences(["2024. 2025. 2026."], ctx)).toHaveLength(3);
  });
});

/* ─────────────────────────────────────────────────────────────
   文の分割
   ───────────────────────────────────────────────────────────── */

describe("文の分割（英語）", () => {
  it("略語・小数・URL・メール・頭字語では切らない", () => {
    expect(splitBlock("Wolf Inc. is a Tokyo firm. It opened in 2024.", "latin")).toEqual([
      "Wolf Inc. is a Tokyo firm.",
      "It opened in 2024.",
    ]);
    expect(splitBlock("The rate is 1.5% of 33,000 yen.", "latin")).toHaveLength(1);
    expect(splitBlock("See https://wolf-g.jp/en for details.", "latin")).toHaveLength(1);
    expect(splitBlock("Write to info@wolf-g.jp before Friday.", "latin")).toHaveLength(1);
    expect(splitBlock("We use A.I. tools from the U.S. market.", "latin")).toHaveLength(1);
    expect(splitBlock("No. 12 and e.g. this one are included.", "latin")).toHaveLength(1);
    expect(splitBlock("Co., Ltd. is the legal form.", "latin")).toHaveLength(1);
  });

  it("感嘆符・疑問符・引用符の閉じでも文が終わる", () => {
    expect(splitBlock('He asked "why?" Then he left. Done!', "latin")).toEqual([
      'He asked "why?"',
      "Then he left.",
      "Done!",
    ]);
  });

  it("受け入れ条件の 1 文はちょうど 1 文で、具体情報を含む", () => {
    const sentence =
      "Wolf Inc. is a Tokyo-based firm founded on November 6, 2024, corporate number 4011001165835.";
    expect(splitBlock(sentence, "latin")).toEqual([sentence]);
    expect(hasFact(sentence)).toBe(true);
  });
});

describe("文の分割（日本語）", () => {
  it("句点・感嘆符・疑問符で切り、ピリオドでは切らない", () => {
    expect(splitBlock("当社は東京にあります。創業は 1998 年です！", "ja")).toEqual([
      "当社は東京にあります。",
      "創業は 1998 年です！",
    ]);
    // 日英混在: 英語の社名に含まれるピリオドで文が割れない
    expect(splitBlock("正式名称は Wolf Inc. です。2024 年に設立しました。", "ja")).toEqual([
      "正式名称は Wolf Inc. です。",
      "2024 年に設立しました。",
    ]);
  });
});

/* ─────────────────────────────────────────────────────────────
   具体情報の判定（日英）
   ───────────────────────────────────────────────────────────── */

describe("具体情報の判定", () => {
  it.each([
    ["創業は 1998 年、資本金は 3,000 万円です。", true],
    ["株式会社ウルフが運営しています。", true],
    ["お電話は 03-1234-5678、受付は 9:00 から 18:00 です。", true],
    ["〒100-0001 東京都千代田区", true],
    ["価格は１，５００円です。", true], // 全角数字
    ["We opened 33 stores across Japan.", true],
    ["The firm was founded on November 6, 2024.", true],
    ["Wolf Inc. is registered in Tokyo.", true],
    ["Contact us at info@wolf-g.jp or +81-3-1234-5678.", true],
    ["Our conversion rate improved by 12%.", true],
    ["The report was published 2026-04-18.", true],
    ["私たちは価値を提供します。", false],
    ["We deliver value to our customers.", false],
    ["お客様に寄り添うサービスです。", false],
  ])("「%s」 → 具体情報 %s", (sentence, expected) => {
    expect(hasFact(sentence)).toBe(expected);
  });
});

/* ─────────────────────────────────────────────────────────────
   受け入れ条件（ページ単位）
   ───────────────────────────────────────────────────────────── */

/** 事実を含む英文 52 本（句点ゼロ）。4 文ずつ 13 段落に分ける */
const EN_FACTS = [
  "Wolf Inc. was founded on November 6, 2024, in Tokyo.",
  "The company runs 33 stores across 12 prefectures.",
  "Our team of 48 people supports 1,200 clients.",
  "Revenue reached 480,000,000 yen in the year ending March 2026.",
];
const EN_BODY = Array.from({ length: 13 }, (_, i) =>
  `<p>${EN_FACTS.map((s) => s.replace("Wolf Inc.", `Wolf ${i + 1} Inc.`)).join(" ")}</p>`,
).join("");
/** 見出し 1 本 + 英文 52 本 */
const EN_EXPECTED_SENTENCES = 1 + 13 * 4;

describe("純英語のページ", () => {
  it("句点が無くても実際の文数（±10%）で数え、比率 100% なら減点しない", () => {
    const { info, result } = specificity(page(`<h1>About Wolf</h1>${EN_BODY}`));
    expect(info.contentLang).toBe("latin");
    expect(info.totalSentences).toBeGreaterThanOrEqual(Math.floor(EN_EXPECTED_SENTENCES * 0.9));
    expect(info.totalSentences).toBeLessThanOrEqual(Math.ceil(EN_EXPECTED_SENTENCES * 1.1));
    // 事実を含む文が 52 本ある = 比率はほぼ 100%
    expect(info.concreteSentences).toBeGreaterThanOrEqual(52);
    expect(result?.status).toBe("pass");
  });

  it("判定の根拠（総文数・実例・しきい値・言語）をレポートに出す", () => {
    const { result } = specificity(page(`<h1>About Wolf</h1>${EN_BODY}`));
    expect(result?.evidence).toContain(`全 ${EN_EXPECTED_SENTENCES} 文`);
    expect(result?.evidence).toContain("判定: 比率");
    expect(result?.evidence).toContain("10% 以上かつ 2 文以上");
    expect(result?.evidence).toContain("英語など（. 区切り）");
    expect(result?.evidence).toContain('html lang="en"');
    expect(result?.evidence).toContain("具体情報と判定した文の例:");
    expect(result?.evidence).toContain("November 6, 2024");
  });
});

describe("既存の日本語ページ", () => {
  // 現行の実測値と同じであること（句点で 60 文、うち事実 0 文 → fail）
  it("句点区切りの本文は今までと同じ文数・同じ判定になる", () => {
    const body = `<p>${"弊社は価値を提供する会社です。".repeat(60)}</p>`;
    const { info, result } = specificity(page(`<h1>会社案内</h1>${body}`, "ja"));
    expect(info.contentLang).toBe("ja");
    expect(info.totalSentences).toBe(61); // 見出し 1 + 本文 60
    expect(info.concreteSentences).toBe(0);
    expect(result?.status).toBe("fail");
  });

  it("具体情報のある日本語ページは今までどおり pass", () => {
    const body = `<p>創業は 1998 年です。東京都千代田区に本社があります。電話は 03-1234-5678 です。受付は 9:00 から 18:00 です。年間 1,200 件の相談に対応しています。</p>`;
    const { info, result } = specificity(page(`<h1>会社概要</h1>${body}`, "ja"));
    expect(info.totalSentences).toBe(6); // 見出し 1 + 本文 5
    // 「東京都千代田区に本社があります。」には数値も連絡先も無いので具体情報には数えない
    expect(info.concreteSentences).toBe(4);
    expect(result?.status).toBe("pass");
    expect(result?.evidence).toContain("判定: 比率");
  });
});

describe("日英混在のページ", () => {
  it("英語の社名や引用が混ざっても分割が壊れない", () => {
    const body = `<p>正式名称は Wolf Inc. です。2024 年 11 月 6 日に設立しました。</p>
      <blockquote lang="en">We opened 33 stores in 2025. Revenue grew by 12%.</blockquote>`;
    const { info, result } = specificity(page(`<h1>会社概要</h1>${body}`, "ja"));
    // 見出し 1 + 日本語 2 + 英語 2
    expect(info.totalSentences).toBe(5);
    expect(info.concreteSentences).toBe(4);
    expect(result?.status).toBe("pass");
  });
});

describe("箇条書き主体のページ", () => {
  it("句読点の無い li 20 件は 1 文ではなく 20 文と数える", () => {
    const items = Array.from({ length: 20 }, (_, i) => `<li>拠点 ${i + 1} 号店</li>`).join("");
    const { info } = specificity(page(`<h1>店舗一覧</h1><ul>${items}</ul>`, "ja"));
    expect(info.totalSentences).toBeGreaterThanOrEqual(20);
  });

  it("英語の箇条書きでも同じ", () => {
    const items = Array.from({ length: 20 }, (_, i) => `<li>Store ${i + 1} in Tokyo</li>`).join("");
    const { info } = specificity(page(`<h1>Stores</h1><ul>${items}</ul>`));
    expect(info.totalSentences).toBeGreaterThanOrEqual(20);
  });
});

describe("分母が小さいページ", () => {
  it("3 文しかないページは比率で減点せず、判定方法をレポートに書く", () => {
    const { info, result } = specificity(
      page("<p>We opened in 2024. The office is in Tokyo. Our team is small.</p>"),
    );
    expect(info.totalSentences).toBeLessThan(5);
    expect(result?.status).not.toBe("warn");
    expect(result?.evidence).toContain("比率は使わない");
  });

  it("1 文 100% のページを「少なめ」と報告しない（測定不能として減点しない）", () => {
    const { info, result } = specificity(page("<p>Wolf Inc. opened in Tokyo in 2024.</p>", null));
    expect(info.concreteSentences).toBe(1);
    expect(result?.status).toBe("pass");
    expect(result?.label).toContain("判定できない");
    expect(result?.evidence).toContain("測定不能");
  });

  it("文が少なく具体情報が 1 つも無ければ、今までどおり warn に留める", () => {
    const { result } = specificity(page("<p>会社案内</p>", "ja"));
    expect(result?.status).toBe("warn");
  });
});
