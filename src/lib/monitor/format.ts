/**
 * 監視画面の日時表示。サーバー（Vercel は UTC）で描くので、必ず日本時間に揃える。
 */
const JST = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(d: Date): Record<string, string> {
  return Object.fromEntries(JST.formatToParts(d).map((p) => [p.type, p.value]));
}

/** 「2026年10月2日 03:00」（日本時間） */
export function formatJst(d: Date): string {
  const p = partsOf(d);
  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

/** 「10/2」（日本時間。グラフの目盛用） */
export function formatJstShort(d: Date): string {
  const p = partsOf(d);
  return `${p.month}/${p.day}`;
}

/** 「たった今」「3 時間前」「5 日前」 */
export function formatAgo(d: Date, now: Date = new Date()): string {
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min} 分前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 時間前`;
  return `${Math.floor(hours / 24)} 日前`;
}
