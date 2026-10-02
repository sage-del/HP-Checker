import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { analyzeFetched, type FetchedText, type SiteFiles } from "@/lib/analyzer";
import { withSiteConsistency } from "../site";
import { checkMobile, checkPerformance, checkSecurity } from "../technical";
import {
  checkContact,
  checkTrust,
  extractTrust,
  factMajority,
  normalizePhone,
  siteFactMismatches,
} from "../trust";

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((c) => c.id === id);

function trustOf(html: string, url = "https://example.com/") {
  return extractTrust(cheerio.load(html), url);
}

const FOOTER = `<footer>
  <a href="/company/">会社概要</a> <a href="/privacy-policy/">プライバシーポリシー</a>
  <address>〒100-0001 東京都千代田区千代田1-1 TEL 03-1234-5678</address>
</footer>`;

describe("normalizePhone", () => {
  it("区切りや +81 の違いを吸収する", () => {
    expect(normalizePhone("03-1234-5678")).toBe("0312345678");
    expect(normalizePhone("+81-3-1234-5678")).toBe("0312345678");
    expect(normalizePhone("(03)1234-5678")).toBe("0312345678");
    expect(normalizePhone("０３−１２３４−５６７８")).toBe("0312345678");
    expect(normalizePhone("090-1234-5678")).toBe("09012345678");
    expect(normalizePhone("2026-09-06")).toBeNull();
  });
});

describe("信頼性", () => {
  it("フッターの会社概要・プライバシーポリシーへのリンクを見つける", () => {
    const checks = checkTrust(trustOf(`<body><main>本文</main>${FOOTER}</body>`));
    expect(byId(checks, "trust-about")?.status).toBe("pass");
    expect(byId(checks, "trust-privacy")?.status).toBe("pass");
    expect(byId(checks, "company-info-consistency")?.status).toBe("pass");
  });

  it("リンクが無ければ重大", () => {
    const checks = checkTrust(trustOf("<body><main>本文</main></body>"));
    expect(byId(checks, "trust-about")?.status).toBe("fail");
    expect(byId(checks, "trust-privacy")?.status).toBe("fail");
  });

  it("会社概要ページ自身は合格", () => {
    const checks = checkTrust(trustOf("<body>本文</body>", "https://example.com/about/"));
    expect(byId(checks, "trust-about")?.status).toBe("pass");
  });

  it("構造化データと画面の電話番号が食い違えば警告", () => {
    const ld = JSON.stringify({ "@type": "Organization", name: "サンプル株式会社", telephone: "03-9999-0000" });
    const html = `<head><script type="application/ld+json">${ld}</script></head><body>${FOOTER}</body>`;
    const c = byId(checkTrust(trustOf(html)), "company-info-consistency");
    expect(c?.status).toBe("warn");
    expect(c?.evidence).toContain("03-9999-0000");
    expect(c?.evidence).toContain("03-1234-5678");
  });

  it("サイト内の多数派と違う電話番号のページを見つける（併記は食い違いにしない）", () => {
    const a = { phones: ["0312345678"], orgNames: ["サンプル"], postalCodes: ["100-0001"] };
    const b = { phones: ["0312345678", "0120111222"], orgNames: ["サンプル"], postalCodes: ["100-0001"] };
    const old = { phones: ["0311112222"], orgNames: ["サンプル"], postalCodes: ["100-0001"] };
    const majority = factMajority([a, b, a, old]);
    expect(majority.phones).toBe("0312345678");
    expect(siteFactMismatches(b, majority)).toEqual([]);
    expect(siteFactMismatches(old, majority)).toEqual([
      { kind: "phones", page: ["0311112222"], expected: "0312345678" },
    ]);
  });

  it("1 ページにしか無い値は基準にしない", () => {
    expect(factMajority([{ phones: ["0312345678"], orgNames: [], postalCodes: [] }])).toEqual({});
  });
});

describe("問い合わせ導線", () => {
  it("問い合わせページへのリンクがあれば合格", () => {
    const c = checkContact(trustOf('<body><a href="/contact/">お問い合わせ</a></body>'));
    expect(byId(c, "contact-link")?.status).toBe("pass");
  });

  it("問い合わせフォームも導線に数える。検索フォームは数えない", () => {
    const form = checkContact(trustOf('<body><form><input type="email"><textarea></textarea></form></body>'));
    expect(byId(form, "contact-link")?.status).toBe("pass");
    const search = checkContact(trustOf('<body><form role="search"><input type="text" name="s"></form></body>'));
    expect(byId(search, "contact-link")?.status).toBe("fail");
  });

  it("電話番号が tel: リンクになっていなければ警告", () => {
    const plain = checkContact(trustOf("<body><p>TEL 03-1234-5678</p></body>"));
    expect(byId(plain, "contact-tel-link")?.status).toBe("warn");
    const linked = checkContact(trustOf('<body><a href="tel:0312345678">03-1234-5678</a></body>'));
    expect(byId(linked, "contact-tel-link")?.status).toBe("pass");
    expect(byId(linked, "contact-link")?.status).toBe("pass");
  });

  it("日付や金額を電話番号と取り違えない", () => {
    const c = checkContact(trustOf("<body><p>2026-09-06 に 1,000-2,000 円で公開</p></body>"));
    expect(byId(c, "contact-tel-link")?.label).toContain("対象外");
  });
});

