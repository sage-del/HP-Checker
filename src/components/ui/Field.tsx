import type { InputHTMLAttributes, ReactNode } from "react";

export interface FieldProps {
  label: ReactNode;
  /** 入力要素の id（label の for に使う） */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** ラベル 13px / 700 + 入力 + 補足 / エラー */
export function Field({ label, htmlFor, hint, error, className = "", children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-[13px] font-bold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-fail" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const BASE =
  "w-full rounded-lg border bg-panel px-3 text-base text-ink outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-60";

function borderClass(invalid?: boolean): string {
  return invalid ? "border-fail" : "border-line";
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className = "", ...rest }: InputProps) {
  return <input className={`${BASE} h-11 ${borderClass(invalid)} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

