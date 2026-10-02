import type { ReactNode } from "react";
import { StatusIcon } from "@/components/free/Icons";
import type { StatusTone } from "@/lib/ui/palette";

export interface CalloutProps {
  tone?: StatusTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const TONE: Record<StatusTone, string> = {
  info: "border-info bg-info-soft text-info",
  warn: "border-warn bg-warn-soft text-warn",
  fail: "border-fail bg-fail-soft text-fail",
  pass: "border-pass bg-pass-soft text-pass",
};

/** 注意書き・エラーの帯。枠 + soft 地 + 判定色の文字、アイコン付き */
export function Callout({ tone = "info", title, children, className = "" }: CalloutProps) {
  return (
    <div role={tone === "fail" ? "alert" : "note"} className={`flex gap-2.5 rounded-lg border p-4 text-sm leading-relaxed ${TONE[tone]} ${className}`}>
      <StatusIcon status={tone} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}
