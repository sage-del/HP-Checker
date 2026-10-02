import * as cheerio from "cheerio";
import { check } from "./check";
import type { CheckResult } from "./types";

export interface MetaInfo {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  canonical: string | null;
  lang: string | null;
}

export function extractMeta($: cheerio.CheerioAPI): MetaInfo {
  const text = (v: string | undefined) => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    title: text($("head title").first().text() || $("title").first().text()),
    description: text($('meta[name="description"]').attr("content")),
    ogTitle: text($('meta[property="og:title"]').attr("content")),
    ogDescription: text($('meta[property="og:description"]').attr("content")),
    ogImage: text($('meta[property="og:image"]').attr("content")),
    canonical: text($('link[rel="canonical"]').attr("href")),
    lang: text($("html").attr("lang")),
  };
}

/** 日本語は 1 文字あたりの情報量が多いので、全角文字を 2 幅として数える */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e7f ? 2 : 1;
  }
  return w;
}

export function checkMeta($: cheerio.CheerioAPI): CheckResult[] {
  const meta = extractMeta($);
  const results: CheckResult[] = [];

  // --- title -----------------------------------------------------------------
  if (!meta.title) {
    results.push(
      check({
        id: "title",
        category: "meta",
        status: "fail",
        weight: 3,
        label: "title タグがない",
        advice:
          "title タグはページの名前そのものです。検索結果と AI の回答の両方で、ページを識別する最初の手がかりになります。<head> 内に <title>ページ名 | サイト名</title> を追加してください。",
      }),
    );
  } else {
    const width = displayWidth(meta.title);
    const tooLong = width > 70;
    const tooShort = width < 10;
    results.push(
      check({
        id: "title",
        category: "meta",
        status: tooLong || tooShort ? "warn" : "pass",
        weight: 3,
        label: tooLong
          ? "title タグが長すぎる"
          : tooShort
            ? "title タグが短すぎる"
            : "title タグがある",
        evidence: `「${meta.title}」（全角換算 ${Math.ceil(width / 2)} 文字）`,
        advice: tooLong
          ? "title は全角 30〜35 文字程度に収めると、検索結果で途中で切れず、AI も要点を掴みやすくなります。"
          : "title が短すぎると、ページの内容が伝わりません。「何のページか + サイト名」の形で 10 文字以上にしてください。",
      }),
    );
  }

  // --- meta description ------------------------------------------------------
  if (!meta.description) {
    results.push(
      check({
        id: "description",
        category: "meta",
        status: "fail",
        weight: 3,
        label: "meta description がない",
        advice:
          "meta description はページの要約です。AI 検索はここを「このページは何について書かれているか」の要約として参照します。<meta name=\"description\" content=\"...\"> を全角 60〜120 文字程度で追加してください。",
      }),
    );
  } else {
    const width = displayWidth(meta.description);
    const tooLong = width > 320;
    const tooShort = width < 50;
    results.push(
      check({
        id: "description",
        category: "meta",
        status: tooLong || tooShort ? "warn" : "pass",
        weight: 3,
        label: tooLong
          ? "meta description が長すぎる"
          : tooShort
            ? "meta description が短すぎる"
            : "meta description がある",
        evidence: `全角換算 ${Math.ceil(width / 2)} 文字`,
        advice: tooLong
          ? "meta description は全角 120 文字程度までに収めると、要約として扱われやすくなります。"
          : "meta description が短すぎます。ページの要点を全角 60〜120 文字で書いてください。",
      }),
    );
  }

  // --- OGP -------------------------------------------------------------------
  const hasOgp = Boolean(meta.ogTitle && meta.ogDescription);
  results.push(
    check({
      id: "ogp",
      category: "meta",
      status: hasOgp ? "pass" : meta.ogTitle || meta.ogDescription ? "warn" : "fail",
      weight: 2,
      label: hasOgp
        ? "OGP（og:title / og:description）がある"
        : "OGP（og:title / og:description）が不足している",
      evidence: hasOgp
        ? undefined
        : `og:title: ${meta.ogTitle ? "あり" : "なし"} / og:description: ${meta.ogDescription ? "あり" : "なし"}`,
      advice:
        "OGP は SNS やチャットでリンクを共有したときの表示情報ですが、AI クローラもページ要約の補助として参照します。og:title と og:description、可能なら og:image を <head> に追加してください。",
    }),
  );

  // --- canonical -------------------------------------------------------------
  results.push(
    check({
      id: "canonical",
      category: "meta",
      status: meta.canonical ? "pass" : "warn",
      weight: 1,
      label: meta.canonical ? "canonical URL が設定されている" : "canonical URL が設定されていない",
      evidence: meta.canonical ?? undefined,
      advice:
        "canonical は「このページの正式な URL はこれ」と宣言するタグです。www の有無やパラメータ違いで同じ内容が複数 URL に分散すると評価が割れるため、<link rel=\"canonical\" href=\"正式URL\"> を追加してください。",
    }),
  );

  // --- lang ------------------------------------------------------------------
  results.push(
    check({
      id: "lang",
      category: "meta",
      status: meta.lang ? "pass" : "warn",
      weight: 1,
      label: meta.lang ? "html の lang 属性がある" : "html の lang 属性がない",
      evidence: meta.lang ? `lang="${meta.lang}"` : undefined,
      advice:
        "lang 属性はページの言語を宣言します。<html lang=\"ja\"> のように設定すると、AI が日本語ページとして正しく扱い、日本語の質問に対して引用されやすくなります。",
    }),
  );

  return results;
}
