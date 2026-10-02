/**
 * レポート表示用の整形（純関数）。
 */

/** URL → パス。トップは「/（トップ）」。URL として読めなければそのまま返す */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}`;
    return p === "/" ? "/（トップ）" : p;
  } catch {
    return url;
  }
}

/** URL → ホスト名（先頭の www. を除く）。読めなければ入力をそのまま返す */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** 数値を「1,234」形式に */
export function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("ja-JP") : "-";
}

function parts(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 日時 → 「2026年9月6日 14:05」 */
export function formatDateTime(iso: string): string {
  const d = parts(iso);
  if (!d) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 日時 → 「2026年9月6日 14:05:33」（付録の診断日時） */
export function formatDateTimeSeconds(iso: string): string {
  const d = parts(iso);
  if (!d) return iso;
  return `${formatDateTime(iso)}:${pad(d.getSeconds())}`;
}

/** ミリ秒 → 「12.3 秒」「2 分 5 秒」 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const sec = ms / 1000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} 秒`;
  const min = Math.floor(sec / 60);
  const rest = Math.round(sec - min * 60);
  return rest === 0 ? `${min} 分` : `${min} 分 ${rest} 秒`;
}

/** 経過時間の時計表示「0:42」「12:05」（進捗パネル用） */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${pad(sec)}`;
}

/** 長い URL を中央省略する（進捗パネルの「現在の URL」用） */
export function truncateMiddle(text: string, max = 64): string {
  if (text.length <= max) return text;
  const keep = Math.max(4, Math.floor((max - 1) / 2));
  return `${text.slice(0, keep)}…${text.slice(text.length - (max - 1 - keep))}`;
}

/**
 * PDF のファイル名（「PDFでダウンロード」で保存されるときの名前）。
 *
 * 日本語を含めると、ブラウザによっては <a download> の名前が捨てられて
 * "download" というファイルになってしまうため、ASCII だけで組み立てる。
 * 例: aio-report-site_example.com_20260906
 */
export function reportFileName(target: string, at: string): string {
  let host = target;
  try {
    host = new URL(target).hostname || target;
  } catch {
    // URL として解釈できないときは入力値をそのまま使う
  }
  const safeHost = host.replace(/[^\w.-]/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "site";
  const d = new Date(at);
  const stamp = Number.isNaN(d.getTime())
    ? ""
    : `_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `aio-report-site_${safeHost}${stamp}`;
}
