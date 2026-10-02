/**
 * 監視機能のデータの読み書き。SQL はすべてここに置く。
 *
 * 診断結果そのもの（SiteAnalysisResult、100 ページで 1 MB 近い）はサイトごとに
 * 直近 KEEP_FULL_RESULTS 回分だけ残し、それより古い回は要約（snapshot）だけにする。
 * 推移のグラフと前回比較は要約で足りるため。
 */
import type { SiteAnalysisResult } from "@/lib/analyzer/types";
import type { LinkCheckResult } from "@/lib/links/types";
import type { DiagnosisSnapshot } from "@/lib/report/history";
import type { AlertDraft, AlertSeverity } from "./alerts";
import type { Db } from "./db";
import type { Frequency } from "./schedule";

/** レポートを丸ごと残す回数（サイトごと） */
export const KEEP_FULL_RESULTS = 20;
/** 要約を残す回数（サイトごと）。毎日診断して 1 年強 */
export const KEEP_RUNS = 400;

export type RunTrigger = "schedule" | "manual";
export type RunStatus = "success" | "error";

export interface MonitorSite {
  id: number;
  url: string;
  name: string;
  frequency: Frequency;
  enabled: boolean;
  createdAt: Date;
  lastRunAt: Date | null;
}

export interface RunSummary {
  id: number;
  siteId: number;
  trigger: RunTrigger;
  startedAt: Date;
  finishedAt: Date;
  status: RunStatus;
  error: string | null;
  overall: number | null;
  pageCount: number | null;
  brokenCount: number | null;
  snapshot: DiagnosisSnapshot | null;
}

export interface RunDetail extends RunSummary {
  result: SiteAnalysisResult | null;
}

export interface SiteOverview extends MonitorSite {
  latest: RunSummary | null;
  /** 直前の成功した回の総合スコア（増減の表示用） */
  previousOverall: number | null;
  unreadAlerts: number;
}

export interface MonitorAlert {
  id: number;
  siteId: number;
  siteName: string;
  runId: number | null;
  severity: AlertSeverity;
  title: string;
  details: string[];
  createdAt: Date;
  readAt: Date | null;
}

// jsonb の値は JSON.stringify した文字列を `$n::text::jsonb` で渡す。`$n::jsonb` だと
// postgres（porsager/postgres）が文字列をもう一度 JSON にして、JSON の「文字列」として保存してしまう。

// ---------------------------------------------------------------------------
// 行 → 型
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toDateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : toDate(v));
const toNumOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const toJson = <T,>(v: unknown): T | null => {
  if (v === null || v === undefined) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
};

function siteFromRow(r: Row): MonitorSite {
  return {
    id: Number(r.id),
    url: String(r.url),
    name: String(r.name),
    frequency: r.frequency as Frequency,
    enabled: Boolean(r.enabled),
    createdAt: toDate(r.created_at),
    lastRunAt: toDateOrNull(r.last_run_at),
  };
}

function runFromRow(r: Row): RunSummary {
  return {
    id: Number(r.id),
    siteId: Number(r.site_id),
    trigger: r.trigger as RunTrigger,
    startedAt: toDate(r.started_at),
    finishedAt: toDate(r.finished_at),
    status: r.status as RunStatus,
    error: (r.error as string | null) ?? null,
    overall: toNumOrNull(r.overall),
    pageCount: toNumOrNull(r.page_count),
    brokenCount: toNumOrNull(r.broken_count),
    snapshot: toJson<DiagnosisSnapshot>(r.snapshot),
  };
}

function alertFromRow(r: Row): MonitorAlert {
  return {
    id: Number(r.id),
    siteId: Number(r.site_id),
    siteName: String(r.site_name ?? ""),
    runId: toNumOrNull(r.run_id),
    severity: r.severity as AlertSeverity,
    title: String(r.title),
    details: toJson<string[]>(r.details) ?? [],
    createdAt: toDate(r.created_at),
    readAt: toDateOrNull(r.read_at),
  };
}

const RUN_COLUMNS = `id, site_id, trigger, started_at, finished_at, status, error, overall, page_count, broken_count, snapshot`;

// ---------------------------------------------------------------------------
// サイト
// ---------------------------------------------------------------------------

export async function listSites(db: Db): Promise<MonitorSite[]> {
  const rows = await db.query(`select * from monitor_sites order by id`);
  return rows.map(siteFromRow);
}

export async function getSite(db: Db, id: number): Promise<MonitorSite | null> {
  const rows = await db.query(`select * from monitor_sites where id = $1`, [id]);
  return rows[0] ? siteFromRow(rows[0]) : null;
}

export class DuplicateSiteError extends Error {
  constructor() {
    super("この URL はすでに登録されています");
    this.name = "DuplicateSiteError";
  }
}

