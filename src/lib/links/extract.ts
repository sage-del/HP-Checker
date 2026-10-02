/**
 * HTML から「同じサイト内への参照」を集める純関数（ネットワークに出ない）。
 *
 * a / area の href、img の src、rel=stylesheet の link、script の src を見る。
 * crawl/url.ts の extractLinks と同じく正規表現で読む（ページごとに cheerio で
 * もう一度 DOM を作るのは重いため）。
 */
import { alignToOrigin, canonicalizeUrl, decodeEntities } from "@/lib/crawl/url";
import type { LinkKind } from "./types";

export interface PageRef {
  url: string;
  kind: LinkKind;
}

/** 参照元として残すページ数の上限（件数は別に数える） */
export const MAX_SOURCES = 5;

const SKIP_SCHEME = /^(mailto|tel|sms|javascript|data|ftp|file|blob|about):/i;

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return null;
  return decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
}

/** <base href> を踏まえた、相対 URL の解決基準 */
function resolveBase(html: string, pageUrl: string): string {
  const baseTag = /<base\b[^>]*>/i.exec(html);
  const href = baseTag ? attr(baseTag[0], "href") : null;
  if (!href) return pageUrl;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

/**
 * ページ内の同一サイトへの参照を、種類つきで重複なく返す（文書順）。
 * http / https の違いだけならサイト内として扱う（http:// のまま書かれた内部リンクは多い）。
 */
export function extractRefs(html: string, pageUrl: string, origin: string): PageRef[] {
  const base = resolveBase(html, pageUrl);
  const out = new Map<string, LinkKind>();

  const add = (raw: string | null, kind: LinkKind) => {
    if (!raw || raw.startsWith("#") || SKIP_SCHEME.test(raw)) return;
    let abs: string;
    try {
      abs = new URL(raw, base).toString();
    } catch {
      return;
    }
    const aligned = alignToOrigin(abs, origin);
    if (!aligned) return;
    const url = canonicalizeUrl(aligned);
    if (url && !out.has(url)) out.set(url, kind);
  };

  // コメントの中のタグは数えない
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of source.matchAll(/<(a|area|img|link|script)\b[^>]*>/gi)) {
    const tag = m[0];
    switch (m[1].toLowerCase()) {
      case "a":
      case "area":
        add(attr(tag, "href"), "link");
        break;
      case "img":
        add(attr(tag, "src"), "image");
        break;
      case "link": {
        const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("stylesheet")) add(attr(tag, "href"), "stylesheet");
        break;
      }
      case "script":
        add(attr(tag, "src"), "script");
        break;
    }
  }
  return [...out].map(([url, kind]) => ({ url, kind }));
}

export interface RefTarget {
  kind: LinkKind;
  sources: string[];
  sourceCount: number;
}

/** 全ページの参照を「参照先 → 参照元」にまとめる */
export class RefCollector {
  readonly targets = new Map<string, RefTarget>();

  add(pageUrl: string, refs: readonly PageRef[]): void {
    for (const ref of refs) {
      if (ref.url === pageUrl) continue;
      let target = this.targets.get(ref.url);
      if (!target) {
        target = { kind: ref.kind, sources: [], sourceCount: 0 };
        this.targets.set(ref.url, target);
      }
      target.sourceCount += 1;
      if (target.sources.length < MAX_SOURCES) target.sources.push(pageUrl);
    }
  }
}
