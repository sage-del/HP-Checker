/**
 * 診断結果から「ツール内の通知」を作る純関数。
 *
 * 通知が多すぎると誰も見なくなるので、前回から悪くなったときだけを重く扱う。
 * - critical … 診断できなくなった / 重大な問題が新たに出た / 新たなリンク切れ
 * - warning  … 総合スコアが SCORE_DROP_ALERT 点以上下がった / 警告が新たに出た
 * - info     … 初回の診断 / 診断が再開できた / 問題が解消した
 * 変化が無ければ通知は 0 件。
 */
import { compareSnapshots, type DiagnosisSnapshot } from "@/lib/report/history";

export type AlertSeverity = "critical" | "warning" | "info";

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "重大",
  warning: "警告",
  info: "お知らせ",
};

export interface AlertDraft {
  severity: AlertSeverity;
  title: string;
  /** 箇条書きの中身（上限 MAX_DETAILS 行。超えた分は「ほか N 件」にまとめる） */
  details: string[];
}

/** 総合スコアがこの点数以上下がったら知らせる */
export const SCORE_DROP_ALERT = 5;
/** 総合スコアがこの点数以上上がったら知らせる */
export const SCORE_RISE_ALERT = 5;
const MAX_DETAILS = 10;

export type RunOutcome =
  | { status: "success"; snapshot: DiagnosisSnapshot }
  | { status: "error"; error: string };

export interface AlertInput {
  /** 直前の診断の結果（無ければ初回） */
  previousStatus: "success" | "error" | null;
  /** 直前の「成功した」診断の要約（比較の基準） */
  previous: DiagnosisSnapshot | null;
  current: RunOutcome;
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_DETAILS) return lines;
  return [...lines.slice(0, MAX_DETAILS - 1), `ほか ${lines.length - (MAX_DETAILS - 1)} 件`];
}

export function deriveAlerts({ previousStatus, previous, current }: AlertInput): AlertDraft[] {
  if (current.status === "error") {
    // 続けて失敗しているときは毎回は知らせない（一覧の状態表示で分かる）
    if (previousStatus === "error") return [];
    return [{ severity: "critical", title: "サイトを診断できませんでした", details: [current.error] }];
  }

  const now = current.snapshot;
  const alerts: AlertDraft[] = [];

  if (previousStatus === "error") {
    alerts.push({ severity: "info", title: "診断が再開できました", details: [`総合スコア ${now.overall} 点`] });
  }

  const brokenNow = now.brokenLinks ?? [];
  if (!previous) {
    if (previousStatus !== "error") {
      alerts.push({
        severity: "info",
        title: `初回の診断が完了しました（総合 ${now.overall} 点）`,
        details: [`重大 ${now.counts.fail} 件・警告 ${now.counts.warn} 件`, `診断ページ数 ${now.pageCount}`],
      });
    }
    if (brokenNow.length > 0) {
      alerts.push({ severity: "critical", title: `リンク切れが ${brokenNow.length} 件あります`, details: capped(brokenNow) });
    }
    return alerts;
  }

  const diff = compareSnapshots(previous, now);
  const newFails = [...diff.appeared, ...diff.changed].filter((c) => c.after === "fail");
  const newWarns = diff.appeared.filter((c) => c.after === "warn");

  if (newFails.length > 0) {
    alerts.push({
      severity: "critical",
      title: `重大な問題が新たに ${newFails.length} 件見つかりました`,
      details: capped(newFails.map((c) => c.label)),
    });
  }

  const brokenBefore = new Set(previous.brokenLinks ?? []);
  const newBroken = brokenNow.filter((url) => !brokenBefore.has(url));
  if (newBroken.length > 0) {
    alerts.push({
      severity: "critical",
      title: `リンク切れが新たに ${newBroken.length} 件見つかりました`,
      details: capped(newBroken),
    });
  }

  if (diff.overall.delta <= -SCORE_DROP_ALERT) {
    const worse = diff.categories
      .filter((c) => c.delta !== null && c.delta < 0)
      .sort((a, b) => a.delta! - b.delta!)
      .map((c) => `${c.label} ${c.before} → ${c.after} 点`);
    alerts.push({
      severity: "warning",
      title: `総合スコアが ${diff.overall.before} → ${diff.overall.after} 点に下がりました`,
      details: capped(worse),
    });
  }

  if (newWarns.length > 0) {
    alerts.push({
      severity: "warning",
      title: `警告が新たに ${newWarns.length} 件見つかりました`,
      details: capped(newWarns.map((c) => c.label)),
    });
  }

  const fixedLinks = [...brokenBefore].filter((url) => !brokenNow.includes(url)).length;
  const good: string[] = [];
  if (diff.resolved.length > 0) good.push(...diff.resolved.map((c) => `解消: ${c.label}`));
  if (previous.brokenLinks && fixedLinks > 0) good.push(`リンク切れ ${fixedLinks} 件が直りました`);
  if (diff.overall.delta >= SCORE_RISE_ALERT) {
    alerts.push({
      severity: "info",
      title: `総合スコアが ${diff.overall.before} → ${diff.overall.after} 点に上がりました`,
      details: capped(good),
    });
  } else if (good.length > 0) {
    alerts.push({ severity: "info", title: `${good.length} 件の問題が解消しました`, details: capped(good) });
  }

  return alerts;
}
