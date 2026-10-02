import type { CheckStatus } from "@/lib/analyzer/types";

type IconProps = { className?: string };

function CheckCircle({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnTriangle({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FailCircle({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" strokeLinecap="round" />
    </svg>
  );
}

function InfoCircle({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" strokeLinecap="round" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Download({ className = "" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" strokeLinecap="round" />
    </svg>
  );
}

export function StatusIcon({ status, className = "h-5 w-5" }: { status: CheckStatus; className?: string }) {
  switch (status) {
    case "pass":
      return <CheckCircle className={`${className} text-pass`} />;
    case "warn":
      return <WarnTriangle className={`${className} text-warn`} />;
    case "fail":
      return <FailCircle className={`${className} text-fail`} />;
    case "info":
      return <InfoCircle className={`${className} text-info`} />;
  }
}
