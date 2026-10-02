/**
 * 定期診断の「いつ診断するか」を決める純関数。
 *
 * Vercel Cron は 1 日 1 回（または 1 時間ごと）に /api/cron/monitor を呼ぶだけで、
 * どのサイトを診断するかはここで決める。呼び出し時刻は数分ずれるので、
 * 間隔ちょうどではなく少し手前（SLACK_MS）から「期限が来た」とみなす。
 */
export type Frequency = "daily" | "weekly";

export const FREQUENCIES: readonly Frequency[] = ["daily", "weekly"];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "毎日",
  weekly: "毎週",
};

const HOUR = 60 * 60 * 1000;
const INTERVAL_MS: Record<Frequency, number> = {
  daily: 24 * HOUR,
  weekly: 7 * 24 * HOUR,
};
/** Cron の呼び出し時刻のずれを吸収する余裕 */
const SLACK_MS = 2 * HOUR;

export function isFrequency(value: unknown): value is Frequency {
  return value === "daily" || value === "weekly";
}

export interface ScheduledSite {
  enabled: boolean;
  frequency: Frequency;
  lastRunAt: Date | null;
}

/** 今、定期診断の期限が来ているか */
export function isDue(site: ScheduledSite, now: Date): boolean {
  if (!site.enabled) return false;
  if (!site.lastRunAt) return true;
  return now.getTime() - site.lastRunAt.getTime() >= INTERVAL_MS[site.frequency] - SLACK_MS;
}

/**
 * 期限の来たサイトを、最後の診断が古い順に返す（未診断が先頭）。
 * 1 回の Cron で全部を診断しきれなかったときに、次の回で取り残されたサイトから始めるため。
 */
export function dueSites<T extends ScheduledSite>(sites: readonly T[], now: Date): T[] {
  return sites
    .filter((s) => isDue(s, now))
    .sort((a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0));
}
