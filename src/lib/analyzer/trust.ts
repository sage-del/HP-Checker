/**
 * 信頼性（会社概要・プライバシーポリシー・会社情報の一致）と問い合わせ導線の判定。
 *
 * どちらもリンクと本文の書き方だけを見るルールベースの判定で、外部には出ない。
 * 会社情報の一致はページ内（構造化データと画面の表記）で 1 度判定し、サイト診断では
 * site.ts が全ページの多数派と比べた結果で置き換える（companyConsistencyCheck）。
 */
import type * as cheerio from "cheerio";
import { check } from "./check";
import type { CheckResult, CompanyFacts } from "./types";

// ---------------------------------------------------------------------------
// リンクの見分け方
// ---------------------------------------------------------------------------

const ABOUT_HREF = /(^|[/_-])(about|about-?us|company|corporate|profile|gaiyou?|kaisha|kaisya|outline|overview|corporation)([/._-]|$)/i;
const ABOUT_TEXT = /会社概要|会社案内|会社情報|企業情報|企業概要|法人概要|団体概要|事務所概要|事業所概要|医院概要|病院概要|店舗情報|当社について|私たちについて|わたしたちについて|運営会社|運営者情報|^about( us)?$|^company$/i;

const PRIVACY_HREF = /privacy|kojin-?joho|personal-?info|個人情報/i;
const PRIVACY_TEXT = /プライバシー|個人情報|privacy/i;

const CONTACT_HREF = /(^|[/_-])(contact|contact-?us|inquiry|inquiries|enquiry|toiawase|otoiawase|form|reserve|reservation|yoyaku|estimate|mitsumori|request|consultation|soudan)([/._-]|$)/i;
const CONTACT_TEXT = /お?問い?合わ?せ|問合せ|ご相談|無料相談|資料請求|お?見積|ご予約|予約する|来店予約|申し?込|contact|inquiry/i;

/** 検索フォームは問い合わせフォームに数えない */
function isContactForm($: cheerio.CheerioAPI, form: Parameters<cheerio.CheerioAPI>[0]): boolean {
  const $form = $(form);
  if ($form.attr("role") === "search") return false;
  const hasTextarea = $form.find("textarea").length > 0;
  const hasEmail = $form.find('input[type="email"], input[name*="mail" i]').length > 0;
  const hasTel = $form.find('input[type="tel"]').length > 0;
  return hasTextarea || hasEmail || hasTel;
}

function pathOf(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    if (u.origin !== base.origin) return null;
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 電話番号・郵便番号・社名
// ---------------------------------------------------------------------------

/**
 * 日本の電話番号（区切り必須）。03-1234-5678 / 0120-123-456 / (03)1234-5678 / +81-3-1234-5678。
 * 区切りを必須にするのは、日付や金額などの数字の並びを拾わないため。
 */
const PHONE_RE =
  /(?:\+81[-\s‐−–―ー]?\(?0?\)?|\(?0)\d{1,4}\)?[-\s‐−–―ー（）()]{1,2}\d{1,4}[-\s‐−–―ー]\d{3,4}(?!\d)/g;

/** 電話番号を比較用に数字だけにする（+81 は 0 に戻す）。桁数が合わなければ null */
export function normalizePhone(raw: string): string | null {
  const zenkaku = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  let digits = zenkaku.replace(/[^\d+]/g, "");
  if (digits.startsWith("+81")) digits = `0${digits.slice(3).replace(/^0/, "")}`;
  digits = digits.replace(/\D/g, "");
  if (!digits.startsWith("0")) return null;
  return digits.length === 10 || digits.length === 11 ? digits : null;
}

/** 電話番号を読みやすい形に戻す（03-1234-5678 のような正確な区切りは求めない） */
function displayPhone(digits: string): string {
  if (digits.startsWith("0120") || digits.startsWith("0800")) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return `${digits.slice(0, digits.length - 8)}-${digits.slice(-8, -4)}-${digits.slice(-4)}`;
}

const POSTAL_RE = /〒\s?(\d{3})[-‐−–―ー]?(\d{4})/g;

function normalizePostal(raw: string): string | null {
  const zenkaku = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const digits = zenkaku.replace(/\D/g, "");
  return digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : null;
}

/** 社名の表記ゆれ（空白・全角半角・株式会社の位置）を吸収して比較する */
function normalizeOrgName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（(]株[)）]|株式会社|有限会社|合同会社|inc\.?|co\.,?ltd\.?|ltd\.?|llc/gi, "")
    .toLowerCase();
}

