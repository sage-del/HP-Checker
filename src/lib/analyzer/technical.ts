/**
 * 表示速度・セキュリティ・モバイル対応の判定。
 *
 * 表示速度は外部の計測 API（PageSpeed Insights など）を使わず、診断サーバーが HTML を
 * 取得したときの応答時間と HTML の中身から読み取れる範囲だけを見る。画像やスクリプトまで
 * 読み込んだ実際の表示時間（Core Web Vitals）ではないことを、根拠の文言にも明記する。
 */
import type * as cheerio from "cheerio";
import { check, optionalCheck } from "./check";
import type { FetchTiming } from "./fetch";
import type { CheckResult } from "./types";

// ---------------------------------------------------------------------------
// 表示速度
// ---------------------------------------------------------------------------

/** サーバー応答（TTFB）の目安。Google の TTFB の目安（良好 0.8 秒・要改善 1.8 秒）に合わせる */
export const TTFB_GOOD_MS = 800;
export const TTFB_POOR_MS = 1800;

/** HTML の大きさの目安（画像などは含まない HTML 本体） */
export const HTML_GOOD_BYTES = 500 * 1024;
export const HTML_POOR_BYTES = 1500 * 1024;

/** head 内で表示を止めるスクリプトの数の目安 */
export const BLOCKING_SCRIPTS_MAX = 3;

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} 秒`;
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString("ja-JP")} KB`;