describe("表示速度", () => {
  const $ = cheerio.load(
    '<head><script src="/a.js"></script><script src="/b.js" defer></script></head><body><img src="/x.png" width="10" height="10"></body>',
  );

  it("応答時間を 0.8 秒 / 1.8 秒で区切る", () => {
    const status = (ttfbMs: number) =>
      byId(checkPerformance($, { ttfbMs, totalMs: ttfbMs + 100, bytes: 1000 }), "response-time")?.status;
    expect(status(800)).toBe("pass");
    expect(status(801)).toBe("warn");
    expect(status(1800)).toBe("warn");
    expect(status(1801)).toBe("fail");
  });

  it("計測できなかったときは情報（0 秒とみなさない）", () => {
    const c = byId(checkPerformance($, undefined), "response-time");
    expect(c?.status).toBe("info");
    expect(c?.weight).toBe(0);
  });

  it("async / defer の無い head のスクリプトだけを数える", () => {
    const c = byId(checkPerformance($, { ttfbMs: 100, totalMs: 200, bytes: 1000 }), "render-blocking-scripts");
    expect(c?.evidence).toContain("1 個");
  });
});

describe("セキュリティ・モバイル", () => {
  it("http 配信は重大、https のページの http スクリプトも重大", () => {
    const $ = cheerio.load('<body><script src="http://cdn.example.com/a.js"></script></body>');
    expect(byId(checkSecurity($, new URL("http://example.com/"), new Headers()), "https")?.status).toBe("fail");
    const secure = checkSecurity($, new URL("https://example.com/"), new Headers());
    expect(byId(secure, "https")?.status).toBe("pass");
    expect(byId(secure, "mixed-content")?.status).toBe("fail");
  });

  it("viewport の有無と拡大禁止", () => {
    const ok = checkMobile(cheerio.load('<meta name="viewport" content="width=device-width, initial-scale=1">'));
    expect(byId(ok, "viewport")?.status).toBe("pass");
    expect(byId(ok, "zoom-enabled")?.status).toBe("pass");
    const locked = checkMobile(
      cheerio.load('<meta name="viewport" content="width=device-width, maximum-scale=1, user-scalable=no">'),
    );
    expect(byId(locked, "zoom-enabled")?.status).toBe("warn");
    expect(byId(checkMobile(cheerio.load("<p>x</p>")), "viewport")?.status).toBe("fail");
  });
});

describe("サイト全体での会社情報の一致", () => {
  const files: SiteFiles = {
    origin: "https://example.com",
    robotsTxt: "User-agent: *\nAllow: /\n",
    sitemaps: [],
    llmsTxt: { present: false, length: 0, status: 404 },
    llmsFullTxt: { present: false, length: 0 },
  };
  const page = (body: string, url: string): FetchedText => ({
    ok: true,
    status: 200,
    finalUrl: url,
    contentType: "text/html",
    body: `<html lang="ja"><head><title>t</title></head><body>${body}</body></html>`,
    headers: new Headers(),
    timing: { ttfbMs: 100, totalMs: 200, bytes: body.length },
  });

  it("多数派と違う番号のページだけを警告にし、スコアを組み直す", () => {
    const good = analyzeFetched(page(FOOTER, "https://example.com/"), files);
    const stale = analyzeFetched(page(FOOTER.replace("03-1234-5678", "03-1111-2222"), "https://example.com/old"), files);
    const majority = factMajority([good.facts!, good.facts!, stale.facts!]);
    const fixed = withSiteConsistency(stale, majority);
    const c = fixed.categories.flatMap((x) => x.checks).find((x) => x.id === "company-info-consistency");
    expect(c?.status).toBe("warn");
    expect(c?.evidence).toContain("03-1111-2222");
    expect(fixed.categories.find((x) => x.id === "trust")!.score).toBeLessThan(
      stale.categories.find((x) => x.id === "trust")!.score,
    );
    expect(withSiteConsistency(good, majority)).toBe(good);
  });
});
