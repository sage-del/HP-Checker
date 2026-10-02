/**
 * アクセス制限（Next.js 16 の Proxy。旧 middleware）。
 *
 * - BASIC_AUTH_PASSWORD を設定すると、サイト全体に Basic 認証を掛ける
 *   （ユーザー名は BASIC_AUTH_USER、既定 "admin"）。社内向けに公開するときの設定。
 * - 監視機能（DATABASE_URL）を本番で有効にしているのにパスワードが無いときは、
 *   監視の画面と API だけを止める。診断の記録や通知を誰でも見られる状態にしないため。
 * - /api/cron/* は Vercel Cron が呼ぶので対象外（CRON_SECRET で別に確かめる）。
 * - /api/automation/* は Codex が呼ぶので Basic 認証の対象外。
 *   各 Route Handler が AUTOMATION_API_KEY の Bearer 認証を行う。
 */
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/monitor/auth";

const MONITOR_PATH = /^\/(monitor|api\/monitor)(\/|$)/;
const AUTOMATION_PATH = /^\/api\/automation(\/|$)/;

export function proxy(request: NextRequest) {
  if (AUTOMATION_PATH.test(request.nextUrl.pathname)) return NextResponse.next();

  const password = process.env.BASIC_AUTH_PASSWORD;
  if (password) {
    const user = process.env.BASIC_AUTH_USER || "admin";
    if (checkBasicAuth(request.headers.get("authorization"), user, password)) return NextResponse.next();
    return new NextResponse("認証が必要です", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="site-kenshin", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.DATABASE_URL &&
    MONITOR_PATH.test(request.nextUrl.pathname)
  ) {
    return new NextResponse(
      "監視機能を使うには BASIC_AUTH_PASSWORD を設定してください（診断の記録を誰でも見られる状態にしないため）",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  // 静的ファイル・アイコン・Cron は対象外。automation は proxy 内で明示的に通す。
  matcher: ["/((?!_next/static|_next/image|api/cron/|favicon\\.ico|icon\\.svg|apple-icon\\.png|icon-\\d+\\.png|manifest\\.webmanifest).*)"],
};
