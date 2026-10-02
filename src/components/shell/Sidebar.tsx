"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "./LogoMark";
import { isNavActive, NAV_GROUPS, type NavIconName } from "./nav";

const POLL_MS = 60_000;

/** 未読の通知数。1 分ごとと、画面を移るたびに聞き直す（外部サービスには送らない） */
function useUnreadCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, pathname]);
  return enabled ? count : 0;
}

export interface SidebarProps {
  name: string;
  tagline: string;
  /** 監視機能（DATABASE_URL）が有効か。無効なら未読数を聞きに行かない */
  monitorEnabled: boolean;
}

/**
 * 管理画面の左サイドバー。機能ごとのタブを縦に並べる。
 * md 以上は常に表示、スマホは上部のバーの「メニュー」で引き出す。印刷 / PDF では no-print で消える。
 */
export function Sidebar({ name, tagline, monitorEnabled }: SidebarProps) {
  const pathname = usePathname() ?? "/";
  const unread = useUnreadCount(monitorEnabled, pathname);
  const [open, setOpen] = useState(false);
  // 画面を移ったらドロワーを閉じる（前回のパスと比べて、描画中に状態を直す）
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const brand = (
    <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <LogoMark className="h-9 w-9 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold leading-tight text-ink">{name}</span>
        <span className="line-clamp-2 block text-[11px] leading-snug text-muted">{tagline}</span>
      </span>
    </Link>
  );

  const nav = (
    <nav aria-label="メニュー" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-bold tracking-wide text-muted">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isNavActive(item, pathname);
              const badge = item.badge === "unread" && unread > 0 ? unread : 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      active ? "bg-accent-soft text-accent" : "text-ink/80 hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <NavIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && (
                      <span
                        className="min-w-[20px] rounded-full bg-fail px-1.5 text-center text-[11px] leading-5 text-on-brand tabular-nums"
                        aria-label={`未読 ${badge} 件`}
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* スマホ: 上部のバー */}
      <div className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur md:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="sidebar-drawer"
          className="relative ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-3 text-sm font-bold text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
          メニュー
          {unread > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-fail" aria-label="未読の通知があります" />}
        </button>
      </div>

      {/* スマホ: ドロワー */}
      {open && (
        <div className="no-print fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="メニュー">
          <button type="button" aria-label="メニューを閉じる" className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div id="sidebar-drawer" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-panel p-4 shadow-xl">
            <div className="flex items-center gap-2">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="メニューを閉じる"
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                  <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      {/* md 以上: 常に出すサイドバー */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-panel p-4 md:flex">
        <div className="px-1 pt-1">{brand}</div>
        {nav}
      </aside>
    </>
  );
}

function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, className, "aria-hidden": true } as const;
  switch (name) {
    case "diagnose":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" strokeLinecap="round" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common} strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
          <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
          <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
        </svg>
      );
    case "add":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" strokeLinecap="round" />
        </svg>
      );
    case "links":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          <path d="m4 4 2 2M20 20l-2-2" />
        </svg>
      );
    case "history":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M4 12a8 8 0 1 0 2.3-5.7" />
          <path d="M4 4v3.5h3.5" strokeLinejoin="round" />
          <path d="M12 8v4.5l3 2" strokeLinejoin="round" />
        </svg>
      );
    case "alerts":
      return (
        <svg {...common}>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" strokeLinejoin="round" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
      );
  }
}
