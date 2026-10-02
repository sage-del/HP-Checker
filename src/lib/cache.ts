/**
 * プロセス内の簡易 TTL キャッシュ。
 *
 * 同じ URL の再診断を数分間は再取得せずに返すことで、対象サイトへの負荷と
 * FAQ 生成時の API コールを減らす。Vercel のようなサーバーレス環境では
 * インスタンスごとに独立するため「あれば嬉しい」程度の保険。
 * 永続化したくなったら Supabase 等に置き換える。
 */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      // 最も古いものを 1 つ捨てる（Map は挿入順を保持する）
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/**
 * Next.js の dev ホットリロードでキャッシュが消えないよう globalThis に置く。
 *
 * `maxEntries` は 1 件あたりのサイズに合わせて呼び出し側で決める
 * （サイト診断の結果は 1 件で 1 MB 近くなるため既定値のままでは重い）。
 */
export function globalCache<T>(name: string, ttlMs: number, maxEntries?: number): TtlCache<T> {
  const g = globalThis as unknown as Record<string, TtlCache<T> | undefined>;
  const key = `__seo_checker_cache_${name}`;
  if (!g[key]) g[key] = new TtlCache<T>(ttlMs, maxEntries);
  return g[key];
}
