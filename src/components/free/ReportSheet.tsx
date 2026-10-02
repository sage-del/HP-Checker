import type { ReactNode } from "react";

/**
 * 報告書の「1 枚の白いシート」。表紙帯のすぐ下に置く（影なし・角丸 2px）。
 * 印刷では枠と余白を外し、見出しと罫線だけが残るようにする。
 */
export function ReportSheet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-b-sm border border-t-0 border-line bg-panel px-5 py-6 @md:px-8 print:border-0 print:px-0 print:py-0">
      {children}
    </div>
  );
}
