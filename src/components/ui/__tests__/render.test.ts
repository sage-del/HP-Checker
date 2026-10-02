import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Callout } from "../Callout";
import { DataTable, type Column } from "../DataTable";
import { Field, Input } from "../Field";
import { ProgressBar } from "../ProgressBar";
import { StatStrip } from "../StatStrip";

describe("Badge", () => {
  it("判定ピルは枠線 + アイコン + 文言", () => {
    const html = renderToStaticMarkup(createElement(Badge, { tone: "warn" }));
    expect(html).toContain("border-warn");
    expect(html).toContain("bg-warn-soft");
    expect(html).toContain("<svg");
    expect(html).toContain("警告");
  });
  it("文言は差し替えられる", () => {
    expect(renderToStaticMarkup(createElement(Badge, { tone: "pass" }, "対応済み"))).toContain("対応済み");
  });
});

describe("Button / Callout / Field / ProgressBar / Stat", () => {
  it("Button の variant と loading", () => {
    const html = renderToStaticMarkup(createElement(Button, { variant: "secondary", loading: true }, "中止"));
    expect(html).toContain("border-line");
    expect(html).toContain("disabled");
    expect(html).toContain("aria-busy");
    expect(html).toContain("animate-spin");
  });
  it("Callout", () => {
    expect(renderToStaticMarkup(createElement(Callout, { tone: "fail", title: "失敗" }, "詳細"))).toContain('role="alert"');
  });
  it("Field は label の for と error", () => {
    // FieldProps は children を必須にしているため、createElement の第 3 引数ではなく
    // props に入れる（第 3 引数は React 19 の型では必須 children を満たさない）
    const html = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(Field, {
        label: "URL",
        htmlFor: "u",
        error: "必須です",
        children: createElement(Input, { id: "u", invalid: true }),
      }),
    );
    expect(html).toContain('for="u"');
    expect(html).toContain("border-fail");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("必須です");
  });
  it("ProgressBar", () => {
    const html = renderToStaticMarkup(createElement(ProgressBar, { value: 12, max: 128, label: "12 / 128 ページ" }));
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain("width:9.375%");
    expect(renderToStaticMarkup(createElement(ProgressBar, { indeterminate: true }))).toContain("progress-indeterminate");
  });
  it("StatStrip", () => {
    const strip = renderToStaticMarkup(createElement(StatStrip, { items: [{ label: "診断項目", value: 24 }, { label: "合格", value: 12 }] }));
    expect(strip).toContain("grid-cols-2");
  });
});

describe("DataTable", () => {
  interface Row {
    kw: string;
    rank: number | null;
  }
  const columns: Column<Row>[] = [
    { key: "kw", header: "キーワード", accessor: (r) => r.kw },
    { key: "rank", header: "順位", accessor: (r) => r.rank, align: "right" },
  ];
  const rows: Row[] = [
    { kw: "b", rank: 3 },
    { kw: "a", rank: null },
    { kw: "c", rank: 1 },
  ];
  it("渡された順のまま出し、accessor の値をセルに書く（null は空欄）", () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Row>, { rows, columns, rowKey: (r) => r.kw }),
    );
    const order = [...html.matchAll(/<td[^>]*>([abc])<\/td>/g)].map((m) => m[1]);
    expect(order).toEqual(["b", "a", "c"]);
    // accessor が null を返した 1 セルだけが空になる
    expect(html.match(/<td[^>]*><\/td>/g) ?? []).toHaveLength(1);
    expect(html).toContain("overflow-x-auto");
  });
  it("空のとき emptyText", () => {
    const html = renderToStaticMarkup(createElement(DataTable<Row>, { rows: [], columns, rowKey: (r) => r.kw }));
    expect(html).toContain("表示できるデータがありません");
  });
});