export function checkPerformance($: cheerio.CheerioAPI, timing: FetchTiming | undefined): CheckResult[] {
  const results: CheckResult[] = [];

  if (!timing) {
    results.push(
      check({
        id: "response-time",
        category: "performance",
        status: "info",
        label: "サーバーの応答時間を計測できなかった",
        evidence: "未取得",
      }),
    );
  } else {
    const status = timing.ttfbMs <= TTFB_GOOD_MS ? "pass" : timing.ttfbMs <= TTFB_POOR_MS ? "warn" : "fail";
    results.push(
      check({
        id: "response-time",
        category: "performance",
        status,
        weight: 3,
        label:
          status === "pass"
            ? "サーバーの応答が速い"
            : status === "warn"
              ? "サーバーの応答がやや遅い"
              : "サーバーの応答が遅い",
        evidence: `応答まで ${seconds(timing.ttfbMs)}・HTML の受信完了まで ${seconds(timing.totalMs)}（診断サーバーからの計測。画像などの読み込みは含みません）`,
        advice: `ページを開いてから最初のデータが届くまでが ${seconds(TTFB_GOOD_MS)}を超えると、表示を待たずに離脱するお客様が増えます。サーバーのキャッシュ（WordPress ならキャッシュ系プラグイン）、CDN の利用、サーバーの性能・プランを見直してください。`,
      }),
    );
  }

  const bytes = timing?.bytes ?? new TextEncoder().encode($.html()).byteLength;
  const sizeStatus = bytes <= HTML_GOOD_BYTES ? "pass" : bytes <= HTML_POOR_BYTES ? "warn" : "fail";
  results.push(
    check({
      id: "html-size",
      category: "performance",
      status: sizeStatus,
      weight: 1,
      label: sizeStatus === "pass" ? "HTML の大きさが適正" : "HTML が大きすぎる",
      evidence: timing?.truncated
        ? `HTML ${kb(bytes)} 超（大きすぎる・受信が遅すぎるため先頭 ${kb(bytes)} だけを読んで採点しました。目安 ${kb(HTML_GOOD_BYTES)} 以下）`
        : `HTML ${kb(bytes)}（目安 ${kb(HTML_GOOD_BYTES)} 以下）`,
      advice:
        "HTML が大きいと、通信の遅いスマートフォンで表示が始まるまでに時間がかかります。ページに直接埋め込んだ画像データ（data:）・大きなインラインスクリプトやスタイル・不要なプラグインの出力を減らしてください。",
    }),
  );

  const blocking = $("head script[src]").filter((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "").toLowerCase();
    return $el.attr("async") === undefined && $el.attr("defer") === undefined && type !== "module";
  }).length;
  results.push(
    check({
      id: "render-blocking-scripts",
      category: "performance",
      status: blocking <= BLOCKING_SCRIPTS_MAX ? "pass" : "warn",
      weight: 1,
      label:
        blocking <= BLOCKING_SCRIPTS_MAX
          ? "表示を止めるスクリプトが少ない"
          : "表示を止めるスクリプトが多い",
      evidence: `<head> 内の async / defer なしの外部スクリプト ${blocking} 個（目安 ${BLOCKING_SCRIPTS_MAX} 個以下）`,
      advice:
        "<head> で読み込むスクリプトは、読み込みが終わるまで画面の表示を止めます。表示に必要ないスクリプトには defer（または async）を付けるか、</body> の直前に移してください。",
    }),
  );

  const images = $("img").filter((_, el) => {
    const src = $(el).attr("src") ?? $(el).attr("data-src") ?? "";
    return !/^data:image\/(gif|svg)/i.test(src); // 1px のスペーサーは除く
  });
  const sized = images.filter((_, el) => {
    const $el = $(el);
    return Boolean($el.attr("width") && $el.attr("height")) || /aspect-ratio|width\s*:.*height\s*:/i.test($el.attr("style") ?? "");
  }).length;
  const total = images.length;
  const ratio = total === 0 ? 1 : sized / total;
  results.push(
    check({
      id: "image-dimensions",
      category: "performance",
      status: ratio >= 0.8 ? "pass" : "warn",
      weight: 1,
      label:
        total === 0
          ? "画像なし（対象外）"
          : ratio >= 0.8
            ? "画像に大きさが指定されている"
            : "大きさの指定がない画像がある",
      evidence: total === 0 ? undefined : `width / height の指定あり ${sized} / ${total} 枚`,
      advice:
        "画像に width と height を書いておくと、読み込み前に表示場所が確保され、読んでいる途中で文章がずれる（レイアウトのずれ）を防げます。<img> に元画像の幅と高さを指定してください。",
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// セキュリティ
// ---------------------------------------------------------------------------

export function checkSecurity($: cheerio.CheerioAPI, finalUrl: URL, headers: Headers): CheckResult[] {
  const https = finalUrl.protocol === "https:";
  const results: CheckResult[] = [
    check({
      id: "https",
      category: "security",
      status: https ? "pass" : "fail",
      weight: 3,
      label: https ? "HTTPS で配信されている" : "HTTPS で配信されていない",
      evidence: https ? undefined : `${finalUrl.origin} は暗号化されていない http で表示されます`,
      advice:
        "http のページはブラウザに「保護されていない通信」と表示され、お客様の不安と離脱の原因になります。サーバーで SSL 証明書（無料の Let's Encrypt など）を設定し、http から https へ転送してください。",
    }),
  ];

  // 混在コンテンツ: https のページが http で読み込むもの。スクリプト・CSS・iframe はブラウザが止める
  const blocked: string[] = [];
  const passive: string[] = [];
  if (https) {
    $("script[src], link[rel~='stylesheet'][href], iframe[src]").each((_, el) => {
      const url = $(el).attr("src") ?? $(el).attr("href") ?? "";
      if (/^http:\/\//i.test(url.trim())) blocked.push(url.trim());
    });
    $("img[src], video[src], audio[src], source[src]").each((_, el) => {
      const url = $(el).attr("src") ?? "";
      if (/^http:\/\//i.test(url.trim())) passive.push(url.trim());
    });
  }
  results.push(
    check({
      id: "mixed-content",
      category: "security",
      status: blocked.length > 0 ? "fail" : passive.length > 0 ? "warn" : "pass",
      weight: 2,
      label:
        !https
          ? "混在コンテンツ（https のページのみ対象）"
          : blocked.length + passive.length === 0
            ? "http の読み込みが混ざっていない"
            : "https のページに http の読み込みが混ざっている",
      evidence:
        blocked.length + passive.length === 0
          ? undefined
          : [
              blocked.length > 0 ? `スクリプト・CSS・iframe ${blocked.length} 件（${blocked[0]} など）` : "",
              passive.length > 0 ? `画像・動画 ${passive.length} 件（${passive[0]} など）` : "",
            ]
              .filter(Boolean)
              .join(" / "),
      advice:
        "https のページで http の部品を読み込むと、ブラウザがスクリプトや CSS をブロックして表示が崩れたり、「保護されていない」と表示されたりします。読み込み先の URL を https:// に書き換えてください。",
    }),
  );

  const hsts = headers.get("strict-transport-security");
  results.push(
    optionalCheck({
      id: "hsts",
      category: "security",
      present: https && Boolean(hsts),
      label: https && hsts ? "HSTS が設定されている" : "HSTS が未設定（任意）",
      advice:
        "Strict-Transport-Security ヘッダーを返すと、ブラウザが以後 http でアクセスしなくなり、通信の乗っ取りを防げます（任意）。",
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// モバイル対応
// ---------------------------------------------------------------------------

export function checkMobile($: cheerio.CheerioAPI): CheckResult[] {
  const viewport = ($('meta[name="viewport"]').attr("content") ?? "").toLowerCase().replace(/\s+/g, "");
  const hasViewport = viewport.length > 0;
  const deviceWidth = /width=device-width/.test(viewport);
  const maxScale = /maximum-scale=([\d.]+)/.exec(viewport)?.[1];
  const zoomLocked = /user-scalable=(no|0)/.test(viewport) || (maxScale !== undefined && Number(maxScale) < 2);

  return [
    check({
      id: "viewport",
      category: "mobile",
      status: deviceWidth ? "pass" : hasViewport ? "warn" : "fail",
      weight: 3,
      label: deviceWidth
        ? "スマートフォン向けの表示設定がある"
        : hasViewport
          ? "viewport の指定が不十分"
          : "スマートフォン向けの表示設定（viewport）がない",
      evidence: hasViewport ? `content="${viewport}"` : undefined,
      advice:
        "viewport の指定が無いと、スマートフォンでパソコン向けの画面が縮小表示され、文字が小さくて読めません。<head> に <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> を追加し、画面幅に合わせたデザインにしてください。",
    }),
    check({
      id: "zoom-enabled",
      category: "mobile",
      status: zoomLocked ? "warn" : "pass",
      weight: 1,
      label: zoomLocked ? "拡大表示が禁止されている" : "拡大表示ができる",
      evidence: zoomLocked ? `content="${viewport}"` : undefined,
      advice:
        "user-scalable=no や maximum-scale=1 は、文字を拡大して読みたい方（特に年配の方）の操作を妨げます。viewport から外してください。",
    }),
  ];
}