const ORG_TYPES = new Set([
  "Organization",
  "LocalBusiness",
  "Corporation",
  "Store",
  "Restaurant",
  "MedicalBusiness",
  "ProfessionalService",
  "EducationalOrganization",
  "GovernmentOrganization",
  "NGO",
  "Dentist",
  "Physician",
  "LegalService",
  "RealEstateAgent",
  "HomeAndConstructionBusiness",
  "AutomotiveBusiness",
  "FinancialService",
  "HealthAndBeautyBusiness",
  "FoodEstablishment",
  "LodgingBusiness",
]);

interface JsonLdContact {
  phones: string[];
  orgNames: string[];
  postalCodes: string[];
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 20 || !node) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") walk(value, visit, depth + 1);
  }
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function jsonLdContact($: cheerio.CheerioAPI): JsonLdContact {
  const out: JsonLdContact = { phones: [], orgNames: [], postalCodes: [] };
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return; // 文法エラーは構造化データのカテゴリで指摘する
    }
    walk(data, (node) => {
      const t = node["@type"];
      const types = (Array.isArray(t) ? t : [t])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.replace(/^.*[/:]/, ""));
      if (!types.some((name) => ORG_TYPES.has(name))) return;
      for (const name of strings(node["name"])) {
        const n = normalizeOrgName(name);
        if (n) out.orgNames.push(n);
      }
      for (const tel of strings(node["telephone"])) {
        const p = normalizePhone(tel);
        if (p) out.phones.push(p);
      }
      walk(node["address"], (addr) => {
        for (const code of strings(addr["postalCode"])) {
          const p = normalizePostal(code);
          if (p) out.postalCodes.push(p);
        }
      });
    });
  });
  return out;
}

const uniq = (values: string[]) => [...new Set(values)];

// ---------------------------------------------------------------------------
// 抽出
// ---------------------------------------------------------------------------

export interface TrustInfo {
  /** このページ自体が会社概要か、会社概要へのリンクがあるか */
  hasAbout: boolean;
  isAbout: boolean;
  hasPrivacy: boolean;
  isPrivacy: boolean;
  /** 問い合わせページへのリンク・フォーム・tel: / mailto: のどれかがあるか */
  contactLinks: number;
  contactForms: number;
  telLinks: string[];
  mailLinks: number;
  /** 画面に書かれた電話番号（正規化済み） */
  visiblePhones: string[];
  /** ページの会社情報（構造化データ + ヘッダー・フッター・address の表記） */
  facts: CompanyFacts;
  /** 構造化データだけの会社情報（画面表記との食い違いを見る） */
  jsonLd: JsonLdContact;
  /** ヘッダー・フッター・address の表記だけの会社情報 */
  visibleFacts: { phones: string[]; postalCodes: string[] };
}

