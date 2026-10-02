"use client";

/**
 * 診断フォーム（no-print）。レポートのシートとは独立したブロックとして上に置く。
 * ヘッダー 1 カラムのレイアウトなので、ここが実質のヒーロー（最初に読む面）になる。
 * 診断の範囲はサイト全体（全ページ）に固定したので、入力するのは URL だけ。
 */
import type { FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/** 「何が返ってくるか」を先に示す 3 点。入力前の不安を減らすためのもの */
const PROMISES = ["総合スコアと A〜E グレード", "項目ごとの判定と改善提案", "報告書を PDF でダウンロード"];

export function DiagnosisForm({
  url,
  onUrlChange,
  onSubmit,
  busy,
  error,
}: {
  url: string;
  onUrlChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  error?: string | null;
}) {
  return (
    <section className="no-print mb-8">
      <div className="pt-8 pb-6 text-center sm:pt-12">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-ink sm:text-[34px]">
          URL を入れるだけ。
          <span className="block text-accent">サイト全体を無料診断</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
          {BRAND.description}
        </p>
        <ul className="mt-4 flex flex-wrap justify-center gap-x-2 gap-y-2 text-[12px] font-bold text-muted">
          {PROMISES.map((p) => (
            <li key={p} className="rounded-full border border-line bg-panel px-3 py-1">
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6">
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="診断する URL"
            htmlFor="url"
            hint="sitemap と内部リンクから全ページを収集し、サイト全体を診断します"
            error={error}
          >
            <Input
              id="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://example.com/"
              value={url}
              invalid={Boolean(error)}
              onChange={(e) => onUrlChange(e.target.value)}
            />
          </Field>

          <Button type="submit" size="lg" loading={busy} className="mt-4 w-full">
            無料で診断する
          </Button>
        </form>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">
          採点はすべてルールベース（生成 AI 不使用）のため無料です。
        </p>
      </div>

    </section>
  );
}
