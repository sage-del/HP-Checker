/**
 * リンク切れ検出の型。
 *
 * 対象は同じサイト（オリジン）内の参照だけ。外部サイトへのリンクは確かめない
 * （第三者のサーバーへ要求を出すことになり、相手の都合で結果も揺れるため）。
 */

/** 参照の種類（どのタグから見つけたか） */
export type LinkKind = "link" | "image" | "stylesheet" | "script";

export interface BrokenLink {
  /** 参照先の URL */
  url: string;
  /** HTTP ステータス。0 = 接続できなかった・時間切れ */
  status: number;
  kind: LinkKind;
  /** 参照元のページ（上限 MAX_SOURCES 件まで） */
  sources: string[];
  /** 参照元のページ数（sources の上限を超えた分も数える） */
  sourceCount: number;
}

export interface LinkCheckResult {
  /** 見つかった参照先の数（重複を除く） */
  found: number;
  /** ステータスを確かめた数（クロールで取得済みのものを含む） */
  checked: number;
  /** 上限・時間切れで確かめられなかった数 */
  unchecked: number;
  /** リンク切れ（404 / 410 / 5xx / 接続不可）。ステータスの悪い順・URL 順 */
  broken: BrokenLink[];
  /** 確かめるのに使った時間（ミリ秒） */
  durationMs: number;
}