export function extractTrust($: cheerio.CheerioAPI, pageUrl: string): TrustInfo {
  const base = new URL(pageUrl);
  const ownPath = decodeURIComponent(base.pathname);
  let hasAbout = ABOUT_HREF.test(ownPath);
  let hasPrivacy = PRIVACY_HREF.test(ownPath);
  const isAbout = hasAbout;
  const isPrivacy = hasPrivacy;
  let contactLinks = CONTACT_HREF.test(ownPath) ? 1 : 0;
  let mailLinks = 0;
  const telLinks: string[] = [];

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const label = `${text} ${$(el).attr("aria-label") ?? ""} ${$(el).attr("title") ?? ""}`.trim();
    if (/^tel:/i.test(href)) {
      const p = normalizePhone(href.slice(4));
      if (p) telLinks.push(p);
      return;
    }
    if (/^mailto:/i.test(href)) {
      mailLinks += 1;
      return;
    }
    const path = pathOf(href, base);
    if (path === null) {
      // 外部のフォームサービス（Google フォームなど）への「お問い合わせ」も導線として数える
      if (CONTACT_TEXT.test(label)) contactLinks += 1;
      return;
    }
    if (ABOUT_HREF.test(path) || ABOUT_TEXT.test(text)) hasAbout = true;
    if (PRIVACY_HREF.test(path) || PRIVACY_TEXT.test(text)) hasPrivacy = true;
    if (CONTACT_HREF.test(path) || CONTACT_TEXT.test(label)) contactLinks += 1;
  });

  let contactForms = 0;
  $("form").each((_, el) => {
    if (isContactForm($, el)) contactForms += 1;
  });

  const visiblePhones: string[] = [];
  const bodyText = $("body").text();
  for (const m of bodyText.matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0]);
    if (p) visiblePhones.push(p);
  }

  // 会社情報として比べるのは、サイト共通の場所（ヘッダー・フッター・address）の表記だけ。
  // 記事本文に出てくる他社の電話番号まで混ぜると、一致しないのが当然になるため
  const blockText = $("header, footer, address, [itemtype*='Organization'], [itemtype*='LocalBusiness']")
    .map((_, el) => $(el).text())
    .get()
    .join("\n");
  const blockPhones: string[] = [];
  for (const m of blockText.matchAll(PHONE_RE)) {
    const p = normalizePhone(m[0]);
    if (p) blockPhones.push(p);
  }
  const blockPostal: string[] = [];
  for (const m of blockText.matchAll(POSTAL_RE)) {
    const p = normalizePostal(`${m[1]}${m[2]}`);
    if (p) blockPostal.push(p);
  }

  const jsonLd = jsonLdContact($);
  const visibleFacts = {
    phones: uniq([...blockPhones, ...telLinks]),
    postalCodes: uniq(blockPostal),
  };

  return {
    hasAbout,
    isAbout,
    hasPrivacy,
    isPrivacy,
    contactLinks,
    contactForms,
    telLinks: uniq(telLinks),
    mailLinks,
    visiblePhones: uniq(visiblePhones),
    facts: {
      phones: uniq([...jsonLd.phones, ...visibleFacts.phones]),
      orgNames: uniq(jsonLd.orgNames),
      postalCodes: uniq([...jsonLd.postalCodes, ...visibleFacts.postalCodes]),
    },
    jsonLd: {
      phones: uniq(jsonLd.phones),
      orgNames: uniq(jsonLd.orgNames),
      postalCodes: uniq(jsonLd.postalCodes),
    },
    visibleFacts,
  };
}

// ---------------------------------------------------------------------------
// 判定: 信頼性
// ---------------------------------------------------------------------------

const CONSISTENCY_ADVICE =
  "会社名・電話番号・郵便番号がページによって違うと、AI や検索エンジンはどれが正しい会社情報か判断できず、回答や地図の情報に古い値や別の会社の値が混ざる原因になります。ヘッダー・フッター・会社概要・構造化データ（Organization / LocalBusiness）の表記を、すべて同じ値にそろえてください。";

/** 会社情報の食い違い 1 件（どの種類で、ページの値とサイトの基準値が何だったか） */
export interface FactMismatch {
  kind: "phones" | "orgNames" | "postalCodes";
  page: string[];
  expected: string;
}

const KIND_LABEL: Record<FactMismatch["kind"], string> = {
  phones: "電話番号",
  orgNames: "社名（構造化データ）",
  postalCodes: "郵便番号",
};

function describeValue(kind: FactMismatch["kind"], value: string): string {
  return kind === "phones" ? displayPhone(value) : value;
}

