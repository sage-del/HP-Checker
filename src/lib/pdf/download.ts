/**
 * 画面に出ている診断結果をそのまま PDF にして保存する。
 *
 * 印刷ダイアログを開かずにダウンロードさせたいので、サーバーではなく
 * ブラウザ側で作る。日本語のテキストをそのまま PDF に埋め込むには和文
 * フォント（数 MB）の同梱が必要になるため、ここでは画面を画像化して
 * A4 に貼る方式にしている（文字は選択できないが、見た目は画面と同じ）。
 */

/** A4 の用紙サイズと余白（mm） */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 10;
const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_MM * 2;
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_MM * 2;

/** PDF に描く幅（CSS ピクセル）。画面の max-w-3xl と同じ */
const RENDER_WIDTH = 768;
/**
 * 複製を置く iframe の幅。Tailwind の sm: などはビューポート幅で効くため、
 * スマートフォンから実行しても PC と同じレイアウトの PDF になるように
 * 固定幅のビューポートを用意する。
 */
const RENDER_VIEWPORT = 1024;

/** 画像の解像度。2 で約 200dpi 相当 */
const SCALE = 2;
/**
 * canvas には 1 辺と面積の上限がある（ブラウザによるが概ねこの程度）。
 * 診断結果が非常に長いときは、上限に収まるところまで解像度を落とす。
 */
const MAX_CANVAS_SIDE = 32_000;
const MAX_CANVAS_AREA = 250_000_000;

function fitScale(width: number, height: number): number {
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  return Math.max(1, Math.min(SCALE, bySide, byArea));
}

/**
 * ページの切れ目の候補にする要素。
 * これらの下端で区切ることで、文字の途中でページが変わるのを防ぐ。
 */
const BREAK_SELECTOR = "section, section > *, li, tr, h1, h2, h3, h4, p, pre, table, dl > div";

/** スタイルシートの読み込み待ちの上限 */
const STYLE_TIMEOUT_MS = 5_000;

function afterTimeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function loaded(node: Node): Promise<void> {
  if (!(node instanceof HTMLLinkElement)) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) => {
      node.addEventListener("load", () => resolve(), { once: true });
      node.addEventListener("error", () => resolve(), { once: true });
    }),
    afterTimeout(STYLE_TIMEOUT_MS, undefined),
  ]);
}

/**
 * 画面外の iframe に複製を作る。
 * 元の DOM を触らないので画面がちらつかず、ビューポート幅も固定できる。
 */
async function createSandbox(source: HTMLElement): Promise<{
  frame: HTMLIFrameElement;
  holder: HTMLElement;
}> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    `position:fixed;top:0;left:-${RENDER_VIEWPORT + 200}px;` +
    `width:${RENDER_VIEWPORT}px;height:${RENDER_VIEWPORT}px;border:0;`;
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error("PDF の描画領域を用意できませんでした");
  }

  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  doc.documentElement.lang = document.documentElement.lang;
  doc.body.className = document.body.className;

  // アプリのスタイルを複製側にも読み込ませる
  await Promise.all(
    [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((node) =>
      loaded(doc.head.appendChild(node.cloneNode(true))),
    ),
  );

  const holder = doc.createElement("div");
  holder.className = "pdf-capture";
  holder.style.width = `${RENDER_WIDTH}px`;
  holder.appendChild(doc.importNode(source, true));
  doc.body.appendChild(holder);

  await Promise.race([doc.fonts.ready, afterTimeout(STYLE_TIMEOUT_MS, undefined)]);
  return { frame, holder };
}

/**
 * offsets のうち from より後ろで limit を超えない最大値を返す。
 * 候補がなければ limit（＝要素の途中でも切る）。
 */
function pickBreak(offsets: number[], from: number, limit: number, total: number): number {
  if (limit >= total) return total;
  let best = 0;
  for (const o of offsets) {
    if (o > from && o <= limit && o > best) best = o;
  }
  // 1 つの要素が 1 ページに収まらないときは候補が見つからないので、
  // そのときだけページの高さで機械的に切る
  return best > from ? best : limit;
}

export type DownloadPdfOptions = {
  /** PDF にする要素。この要素の複製を画像化する */
  element: HTMLElement;
  /** 拡張子を除いたファイル名 */
  fileName: string;
};

export async function downloadPdf({ element, fileName }: DownloadPdfOptions): Promise<void> {
  // どちらも初期表示には不要なので、押されたときに読み込む
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const { frame, holder } = await createSandbox(element);
  let canvas: HTMLCanvasElement;
  let breaks: number[];
  let totalHeight: number;
  let scale: number;
  try {
    const holderTop = holder.getBoundingClientRect().top;
    totalHeight = Math.ceil(holder.getBoundingClientRect().height);
    breaks = [
      ...new Set(
        [...holder.querySelectorAll(BREAK_SELECTOR)]
          .map((el) => Math.round(el.getBoundingClientRect().bottom - holderTop))
          .filter((y) => y > 0 && y <= totalHeight),
      ),
    ].sort((a, b) => a - b);

    scale = fitScale(RENDER_WIDTH, totalHeight);
    // クローン先の iframe が縦に収まるようにしてから描画する
    frame.style.height = `${totalHeight + RENDER_VIEWPORT}px`;
    canvas = await html2canvas(holder, {
      scale,
      backgroundColor: "#ffffff",
      logging: false,
      width: RENDER_WIDTH,
      height: totalHeight,
      windowWidth: RENDER_VIEWPORT,
      windowHeight: totalHeight + RENDER_VIEWPORT,
    });
  } finally {
    frame.remove();
  }

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  pdf.setProperties({ title: fileName });

  // 1 ページに入る高さ（CSS ピクセル）
  const pageHeightPx = (RENDER_WIDTH * CONTENT_HEIGHT_MM) / CONTENT_WIDTH_MM;
  const slice = document.createElement("canvas");
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("PDF を作成できませんでした（canvas を利用できません）");

  let top = 0;
  let page = 0;
  while (top < totalHeight) {
    const bottom = pickBreak(breaks, top, top + pageHeightPx, totalHeight);
    const heightPx = bottom - top;

    slice.width = canvas.width;
    slice.height = Math.max(1, Math.round(heightPx * scale));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0,
      Math.round(top * scale),
      canvas.width,
      slice.height,
      0,
      0,
      canvas.width,
      slice.height,
    );

    if (page > 0) pdf.addPage();
    pdf.addImage(
      slice.toDataURL("image/jpeg", 0.92),
      "JPEG",
      MARGIN_MM,
      MARGIN_MM,
      CONTENT_WIDTH_MM,
      (heightPx / RENDER_WIDTH) * CONTENT_WIDTH_MM,
    );

    top = bottom;
    page += 1;
  }

  save(pdf.output("blob"), `${fileName}.pdf`);
}

/** jsPDF の save() はファイル名が反映されないことがあるので、自前でリンクを踏む */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // click 直後に revoke するとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
