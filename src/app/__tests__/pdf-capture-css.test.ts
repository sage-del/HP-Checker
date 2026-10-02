/**
 * PDF 複製で字幅を変える OpenType 機能が無効になっていることを守るテスト。
 *
 * html2canvas-pro は「DOM で実測した各断片の位置」に ctx.fillText で描くが、
 * canvas の font 文字列には font-feature-settings と font-variant-numeric を
 * 渡せない（text-renderer.js の createFontStyle）。DOM 側だけ palt で字幅が
 * 詰まると、（ ） ・ 。 などの約物が次の文字に重なる。Hiragino Sans のように
 * palt を持つフォントでだけ起きるので、CI の環境では見た目では気づけない。
 * ここが消えると iOS / macOS で PDF が壊れるので、宣言の存在を固定する。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");

/** セレクタに対応する宣言ブロックの中身を取り出す（コメントは除去済みの前提） */
function ruleBody(selector: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return m[2];
  }
  return null;
}

describe("PDF 複製のフォント設定", () => {
  it("画面表示では palt を効かせている", () => {
    const body = ruleBody("body");
    expect(body).not.toBeNull();
    expect(body).toMatch(/font-feature-settings:\s*"palt"/);
  });

  it(".pdf-capture の中では字幅を変える機能を打ち消す", () => {
    // `.pdf-capture, .pdf-capture *` のどちらの側から引いても同じブロックを指す
    const body = ruleBody(".pdf-capture *");
    expect(body, ".pdf-capture * の規則が見つかりません").not.toBeNull();
    expect(body).toMatch(/font-feature-settings:\s*normal\s*!important/);
    expect(body).toMatch(/font-variant-numeric:\s*normal\s*!important/);
    // 子孫にも当てないと tabular-nums ユーティリティが残ってしまう
    expect(ruleBody(".pdf-capture")).not.toBeNull();
  });

  it("font-kerning は触らない（canvas 側も既定で有効なので、切ると逆にずれる）", () => {
    const body = ruleBody(".pdf-capture *") ?? "";
    expect(body).not.toMatch(/font-kerning/);
  });
});