/**
 * 会社情報の一致。`mismatches` が空なら合格、あれば警告。
 * `scope` は判定の範囲（ページ内だけか、サイト全体の多数派と比べたか）で、根拠の文言に使う。
 */
export function companyConsistencyCheck(
  mismatches: FactMismatch[],
  scope: "page" | "site",
  hasFacts: boolean,
): CheckResult {
  if (mismatches.length === 0) {
    return check({
      id: "company-info-consistency",
      category: "trust",
      status: "pass",
      weight: 2,
      label: hasFacts ? "会社情報の表記が一致している" : "食い違う会社情報は見つからない",
      evidence: hasFacts
        ? scope === "site"
          ? "電話番号・郵便番号・社名がサイト内の他のページと一致しています"
          : "構造化データと画面の電話番号・郵便番号が一致しています"
        : "ヘッダー・フッター・構造化データに電話番号・郵便番号・社名の記載がありません",
    });
  }
  const evidence = mismatches
    .map((m) =>
      scope === "site"
        ? `${KIND_LABEL[m.kind]}が ${m.page.map((v) => describeValue(m.kind, v)).join("・")}（サイト内の多くのページは ${describeValue(m.kind, m.expected)}）`
        : `${KIND_LABEL[m.kind]}が構造化データでは ${describeValue(m.kind, m.expected)}、画面では ${m.page.map((v) => describeValue(m.kind, v)).join("・")}`,
    )
    .join(" / ");
  return check({
    id: "company-info-consistency",
    category: "trust",
    status: "warn",
    weight: 2,
    label: "会社情報の表記がページによって食い違っている",
    evidence,
    advice: CONSISTENCY_ADVICE,
  });
}

/** ページ内の食い違い（構造化データと画面の表記） */
export function pageFactMismatches(info: TrustInfo): FactMismatch[] {
  const out: FactMismatch[] = [];
  const pairs: [FactMismatch["kind"] & ("phones" | "postalCodes"), string[], string[]][] = [
    ["phones", info.jsonLd.phones, info.visibleFacts.phones],
    ["postalCodes", info.jsonLd.postalCodes, info.visibleFacts.postalCodes],
  ];
  for (const [kind, declared, shown] of pairs) {
    if (declared.length === 0 || shown.length === 0) continue;
    if (declared.some((v) => shown.includes(v))) continue;
    out.push({ kind, page: shown, expected: declared[0] });
  }
  return out;
}

function hasAnyFacts(facts: CompanyFacts): boolean {
  return facts.phones.length + facts.orgNames.length + facts.postalCodes.length > 0;
}

/**
 * サイト全体の多数派と比べた食い違い。
 * 種類ごとに「その値を載せているページ数」が最も多い値を基準にし、
 * その種類の値を載せているのに基準値を 1 つも含まないページを食い違いとする。
 * （本社と支店の番号を併記するのは食い違いにしない）
 */
export function siteFactMismatches(
  facts: CompanyFacts,
  majority: Partial<Record<FactMismatch["kind"], string>>,
): FactMismatch[] {
  const out: FactMismatch[] = [];
  for (const kind of ["orgNames", "phones", "postalCodes"] as const) {
    const expected = majority[kind];
    const values = facts[kind];
    if (!expected || values.length === 0) continue;
    if (values.includes(expected)) continue;
    out.push({ kind, page: values, expected });
  }
  return out;
}

/**
 * 種類ごとの基準値（載せているページ数が最多の値）。
 * 2 ページ以上に載っている値だけを基準にする（1 ページだけでは比べようがない）。
 * 同数のときは先に出たページの値。
 */
export function factMajority(all: CompanyFacts[]): Partial<Record<FactMismatch["kind"], string>> {
  const result: Partial<Record<FactMismatch["kind"], string>> = {};
  for (const kind of ["orgNames", "phones", "postalCodes"] as const) {
    const counts = new Map<string, number>();
    for (const facts of all) for (const v of facts[kind]) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: string | undefined;
    let bestCount = 1;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    if (best) result[kind] = best;
  }
  return result;
}

