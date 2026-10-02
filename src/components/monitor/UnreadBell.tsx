"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;

/**
 * ヘッダーの通知ベル。未読の通知数を 1 分ごとに聞き直し、ページを移るたびにも更新する。
 * 外部サービスには送らず、ツールの中だけで知らせる。
 */
export function UnreadBell() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/monitor/alerts/unread", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { count?: number };
        if (alive && typeof body.count === "number") setCount(body.count);
      } catch {
        /* 一時的な失敗は次の回に任せる */
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pathname]);

  const unread = count ?? 0;
  return (
    <Link
      href="/monitor/alerts"
      aria-label={unread > 0 ? `通知 ${unread} 件（未読）` : "通知"}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted outline-none hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" strokeLinejoin="round" />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" strokeLinecap="round" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-fail px-1 text-center text-[10px] font-bold leading-[18px] text-on-brand tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
