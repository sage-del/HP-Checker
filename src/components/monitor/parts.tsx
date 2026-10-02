/**
 * 監視画面の共通部品（サーバーコンポーネント）。
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { markAlertReadAction } from "@/app/monitor/actions";
import { Badge, Callout } from "@/components/ui";
import type { LinkCheckResult, LinkKind } from "@/lib/links/types";
import type { AlertSeverity } from "@/lib/monitor/alerts";
import { SEVERITY_LABEL } from "@/lib/monitor/alerts";
import { formatAgo, formatJst } from "@/lib/monitor/format";
import type { MonitorAlert, RunSummary } from "@/lib/monitor/store";
import { pathOf } from "@/lib/report/format";
import { scoreTone, TONE_CLASSES, type StatusTone } from "@/lib/ui/palette";

const SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  critical: "fail",
  warning: "warn",
  info: "info",
};

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

export function RunStatusBadge({ run }: { run: RunSummary | null }) {
  if (!run) return <span className="text-[12px] text-muted">未診断</span>;
  return run.status === "success" ? <Badge tone="pass">診断済み</Badge> : <Badge tone="fail">診断できず</Badge>;
}

/** 総合スコア（判定色）と前回からの増減 */
export function ScoreWithDelta({ score, previous, size = "lg" }: { score: number | null; previous: number | null; size?: "lg" | "md" }) {
  if (score === null) return <span className="text-2xl font-bold text-muted">-</span>;
  const delta = previous === null ? null : score - previous;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`${size === "lg" ? "text-3xl" : "text-xl"} font-bold tabular-nums ${TONE_CLASSES[scoreTone(score)].text}`}>
        {score}
        <span className="ml-0.5 text-[12px] font-bold text-muted">点</span>
      </span>
      {delta !== null && delta !== 0 && (
        <span className={`text-[12px] font-bold tabular-nums ${delta > 0 ? "text-pass" : "text-fail"}`}>
          {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
        </span>
      )}
      {delta === 0 && <span className="text-[12px] text-muted">± 0</span>}
    </span>
  );
}

export function PageTitle({ title, lead, back, actions }: { title: ReactNode; lead?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="text-[13px] font-bold text-accent hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">{title}</h1>
          {lead && <p className="mt-1 break-all text-[13px] text-muted">{lead}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function NotConfigured() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle title="定期監視" lead="監視サイト・リンク切れ・診断履歴・通知の画面は、保存先を設定すると使えます。" />
      <Callout tone="info" title="監視機能はまだ設定されていません">
        <p>
          診断結果を保存する Postgres の接続文字列を環境変数 <code>DATABASE_URL</code> に設定すると使えるようになります。
          設定の状態はサイドバーの「設定」で確認できます。手順は README の「定期監視」を見てください。
        </p>
      </Callout>
    </main>
  );
}

const KIND_LABEL: Record<LinkKind, string> = {
  link: "リンク",
  image: "画像",
  stylesheet: "CSS",
  script: "JavaScript",
};

function statusLabel(status: number): string {
  return status === 0 ? "接続できず" : `HTTP ${status}`;
}

/** リンク切れの一覧 */
export function BrokenLinksTable({ links }: { links: LinkCheckResult | undefined }) {
  if (!links) return <p className="text-[13px] text-muted">この回はリンク切れを確かめていません。</p>;
  if (links.broken.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        リンク切れはありません（サイト内の参照先 {links.checked.toLocaleString("ja-JP")} 件を確認
        {links.unchecked > 0 ? `・未確認 ${links.unchecked.toLocaleString("ja-JP")} 件` : ""}）。
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full min-w-[34rem] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-muted">
            <th className="px-3 py-2 font-bold">参照先</th>
            <th className="px-3 py-2 font-bold">種類</th>
            <th className="px-3 py-2 font-bold">状態</th>
            <th className="px-3 py-2 font-bold">参照元のページ</th>
          </tr>
        </thead>
        <tbody>
          {links.broken.map((b) => (
            <tr key={b.url} className="border-b border-line align-top last:border-0">
              <td className="break-all px-3 py-2 font-bold text-ink">{pathOf(b.url)}</td>
              <td className="whitespace-nowrap px-3 py-2">{KIND_LABEL[b.kind]}</td>
              <td className="whitespace-nowrap px-3 py-2 font-bold text-fail">{statusLabel(b.status)}</td>
              <td className="px-3 py-2 text-muted">
                <ul className="space-y-0.5">
                  {b.sources.map((s) => (
                    <li key={s} className="break-all">
                      {pathOf(s)}
                    </li>
                  ))}
                  {b.sourceCount > b.sources.length && <li>ほか {b.sourceCount - b.sources.length} ページ</li>}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 通知の一覧。未読には「既読にする」を付ける */
export function AlertList({ alerts, showSite = true, empty = "通知はありません。" }: { alerts: readonly MonitorAlert[]; showSite?: boolean; empty?: string }) {
  if (alerts.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  const now = new Date();
  return (
    <ul className="space-y-3">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={`rounded-xl border bg-panel p-4 ${a.readAt ? "border-line" : "border-l-4 border-line"} ${
            a.readAt ? "" : a.severity === "critical" ? "border-l-fail" : a.severity === "warning" ? "border-l-warn" : "border-l-info"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={a.severity} />
            {showSite && (
              <Link href={`/monitor/sites/${a.siteId}`} className="text-[13px] font-bold text-accent hover:underline">
                {a.siteName}
              </Link>
            )}
            <span className="text-[12px] text-muted" title={formatJst(a.createdAt)}>
              {formatAgo(a.createdAt, now)}
            </span>
            {!a.readAt && <span className="text-[11px] font-bold text-fail">未読</span>}
          </div>
          <p className={`mt-2 text-sm ${a.readAt ? "text-muted" : "font-bold text-ink"}`}>{a.title}</p>
          {a.details.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
              {a.details.map((d, i) => (
                <li key={i} className="break-all">
                  {d}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
            {a.runId !== null && (
              <Link href={`/monitor/runs/${a.runId}`} className="font-bold text-accent hover:underline">
                この回のレポート
              </Link>
            )}
            {!a.readAt && (
              <form action={markAlertReadAction}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="font-bold text-muted hover:text-ink hover:underline">
                  既読にする
                </button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusTone;
  href?: string;
}

/** ダッシュボード上部の集計カード */
export function StatCards({ items }: { items: readonly StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => {
        const body = (
          <>
            <p className="text-[12px] font-bold text-muted">{item.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${item.tone ? TONE_CLASSES[item.tone].text : "text-ink"}`}>{item.value}</p>
            {item.hint && <p className="mt-0.5 text-[12px] text-muted">{item.hint}</p>}
          </>
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className="rounded-xl border border-line bg-panel p-4 hover:border-accent">
            {body}
          </Link>
        ) : (
          <div key={item.label} className="rounded-xl border border-line bg-panel p-4">
            {body}
          </div>
        );
      })}
    </div>
  );
}