export function checkTrust(info: TrustInfo): CheckResult[] {
  return [
    check({
      id: "trust-about",
      category: "trust",
      status: info.hasAbout ? "pass" : "fail",
      weight: 2,
      label: info.hasAbout ? "会社概要ページへの導線がある" : "会社概要ページへのリンクがない",
      evidence: info.isAbout
        ? "このページが会社概要です"
        : info.hasAbout
          ? undefined
          : "「会社概要」「企業情報」などへのリンクが見つかりません",
      advice:
        "AI や検索エンジンは、会社概要（所在地・代表者・設立・事業内容）から「実在する信頼できる会社か」を判断します。すべてのページのフッターやメニューから会社概要ページへリンクしてください。",
    }),
    check({
      id: "trust-privacy",
      category: "trust",
      status: info.hasPrivacy ? "pass" : "fail",
      weight: 2,
      label: info.hasPrivacy
        ? "プライバシーポリシーへの導線がある"
        : "プライバシーポリシーへのリンクがない",
      evidence: info.isPrivacy
        ? "このページがプライバシーポリシーです"
        : info.hasPrivacy
          ? undefined
          : "「プライバシーポリシー」「個人情報保護方針」へのリンクが見つかりません",
      advice:
        "問い合わせフォームで個人情報を受け取るサイトには、個人情報の扱いを示すプライバシーポリシーが必要です。信頼できるサイトかを判断する材料にもなるため、フッターなど全ページ共通の場所からリンクしてください。",
    }),
    companyConsistencyCheck(pageFactMismatches(info), "page", hasAnyFacts(info.facts)),
  ];
}

// ---------------------------------------------------------------------------
// 判定: 問い合わせ導線
// ---------------------------------------------------------------------------

export function checkContact(info: TrustInfo): CheckResult[] {
  const routes = info.contactLinks + info.contactForms + info.telLinks.length + info.mailLinks;
  const parts: string[] = [];
  if (info.contactForms > 0) parts.push(`問い合わせフォーム ${info.contactForms} 個`);
  if (info.contactLinks > 0) parts.push(`問い合わせへのリンク ${info.contactLinks} 箇所`);
  if (info.telLinks.length > 0) parts.push(`電話リンク ${info.telLinks.length} 件`);
  if (info.mailLinks > 0) parts.push(`メールリンク ${info.mailLinks} 件`);

  const phonesWithoutLink = info.visiblePhones.filter((p) => !info.telLinks.includes(p));
  return [
    check({
      id: "contact-link",
      category: "contact",
      status: routes > 0 ? "pass" : "fail",
      weight: 3,
      label: routes > 0 ? "問い合わせへの導線がある" : "問い合わせへの導線がない",
      evidence: routes > 0 ? parts.join("・") : "問い合わせページへのリンク・フォーム・電話やメールのリンクが見つかりません",
      advice:
        "読み終えたお客様が次に取る行動（問い合わせ・予約・資料請求）への入口が無いと、そのページから問い合わせにつながりません。ヘッダーやページ末尾など、全ページ共通の場所に問い合わせボタンを置いてください。",
    }),
    check({
      id: "contact-tel-link",
      category: "contact",
      status: phonesWithoutLink.length > 0 && info.telLinks.length === 0 ? "warn" : "pass",
      weight: 1,
      label:
        info.visiblePhones.length === 0
          ? "電話番号の記載なし（対象外）"
          : phonesWithoutLink.length > 0 && info.telLinks.length === 0
            ? "電話番号がタップで発信できない"
            : "電話番号がタップで発信できる",
      evidence:
        info.visiblePhones.length === 0
          ? undefined
          : info.telLinks.length === 0
            ? `${info.visiblePhones.map(displayPhone).join("・")} に tel: リンクがありません`
            : undefined,
      advice:
        "スマートフォンで見たお客様が番号をタップするだけで電話をかけられるよう、電話番号を <a href=\"tel:0312345678\">03-1234-5678</a> のようにリンクにしてください。",
    }),
  ];
}
