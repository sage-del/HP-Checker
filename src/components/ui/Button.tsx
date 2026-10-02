import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-brand border border-accent hover:bg-accent-strong hover:border-accent-strong focus-visible:ring-accent/40",
  secondary: "bg-panel text-ink border border-line hover:bg-surface focus-visible:ring-accent/40",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

/** ボタンのクラス列 */
function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-bold outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 処理中。disabled + スピナー + カーソル wait */
  loading?: boolean;
  /** 左に置くアイコン（16px 想定） */
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, `${loading ? "cursor-wait" : ""} ${className}`)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}