export async function addSite(
  db: Db,
  input: { url: string; name: string; frequency: Frequency },
): Promise<MonitorSite> {
  const rows = await db.query(
    `insert into monitor_sites (url, name, frequency) values ($1, $2, $3)
     on conflict (url) do nothing returning *`,
    [input.url, input.name, input.frequency],
  );
  if (!rows[0]) throw new DuplicateSiteError();
  return siteFromRow(rows[0]);
}

export async function updateSite(
  db: Db,
  id: number,
  patch: Partial<Pick<MonitorSite, "name" | "frequency" | "enabled">>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) sets.push(`name = $${params.push(patch.name)}`);
  if (patch.frequency !== undefined) sets.push(`frequency = $${params.push(patch.frequency)}`);
  if (patch.enabled !== undefined) sets.push(`enabled = $${params.push(patch.enabled)}`);
  if (sets.length === 0) return;
  params.push(id);
  await db.query(`update monitor_sites set ${sets.join(", ")} where id = $${params.length}`, params);
}

export async function deleteSite(db: Db, id: number): Promise<void> {
  await db.query(`delete from monitor_sites where id = $1`, [id]);
}

/** 一覧画面用: 各サイトの最新の診断・前回の総合スコア・未読の通知数 */
export async function listSiteOverviews(db: Db): Promise<SiteOverview[]> {
  const sites = await listSites(db);
  if (sites.length === 0) return [];
  const latest = await db.query(
    `select distinct on (site_id) ${RUN_COLUMNS} from monitor_runs order by site_id, started_at desc, id desc`,
  );
  const previous = await db.query(
    `select site_id, overall from (
       select site_id, overall, row_number() over (partition by site_id order by started_at desc, id desc) as n
       from monitor_runs where status = 'success'
     ) t where n = 2`,
  );
  const unread = await db.query(
    `select site_id, count(*)::int as n from monitor_alerts where read_at is null group by site_id`,
  );
  const latestBy = new Map(latest.map((r) => [Number(r.site_id), runFromRow(r)]));
  const prevBy = new Map(previous.map((r) => [Number(r.site_id), toNumOrNull(r.overall)]));
  const unreadBy = new Map(unread.map((r) => [Number(r.site_id), Number(r.n)]));
  return sites.map((s) => {
    const run = latestBy.get(s.id) ?? null;
    return {
      ...s,
      latest: run,
      // 最新が失敗なら、比べる相手は「最新の成功」ではなくそのまま空にする
      previousOverall: run?.status === "success" ? (prevBy.get(s.id) ?? null) : null,
      unreadAlerts: unreadBy.get(s.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// 診断の記録
// ---------------------------------------------------------------------------

export interface NewRun {
  siteId: number;
  trigger: RunTrigger;
  startedAt: Date;
  finishedAt: Date;
  status: RunStatus;
  error?: string | null;
  snapshot?: DiagnosisSnapshot | null;
  result?: SiteAnalysisResult | null;
}

/** 診断の記録を残し、サイトの最終診断日時を進め、古い記録を間引く。記録の id を返す */
export async function saveRun(db: Db, run: NewRun): Promise<number> {
  const result = run.result ?? null;
  const rows = await db.query<{ id: number }>(
    `insert into monitor_runs
       (site_id, trigger, started_at, finished_at, status, error, overall, page_count, broken_count, snapshot, result)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb)
     returning id`,
    [
      run.siteId,
      run.trigger,
      run.startedAt.toISOString(),
      run.finishedAt.toISOString(),
      run.status,
      run.error ?? null,
      result ? result.overall : null,
      result ? result.pages.length : null,
      result?.links ? result.links.broken.length : null,
      run.snapshot ? JSON.stringify(run.snapshot) : null,
      result ? JSON.stringify(result) : null,
    ],
  );
  await db.query(`update monitor_sites set last_run_at = $1 where id = $2`, [
    run.finishedAt.toISOString(),
    run.siteId,
  ]);
  await pruneRuns(db, run.siteId);
  return Number(rows[0].id);
}

async function pruneRuns(db: Db, siteId: number): Promise<void> {
  await db.query(
    `update monitor_runs set result = null
     where site_id = $1 and result is not null and id not in (
       select id from monitor_runs where site_id = $1 order by started_at desc, id desc limit $2
     )`,
    [siteId, KEEP_FULL_RESULTS],
  );
  await db.query(
    `delete from monitor_runs
     where site_id = $1 and id not in (
       select id from monitor_runs where site_id = $1 order by started_at desc, id desc limit $2
     )`,
    [siteId, KEEP_RUNS],
  );
}

/** サイトの診断の記録（新しい順。レポート本体は含めない） */
export async function listRuns(db: Db, siteId: number, limit = 60): Promise<RunSummary[]> {
  const rows = await db.query(
    `select ${RUN_COLUMNS} from monitor_runs where site_id = $1 order by started_at desc, id desc limit $2`,
    [siteId, limit],
  );
  return rows.map(runFromRow);
}

export interface RunWithSite extends RunSummary {
  siteName: string;
  siteUrl: string;
}

/** 全サイトの診断の記録（新しい順。レポート本体は含めない） */
export async function listRecentRuns(
  db: Db,
  options: { siteId?: number; status?: RunStatus; limit?: number } = {},
): Promise<RunWithSite[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.siteId !== undefined) where.push(`r.site_id = $${params.push(options.siteId)}`);
  if (options.status !== undefined) where.push(`r.status = $${params.push(options.status)}`);
  params.push(options.limit ?? 100);
  const rows = await db.query(
    `select ${RUN_COLUMNS.split(", ").map((c) => `r.${c}`).join(", ")}, s.name as site_name, s.url as site_url
     from monitor_runs r join monitor_sites s on s.id = r.site_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by r.started_at desc, r.id desc limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...runFromRow(r), siteName: String(r.site_name), siteUrl: String(r.site_url) }));
}

export interface SiteLinks {
  site: MonitorSite;
  /** リンク切れを確かめた最新の成功した回（無ければ null） */
  run: RunSummary | null;
  links: LinkCheckResult | null;
}

/** サイトごとの、最新の成功した回のリンク切れ（レポート本体の links だけを取り出す） */
export async function latestLinksBySite(db: Db): Promise<SiteLinks[]> {
  const sites = await listSites(db);
  const rows = await db.query(
    `select distinct on (site_id) ${RUN_COLUMNS}, result -> 'links' as links
     from monitor_runs where status = 'success' and result is not null
     order by site_id, started_at desc, id desc`,
  );
  const bySite = new Map(rows.map((r) => [Number(r.site_id), r]));
  return sites.map((site) => {
    const row = bySite.get(site.id);
    return {
      site,
      run: row ? runFromRow(row) : null,
      links: row ? toJson<LinkCheckResult>(row.links) : null,
    };
  });
}

export async function getRun(db: Db, id: number): Promise<RunDetail | null> {
  const rows = await db.query(`select ${RUN_COLUMNS}, result from monitor_runs where id = $1`, [id]);
  if (!rows[0]) return null;
  return { ...runFromRow(rows[0]), result: toJson<SiteAnalysisResult>(rows[0].result) };
}

/**
 * ある回の直前の記録（状態の比較用）と、直前の成功した回の要約（中身の比較用）。
 * `before` を省くと「これから診断する回」の直前、つまり最新の記録を見る。
 */
export async function previousRuns(
  db: Db,
  siteId: number,
  before?: { startedAt: Date; id: number },
): Promise<{ last: RunSummary | null; lastSuccess: RunSummary | null }> {
  const cond = before ? `and (started_at, id) < ($2, $3)` : "";
  const params: unknown[] = before ? [siteId, before.startedAt.toISOString(), before.id] : [siteId];
  const last = await db.query(
    `select ${RUN_COLUMNS} from monitor_runs where site_id = $1 ${cond} order by started_at desc, id desc limit 1`,
    params,
  );
  const lastSuccess = await db.query(
    `select ${RUN_COLUMNS} from monitor_runs where site_id = $1 and status = 'success' ${cond}
     order by started_at desc, id desc limit 1`,
    params,
  );
  return {
    last: last[0] ? runFromRow(last[0]) : null,
    lastSuccess: lastSuccess[0] ? runFromRow(lastSuccess[0]) : null,
  };
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

export async function addAlerts(db: Db, siteId: number, runId: number | null, alerts: readonly AlertDraft[]): Promise<void> {
  for (const a of alerts) {
    await db.query(
      `insert into monitor_alerts (site_id, run_id, severity, title, details) values ($1, $2, $3, $4, $5::text::jsonb)`,
      [siteId, runId, a.severity, a.title, JSON.stringify(a.details)],
    );
  }
}

export async function listAlerts(
  db: Db,
  options: { unreadOnly?: boolean; siteId?: number; limit?: number } = {},
): Promise<MonitorAlert[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.unreadOnly) where.push(`a.read_at is null`);
  if (options.siteId !== undefined) where.push(`a.site_id = $${params.push(options.siteId)}`);
  params.push(options.limit ?? 100);
  const rows = await db.query(
    `select a.*, s.name as site_name from monitor_alerts a join monitor_sites s on s.id = a.site_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by a.created_at desc, a.id desc limit $${params.length}`,
    params,
  );
  return rows.map(alertFromRow);
}

export async function countUnreadAlerts(db: Db): Promise<number> {
  const rows = await db.query<{ n: number }>(`select count(*)::int as n from monitor_alerts where read_at is null`);
  return Number(rows[0]?.n ?? 0);
}

export async function markAlertRead(db: Db, id: number): Promise<void> {
  await db.query(`update monitor_alerts set read_at = now() where id = $1 and read_at is null`, [id]);
}

export async function markAllAlertsRead(db: Db): Promise<void> {
  await db.query(`update monitor_alerts set read_at = now() where read_at is null`);
}
