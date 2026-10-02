import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageTitle, Section } from "@/components/monitor/parts";
import { Badge } from "@/components/ui";
import { resolveMaxPages } from "@/lib/crawl/crawler";
import { MAX_LINK_CHECKS } from "@/lib/links/check";
import { SCORE_DROP_ALERT } from "@/lib/monitor/alerts";
import { getDb, isMonitorConfigured } from "@/lib/monitor/db";
import { describeCronJst } from "@/lib/monitor/schedule";
import { KEEP_FULL_RESULTS, KEEP_RUNS, listSites } from "@/lib/monitor/store";
import pkg from "../../../package.json";
import vercel from "../../../vercel.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "設定" };

/** 保存先に実際につながるか（つながらなければ理由を返す） */
async function checkDatabase(): Promise<{ ok: true; sites: number } | { ok: false; error: string }> {
  try {
    return { ok: true, sites: (await listSites(await getDb())).length };
  } catch (err) {
    console.error("[settings] database check failed", err);
    return { ok: false, error: "保存先に接続できませんでした。DATABASE_URL の値と、データベースが起動しているかを確認してください" };
  }
}

function Row({ label, status, children }: { label: string; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[12rem_1fr]">
      <div className="flex items-center gap-2 text-[13px] font-bold text-ink">{label}</div>
      <div className="text-[13px] text-ink">
        {status && <div className="mb-1">{status}</div>}
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}

const env = (name: string) => <code className="rounded bg-surface px-1 py-0.5 text-[12px] text-ink">{name}</code>;

/**
 * 設定の確認画面。環境変数は「設定済みか」だけを出し、値（パスワード・接続文字列）は出さない。
 * 値の変更は Vercel の環境変数で行う（README の「定期監視」）。
 */
export default async function SettingsPage() {
  const monitor = isMonitorConfigured();
  const db = monitor ? await checkDatabase() : null;
  const auth = Boolean(process.env.BASIC_AUTH_PASSWORD);
  const cronSecret = Boolean(process.env.CRON_SECRET);
  const schedule = vercel.crons?.[0]?.schedule;
  const contact = process.env.NEXT_PUBLIC_CONTACT_NAME || process.env.NEXT_PUBLIC_CONTACT_URL;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle
        title="設定"
        lead="このツールの設定の状態です。値の変更は Vercel の環境変数で行い、再デプロイすると反映されます（パスワードなどの値はここには表示しません）。"
      />

      <Section title="定期監視">
        <div className="rounded-xl border border-line bg-panel">
          <Row
            label="保存先（データベース）"
            status={
              !monitor ? (
                <Badge tone="warn">未設定</Badge>
              ) : db?.ok ? (
                <Badge tone="pass">接続できています</Badge>
              ) : (
                <Badge tone="fail">接続できません</Badge>
              )
            }
          >
            {!monitor
              ? <>{env("DATABASE_URL")} に Postgres の接続文字列を設定すると、定期監視が使えるようになります。</>
              : db?.ok
                ? `監視サイト ${db.sites} 件を登録しています。`
                : db?.error}
          </Row>
          <Row label="定期診断の時刻" status={schedule ? <Badge tone="info">{describeCronJst(schedule)}</Badge> : <Badge tone="warn">未設定</Badge>}>
            vercel.json の Cron で決めています。期限の来たサイトを、最後の診断が古い順に診断します。
          </Row>
          <Row label="Cron の合言葉" status={cronSecret ? <Badge tone="pass">設定済み</Badge> : <Badge tone="fail">未設定</Badge>}>
            {env("CRON_SECRET")}。未設定のままだと本番では定期診断が動きません。
          </Row>
          <Row label="通知の条件">
            診断できなくなった・重大な問題やリンク切れが新たに出た（重大）、総合スコアが {SCORE_DROP_ALERT} 点以上下がった・警告が新たに出た（警告）、改善・復旧した（お知らせ）。
          </Row>
          <Row label="記録の保存期間">
            レポート本体はサイトごとに直近 {KEEP_FULL_RESULTS} 回分、スコアの推移に使う要約は {KEEP_RUNS} 回分まで残します。
          </Row>
        </div>
      </Section>

      <Section title="アクセス制限">
        <div className="rounded-xl border border-line bg-panel">
          <Row label="ログイン（Basic 認証）" status={auth ? <Badge tone="pass">有効</Badge> : <Badge tone={monitor ? "fail" : "warn"}>無効</Badge>}>
            {auth ? (
              <>サイト全体にログインが必要です（ユーザー名 {env(process.env.BASIC_AUTH_USER || "admin")}）。</>
            ) : (
              <>
                {env("BASIC_AUTH_PASSWORD")} を設定するとサイト全体にログインが必要になります。
                {monitor && "定期監視を使うときは必須です（未設定だと本番では監視の画面が開けません）。"}
              </>
            )}
          </Row>
        </div>
      </Section>

      <Section title="診断">
        <div className="rounded-xl border border-line bg-panel">
          <Row label="1 回で見るページ数">最大 {resolveMaxPages()} ページ（{env("SITE_MAX_PAGES")} で 100 以下に変更できます）。</Row>
          <Row label="リンク切れの確認">同じサイト内の参照先を 1 回あたり最大 {MAX_LINK_CHECKS} 件（定期監視の診断のみ）。</Row>
          <Row label="レポート末尾の連絡先" status={contact ? <Badge tone="pass">設定済み</Badge> : <Badge tone="info">なし</Badge>}>
            {env("NEXT_PUBLIC_CONTACT_NAME")} / {env("NEXT_PUBLIC_CONTACT_URL")}
          </Row>
          <Row label="バージョン">v{process.env.NEXT_PUBLIC_APP_VERSION || pkg.version}</Row>
        </div>
      </Section>
    </main>
  );
}
