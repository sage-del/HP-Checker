"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { formatClock } from "@/lib/report/format";

/**
 * 「今すぐ診断」。サイト全体のクロールとリンク切れの確認で数分かかるので、
 * 経過時間を出しながら待ち、終わったら画面を読み直す。
 */
export function RunNowButton({ siteId, size = "md" }: { siteId: number; size?: "sm" | "md" }) {
  const router = useRouter();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const run = async () => {
    setError(null);
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      const res = await fetch(`/api/monitor/sites/${siteId}/run`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? `診断に失敗しました（HTTP ${res.status}）`);
      router.refresh();
    } catch {
      setError("通信に失敗しました");
    } finally {
      setStartedAt(null);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" size={size} loading={startedAt !== null} onClick={run}>
        {startedAt !== null ? `診断中… ${formatClock(elapsed)}` : "今すぐ診断"}
      </Button>
      {error && (
        <p className="text-[12px] text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
