import type * as cheerio from "cheerio";

/**
 * 文の切り出しと「具体的な事実を含む文か」の判定。
 *
 * 句点（。）だけを頼りにすると、句点を持たない言語（英語など）のページは
 * 本文全体が 1 文に数えられ、比率での判定が成立しない。ここでは
 *
 *   1. `<html lang>` / 要素の `lang` → 文字種（かな・漢字）の順に言語を決め、
 *   2. 言語ごとの規則で文に割り、
 *   3. 数値・日付・組織名・連絡先を日本語と英語のどちらの書き方でも拾う
 *
 * ことで、日本語以外のページも同じ基準で測れるようにする。
 *
 * 文の最小単位はブロック（段落・li・表のセル・見出し）で、句読点が無くても
 * ブロックはそれぞれ 1 文と数える。箇条書き主体のページが「1 文」になるのを防ぐため。
 */

/**
 * 文の割り方の系統。
 * - `ja`: 句点（。！？）で切る。中国語も同じ系統として扱う
 * - `latin`: ピリオド等（. ! ?）＋空白／行末で切る。英語をはじめラテン文字圏と韓国語
 */
export type TextLang = "ja" | "latin";

export const LANG_LABEL: Record<TextLang, string> = {
  ja: "日本語（。区切り）",
  latin: "英語など（. 区切り）",
};

/** ひらがな・カタカナ */
const RE_KANA = /[\u3040-\u30ff]/u;
/** 漢字（CJK 統合漢字と拡張 A） */
const RE_KANJI = /[\u3400-\u9fff]/u;
/** ラテン文字（アクセント付きを含む） */
const RE_LATIN_LETTER = /[A-Za-z\u00c0-\u024f]/u;

/** lang 属性（ja / ja-JP / en-US …）を文の割り方に落とす。読めなければ null */
export function langFromTag(tag: string | null | undefined): TextLang | null {
  const primary = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!primary || !/^[a-z]{2,3}$/.test(primary)) return null;
  // 中国語は日本語と同じく句点で区切る。韓国語はピリオド＋空白なので latin 側
  return primary === "ja" || primary === "zh" ? "ja" : "latin";
}

/** 文字種で推定する。かな・漢字があれば ja、ラテン文字があれば latin、材料が無ければ null */
export function guessLang(text: string): TextLang | null {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (RE_KANA.test(ch) || RE_KANJI.test(ch)) cjk += 1;
    else if (RE_LATIN_LETTER.test(ch)) latin += 1;
  }
  if (cjk === 0 && latin === 0) return null;
  // 日本語の文には英語の固有名詞が混ざる。少しでも比率があれば日本語とみなす
  return cjk > 0 && cjk / (cjk + latin) >= 0.2 ? "ja" : "latin";
}

/** 1 ページで見る lang 宣言の上限 */
const MAX_DECLARED = 50;

export interface LangContext {
  /** ページ既定の言語（`<html lang>` → 本文の文字種） */
  page: TextLang;
  /** `<html lang>` の生の値（レポート表示用） */
  tag: string | null;
  /** lang 属性を持つ要素のテキスト。ブロックがこの中に収まっていればその言語を使う */
  declared: { text: string; lang: TextLang }[];
}

/**
 * ページの言語を読む。
 *
 * `<html lang>` はページ既定として使い、body 内の `lang` 付き要素は
 * 「そのブロックだけ言語が違う」という宣言として別に持つ（html / body 自体は
 * ページ全体を覆ってしまうので既定側だけに使う）。
 */
export function readLangContext($: cheerio.CheerioAPI, mainText: string): LangContext {
  const tag = $("html").attr("lang") ?? null;
  const declared: { text: string; lang: TextLang }[] = [];
  $("[lang]").each((_, el) => {
    // 全ページ分をクロールするので、宣言の数は上限を切る（照合は文字列の包含で回す）
    if (declared.length >= MAX_DECLARED) return;
    if (el.tagName === "html" || el.tagName === "body") return;
    const lang = langFromTag($(el).attr("lang"));
    if (!lang) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) declared.push({ text, lang });
  });
  return { page: langFromTag(tag) ?? guessLang(mainText) ?? "ja", tag, declared };
}

