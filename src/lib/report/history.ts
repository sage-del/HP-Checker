/**
 * 前回の診断との比較（再診断で何が変わったか）。
 *
 * 結果はサーバーに保存せず、診断した人のブラウザ（localStorage）にサイトごとに
 * 要約だけを残す。サーバー側に DB を持たずに済み、診断内容が第三者に残らない。
 * 同じブラウザで同じサイトを再診断したときに限って比較が出る。
 *
 * snapshotOf / compareSnapshots は純関数。loadHistory / saveSnapshot だけが
 * localStorage に触り、使えない環境（プライベートブラウズ・容量超過）では黙って何もしない。
 */
import {
  CATEGORY_LABELS,
  type CategoryId,
  type CheckStatus,
  type SiteAnalysisResult,
} from "@/lib/analyzer/types";
import { CATEGORY_ORDER } from "./weights";

const STORAGE_KEY = "site-diagnosis-history:v1";
/** 1 サイトあたりに残す回数 */
const MAX_PER_SITE = 5;
/** 残すサイト数（古いものから消す） */
const MAX_SITES = 30;

export interface DiagnosisSnapshot {
  origin: string;
  fetchedAt: string;
  overall: number;
  pageCount: number;
  counts: { fail: number; warn: number; info: number };
  categories: Partial<Record<CategoryId, number>>;
  /** 重大・警告・情報のあった項目（id → 最も悪い判定・ラベル・該当ページ数） */
  issues: Record<string, { status: Exclude<CheckStatus, "pass">; label: string; pages: number }>;
}

export function snapshotOf(result: SiteAnalysisResult): DiagnosisSnapshot {
  const counts = { fail: 0, warn: 0, info: 0 };
  const issues: DiagnosisSnapshot["issues"] = {};
  for (const c of result.checks ?? []) {
    counts.fail += c.counts?.fail ?? 0;
    counts.warn += c.counts?.warn ?? 0;
    counts.info += c.counts?.info ?? 0;
    const status = (["fail", "warn", "info"] as const).find((s) => (c.counts?.[s] ?? 0) > 0);
    if (status) {
      issues[c.id] = {
        status,
        label: c.label,
        pages: (c.counts?.fail ?? 0) + (c.counts?.warn ?? 0) + (c.counts?.info ?? 0),
      };
    }
  }
  return {
    origin: result.origin,
    fetchedAt: result.fetchedAt,
    overall: result.overall,
    pageCount: result.pages.length,
    counts,
    categories: Object.fromEntries((result.categories ?? []).map((c) => [c.id, c.score])),
    issues,
  };
}

export interface CategoryDelta {
  id: CategoryId;
  label: string;
  before: number | null;
  after: number;
  delta: number | null;
}

export interface IssueChange {
  id: string;
  label: string;
  before: Exclude<CheckStatus, "pass"> | null;
  after: Exclude<CheckStatus, "pass"> | null;
}

export interface DiagnosisComparison {
  previousAt: string;
  overall: { before: number; after: number; delta: number };
  pageCount: { before: number; after: number };
  counts: Record<"fail" | "warn" | "info", { before: number; after: number; delta: number }>;
  categories: CategoryDelta[];
  /** 前回は重大・警告だったが今回は解消（合格または情報）した項目 */
  resolved: IssueChange[];
  /** 今回新たに重大・警告になった項目（前回は無かった・情報だった） */
  appeared: IssueChange[];
  /** 重大 ↔ 警告で判定が変わった項目 */
  changed: IssueChange[];
}

const SERIOUS = new Set<CheckStatus>(["fail", "warn"]);

/** 前回（before）→ 今回（after）の変化。項目の並びは id 順で固定する（同じ入力なら同じ出力） */
export function compareSnapshots(before: DiagnosisSnapshot, after: DiagnosisSnapshot): DiagnosisComparison {
  const diff = (a: number, b: number) => ({ before: a, after: b, delta: b - a });
  const categories: CategoryDelta[] = CATEGORY_ORDER.filter((id) => after.categories[id] !== undefined).map(
    (id) => {
      const prev = before.categories[id];
      const now = after.categories[id] as number;
      return {
        id,
        label: CATEGORY_LABELS[id],
        before: prev ?? null,
        after: now,
        delta: prev === undefined ? null : now - prev,
      };
    },
  );

  const ids = [...new Set([...Object.keys(before.issues), ...Object.keys(after.issues)])].sort();
  const resolved: IssueChange[] = [];
  const appeared: IssueChange[] = [];
  const changed: IssueChange[] = [];
  for (const id of ids) {
    const prev = before.issues[id];
    const now = after.issues[id];
    const change: IssueChange = {
      id,
      label: (now ?? prev).label,
      before: prev?.status ?? null,
      after: now?.status ?? null,
    };
    const wasSerious = prev !== undefined && SERIOUS.has(prev.status);
    const isSerious = now !== undefined && SERIOUS.has(now.status);
    if (wasSerious && !isSerious) resolved.push({ ...change, label: prev.label });
    else if (!wasSerious && isSerious) appeared.push(change);
    else if (wasSerious && isSerious && prev.status !== now.status) changed.push(change);
  }

  return {
    previousAt: before.fetchedAt,
    overall: diff(before.overall, after.overall),
    pageCount: { before: before.pageCount, after: after.pageCount },
    counts: {
      fail: diff(before.counts.fail, after.counts.fail),
      warn: diff(before.counts.warn, after.counts.warn),
      info: diff(before.counts.info, after.counts.info),
    },
    categories,
    resolved,
    appeared,
    changed,
  };
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

type HistoryStore = Record<string, DiagnosisSnapshot[]>;

function isSnapshot(value: unknown): value is DiagnosisSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DiagnosisSnapshot>;
  return (
    typeof v.origin === "string" &&
    typeof v.fetchedAt === "string" &&
    typeof v.overall === "number" &&
    typeof v.pageCount === "number" &&
    !!v.counts &&
    !!v.categories &&
    !!v.issues
  );
}

function readStore(storage: Storage): HistoryStore {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: HistoryStore = {};
    for (const [origin, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) out[origin] = list.filter(isSnapshot);
    }
    return out;
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** このサイトの過去の診断（新しい順） */
export function loadHistory(origin: string, storage: Storage | null = defaultStorage()): DiagnosisSnapshot[] {
  if (!storage) return [];
  return [...(readStore(storage)[origin] ?? [])].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

/**
 * 今回の結果の直前の診断（同じ診断日時 = キャッシュから返した同じ結果は除く）。
 */
export function previousSnapshot(
  current: DiagnosisSnapshot,
  storage: Storage | null = defaultStorage(),
): DiagnosisSnapshot | null {
  return loadHistory(current.origin, storage).find((s) => s.fetchedAt < current.fetchedAt) ?? null;
}

/** 今回の結果を残す。同じ診断日時は 1 件にまとめる */
export function saveSnapshot(snapshot: DiagnosisSnapshot, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const store = readStore(storage);
    const list = (store[snapshot.origin] ?? []).filter((s) => s.fetchedAt !== snapshot.fetchedAt);
    list.push(snapshot);
    list.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    store[snapshot.origin] = list.slice(0, MAX_PER_SITE);
    // サイト数の上限: 最後に診断した日時が古いサイトから消す
    const origins = Object.keys(store).sort((a, b) =>
      (store[b][0]?.fetchedAt ?? "").localeCompare(store[a][0]?.fetchedAt ?? ""),
    );
    for (const origin of origins.slice(MAX_SITES)) delete store[origin];
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 容量超過・保存禁止の環境では比較が出ないだけで、診断そのものには影響させない
  }
}
