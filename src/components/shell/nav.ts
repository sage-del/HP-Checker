/**
 * 左サイドバーのメニュー（唯一の定義）。機能ごとに 1 タブ。
 * 画面を増やしたらここに足す。アイコンは Sidebar.tsx の NavIcon が名前で引く。
 */
export type NavIconName = "diagnose" | "dashboard" | "add" | "links" | "history" | "alerts" | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  /** このパスで始まる画面でもタブを選択中にする（詳細画面など） */
  alsoActive?: readonly string[];
  /** 未読の通知数をバッジで出す */
  badge?: "unread";
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "診断",
    items: [{ href: "/", label: "サイト診断", icon: "diagnose" }],
  },
  {
    label: "定期監視",
    items: [
      { href: "/monitor", label: "ダッシュボード", icon: "dashboard", alsoActive: ["/monitor/sites/"] },
      { href: "/monitor/new", label: "サイト追加", icon: "add" },
      { href: "/monitor/links", label: "リンク切れ", icon: "links" },
      { href: "/monitor/runs", label: "診断履歴", icon: "history" },
      { href: "/monitor/alerts", label: "通知", icon: "alerts", badge: "unread" },
    ],
  },
  {
    label: "システム",
    items: [{ href: "/settings", label: "設定", icon: "settings" }],
  },
];

/** 今の画面でこのタブを選択中にするか */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  if ((item.alsoActive ?? []).some((prefix) => pathname.startsWith(prefix))) return true;
  // 「/」と「/monitor」は配下に別のタブ（/monitor/new など）があるので、完全一致か alsoActive だけ
  if (item.href === "/" || item.href === "/monitor") return false;
  return pathname.startsWith(`${item.href}/`);
}
