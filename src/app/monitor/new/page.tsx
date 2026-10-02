import type { Metadata } from "next";
import { AddSiteForm } from "@/components/monitor/AddSiteForm";
import { NotConfigured, PageTitle } from "@/components/monitor/parts";
import { isMonitorConfigured } from "@/lib/monitor/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "サイト追加" };

/** 監視するサイトの登録 */
export default function NewSitePage() {
  if (!isMonitorConfigured()) return <NotConfigured />;
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <PageTitle
        title="サイト追加"
        lead="登録したサイトは、選んだ頻度で自動診断します（毎日 3:00 ごろ）。登録後の画面で「今すぐ診断」を押すと、最初の結果をすぐに取れます。"
      />
      <div className="max-w-2xl">
        <AddSiteForm />
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[13px] text-muted">
          <li>URL は診断の起点です。ふつうはサイトのトップページを入れてください。</li>
          <li>1 回の診断で見るのは最大 100 ページです。同じサイト内のリンク切れ（リンク・画像・CSS・JavaScript）も確かめます。</li>
          <li>前回の診断より悪くなったときだけ、通知タブにお知らせが届きます。</li>
        </ul>
      </div>
    </main>
  );
}