/** ブロック 1 つの言語。lang 属性の宣言 → 文字種 → ページ既定 の順に決める */
export function langOf(block: string, ctx: LangContext): TextLang {
  const declared = ctx.declared.find((d) => d.text.includes(block));
  if (declared) return declared.lang;
  return guessLang(block) ?? ctx.page;
}

/* ─────────────────────────────────────────────────────────────
   文の切り出し
   ───────────────────────────────────────────────────────────── */

/** 文末に付いてくる閉じ記号。前の文に含める */
const CLOSERS = new Set(`"'”’）)]｝}】」』〉》`.split(""));

const RE_TERMINATOR: Record<TextLang, RegExp> = {
  ja: /[。！？!?]/,
  latin: /[.!?。！？]/,
};

/**
 * ピリオドで切ってはいけない語。
 * 略語（Inc. Ltd. No. Mr.）と月・曜日の短縮形。頭字語（U.S. A.I.）は形で判定する。
 */
const ABBREVIATIONS = new Set([
  "inc", "ltd", "co", "corp", "llc", "llp", "plc", "pte", "pty", "kk", "gmbh", "sa", "bv", "nv",
  "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "mt",
  "eg", "ie", "etc", "vs", "no", "nos", "vol", "fig", "figs", "approx", "est", "dept", "univ",
  "min", "max", "avg", "ca", "cf", "al", "ext", "tel", "fax", "attn", "dept",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

/** A.I. / U.S. / e.g. のように 1 文字ずつピリオドで区切った語 */
const RE_ACRONYM = /^(?:[A-Za-z]\.)+[A-Za-z]$/;

/** ピリオドの直前の語を取り出す（"Wolf Inc." → "Inc"、"U.S." → "U.S"） */
function tokenBefore(block: string, dotIndex: number): string {
  let i = dotIndex;
  while (i > 0 && /[A-Za-z0-9.'’-]/.test(block[i - 1])) i -= 1;
  return block.slice(i, dotIndex).replace(/\.+$/, "");
}

/**
 * ラテン文字圏で、この位置を文末として切ってよいか。
 *
 * 切らないのは次の場合:
 *   - 直後が空白でも行末でもない → 小数（1.5）・桁区切り・URL・メールアドレスの途中
 *   - 直前が略語（Inc. Ltd. No.）や頭字語（U.S. A.I.）
 *   - 続く語が小文字で始まる → 未知の略語の途中とみなす（文は大文字で始まるのが普通）
 */
function canBreakLatin(block: string, dotIndex: number, next: string | undefined): boolean {
  if (next !== undefined && !/\s/.test(next)) return false;
  if (block[dotIndex] !== ".") return true;
  const token = tokenBefore(block, dotIndex);
  if (ABBREVIATIONS.has(token.toLowerCase())) return false;
  if (RE_ACRONYM.test(token)) return false;
  return !/^\s*[a-z]/.test(block.slice(dotIndex + 1));
}

/**
 * ブロック 1 つを文に割る。終端記号が無ければブロック全体で 1 文
 * （句読点を打たない箇条書き・表のセル・見出しのため）。
 */
export function splitBlock(block: string, lang: TextLang): string[] {
  const terminator = RE_TERMINATOR[lang];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < block.length; i += 1) {
    if (!terminator.test(block[i])) continue;
    // 連続する終端記号（!! …）と、そのあとの閉じ括弧・引用符は同じ文に含める
    let end = i;
    while (end + 1 < block.length && terminator.test(block[end + 1])) end += 1;
    while (end + 1 < block.length && CLOSERS.has(block[end + 1])) end += 1;
    const next = block[end + 1];
    if (lang === "latin" && !canBreakLatin(block, i, next)) {
      i = end;
      continue;
    }
    const piece = block.slice(start, end + 1).trim();
    if (piece) out.push(piece);
    start = end + 1;
    i = end;
  }
  const rest = block.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

export interface Sentence {
  text: string;
  lang: TextLang;
}

/** ブロックの並びを文の並びにする */
export function splitSentences(blocks: readonly string[], ctx: LangContext): Sentence[] {
  const out: Sentence[] = [];
  for (const block of blocks) {
    const lang = langOf(block, ctx);
    for (const text of splitBlock(block, lang)) out.push({ text, lang });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
   具体的な事実を含む文か

   「AI が引用できる事実」= 数値・日付・組織名・連絡先。日本語の書き方
   （2024 年 11 月 6 日／株式会社／〒）と英語の書き方（November 6, 2024／
   Inc.／Tel）の両方を拾う。全角数字は半角に直してから当てる。
   ───────────────────────────────────────────────────────────── */

/** 判定にだけ使う正規化。全角数字・全角記号を半角にする（表示は元の文のまま） */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/％/g, "%")
    .replace(/＠/g, "@")
    .replace(/．/g, ".");
}

/** 数量（単位・助数詞つきの数字）: 日本語 */
const RE_QUANTITY_JA =
  /\d+(?:[.,]\d+)?\s*(?:円|万円|億円|%|人|名|社|件|個|台|回|点|種|品|室|席|階|坪|畳|㎡|平方メートル|km|m|cm|mm|kg|g|t|L|ml|年|ヶ月|か月|カ月|箇月|月|日|週|時間|分|秒|歳|才|位|倍|割|周年|以上|以下|未満)/;

/** 数量: 英語など（通貨記号＋数字、または数字＋単位） */
const RE_QUANTITY_EN =
  /[¥$€£]\s?\d|\d+(?:[.,]\d+)*\s*(?:%|yen|jpy|usd|eur|people|persons?|members?|employees?|staff|customers?|clients?|companies|stores?|shops?|branches|offices|locations|cases?|projects?|items?|units?|users?|seats?|rooms?|floors?|years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|km|kilometers?|meters?|metres?|cm|mm|kg|kilograms?|grams?|tons?|liters?|litres?|ml|sqm|m2)\b/i;

/** 日付・年月 */
const RE_DATE_JA = /\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*日|令和\s*\d+|平成\s*\d+/;
const RE_DATE_ISO = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
const RE_DATE_EN =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[a-z]+)?\.?\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:[a-z]+)?\b|\b(?:19|20)\d{2}\b/i;

/** 組織・法人格 */
const RE_ORG_JA =
  /株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|独立行政法人|学校法人|医療法人|社会福祉法人/;
const RE_ORG_EN =
  /\b(?:inc|ltd|llc|llp|plc|corp|corporation|gmbh|pte|pty|k\.k|co\.,?\s*ltd)\b\.?/i;

/** 連絡先・所在地・識別番号 */
const RE_CONTACT_JA = /〒\s*\d{3}|\d{2,4}-\d{2,4}-\d{4}|\d{1,2}:\d{2}|TEL|Tel|電話番号/;
const RE_CONTACT_EN =
  /\b(?:tel|phone|fax|e-?mail|address)\b|[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/|\+\d{1,3}[-\s(]?\d|\b\d{8,}\b/i;

const FACT_PATTERNS = [
  RE_QUANTITY_JA,
  RE_QUANTITY_EN,
  RE_DATE_JA,
  RE_DATE_ISO,
  RE_DATE_EN,
  RE_ORG_JA,
  RE_ORG_EN,
  RE_CONTACT_JA,
  RE_CONTACT_EN,
];

/** 数値・日付・組織名・連絡先のいずれかを含むか（言語を問わず同じ基準で見る） */
export function hasFact(sentence: string): boolean {
  const text = normalizeForMatch(sentence);
  return FACT_PATTERNS.some((re) => re.test(text));
}
