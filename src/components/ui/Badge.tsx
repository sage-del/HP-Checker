import type { ReactNode } from "react";
import { StatusIcon } from "@/components/free/Icons";
import type { StatusTone } from "@/lib/ui/palette";
import { TONE_LABELS } from "@/lib/ui/palette";

/**
 * 判定ピル（pass / warn / fail / info）。11px / 700、必ず 1px の枠線と
 * 12px のアイコンを付ける（色だけに頼らず、背景オフの印刷でも読めるように）。
 */
export type BadgeTone = StatusTone;

const TONE_CLASS: Record<BadgeTone, string> = {
  pass: "text-pass border-pass bg-pass-soft",
  warn: "text-warn border-warn bg-warn-soft",
  fail: "text-fail border-fail bg-fail-soft",
  info: "text-info border-info bg-info-soft",
};

export interface BadgeProps {
  tone: BadgeTone;
  children?: ReactNode;
  className?: string;
}

export function Badge({ tone, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 ${TONE_CLASS[tone]} ${className}`}
    >
      <StatusIcon status={tone} className="h-3 w-3" />
      {children ?? TONE_LABELS[tone]}
    </span>
  );
}
