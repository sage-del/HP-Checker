"use client";

import type { ReactNode } from "react";

/** 送信前に確認ダイアログを出すボタン（取り消せない操作用） */
export function ConfirmSubmit({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
