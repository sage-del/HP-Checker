/**
 * 監視機能の保存先（PostgreSQL）。
 *
 * 接続先は DATABASE_URL（Neon / Supabase / Vercel Postgres など、ふつうの Postgres の
 * 接続文字列ならどれでもよい）。未設定なら監視機能そのものを出さない。
 *
 * SQL は `Db` の 2 つの口だけで発行する。本番は postgres（porsager/postgres）、
 * テストは PGlite（WASM の Postgres）を同じ口に差し込んで、同じ SQL を検証する。
 */
import postgres from "postgres";

export interface Db {
  /** パラメータ付きの 1 文を実行して行を返す（$1, $2 … で値を渡す） */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** パラメータ無しの複数文を実行する（マイグレーション用） */
  exec(text: string): Promise<void>;
}

/** 監視機能が使えるか（保存先が設定されているか） */
export function isMonitorConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

const SCHEMA = `
create table if not exists monitor_sites (
  id integer generated always as identity primary key,
  url text not null unique,
  name text not null,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_run_at timestamptz
);

create table if not exists monitor_runs (
  id integer generated always as identity primary key,
  site_id integer not null references monitor_sites(id) on delete cascade,
  trigger text not null check (trigger in ('schedule', 'manual')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('success', 'error')),
  error text,
  overall integer,
  page_count integer,
  broken_count integer,
  snapshot jsonb,
  result jsonb
);
create index if not exists monitor_runs_site_idx on monitor_runs (site_id, started_at desc);

create table if not exists monitor_alerts (
  id integer generated always as identity primary key,
  site_id integer not null references monitor_sites(id) on delete cascade,
  run_id integer references monitor_runs(id) on delete cascade,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists monitor_alerts_created_idx on monitor_alerts (created_at desc);

-- 初版は jsonb に JSON を文字列のまま二重に入れていた（store.ts の注記）。文字列になっている値を直す
update monitor_runs set snapshot = (snapshot #>> '{}')::jsonb where jsonb_typeof(snapshot) = 'string';
update monitor_runs set result = (result #>> '{}')::jsonb where jsonb_typeof(result) = 'string';
update monitor_alerts set details = (details #>> '{}')::jsonb where jsonb_typeof(details) = 'string';
`;

/** テーブルが無ければ作る（何度呼んでもよい） */
export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA);
}

interface DbHolder {
  promise?: Promise<Db>;
}

/** 接続を 1 つだけ作って使い回す（dev のホットリロードでも増えないよう globalThis に置く） */
export function getDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません");
  const holder = globalThis as unknown as { __monitor_db?: DbHolder };
  holder.__monitor_db ??= {};
  holder.__monitor_db.promise ??= (async () => {
    // prepare: false … Supabase / Neon の接続プール（pgbouncer の transaction モード）でも動くように
    const sql = postgres(url, { max: 3, prepare: false, idle_timeout: 20, onnotice: () => {} });
    const db: Db = {
      query: async <T,>(text: string, params: unknown[] = []) =>
        (await sql.unsafe(text, params as never[])) as unknown as T[],
      exec: async (text: string) => {
        await sql.unsafe(text);
      },
    };
    await migrate(db);
    return db;
  })().catch((err) => {
    // 接続に失敗したら次の呼び出しでやり直せるようにする
    holder.__monitor_db = {};
    throw err;
  });
  return holder.__monitor_db.promise;
}
