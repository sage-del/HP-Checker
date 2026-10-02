import type { Metadata } from "next";
import { PageTitle, Section } from "@/components/monitor/parts";
import { Badge } from "@/components/ui";
import { INTEGRATION_STATUS, systemArchitecture } from "@/lib/system/architecture";

export const metadata: Metadata = { title: "システム構成" };

function FlowArrow() {
  return (
    <span className="shrink-0 text-lg font-bold text-accent" aria-hidden="true">
      →
    </span>
  );
}

export default function SystemPage() {
  const data = systemArchitecture;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <PageTitle
        title="システム構成"
        lead={`構成図、API、外部サービス、再現手順を一か所で確認できます。構成情報の更新日: ${data.updatedAt}`}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-[11px] font-bold text-muted">ソース管理</p>
          <p className="mt-1 text-sm font-bold text-ink">{data.repository.hosting} / {data.repository.name}</p>
          <p className="mt-1 text-[12px] text-muted">ブランチ: {data.repository.branch}</p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-4">
          <p className="text-[11px] font-bold text-muted">実行・公開</p>
          <p className="mt-1 text-sm font-bold text-ink">{data.runtime.name} / {data.runtime.project}</p>
          <p className="mt-1 text-[12px] text-muted">{data.runtime.framework}</p>
        </div>
      </div>

      <Section title="構成図とデータの流れ">
        <div className="grid gap-4 lg:grid-cols-2">
          {data.flows.map((flow) => (
            <article key={flow.id} className="rounded-xl border border-line bg-panel p-5">
              <h3 className="text-sm font-bold text-ink">{flow.title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{flow.description}</p>
              <ol className="mt-4 flex flex-wrap items-center gap-2" aria-label={`${flow.title}の流れ`}>
                {flow.steps.map((step, index) => (
                  <li key={step} className="contents">
                    <span className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-bold text-ink">{step}</span>
                    {index < flow.steps.length - 1 && <FlowArrow />}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </Section>

      <Section title="連携API・サービス">
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[58rem] text-[12px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className="px-4 py-3 font-bold">API / サービス</th>
                <th className="px-4 py-3 font-bold">用途</th>
                <th className="px-4 py-3 font-bold">認証</th>
                <th className="px-4 py-3 font-bold">設定</th>
                <th className="px-4 py-3 font-bold">状態</th>
              </tr>
            </thead>
            <tbody>
              {data.integrations.map((item) => {
                const status = INTEGRATION_STATUS[item.status];
                return (
                  <tr key={item.name} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold text-ink">{item.name}</p>
                      <p className="mt-0.5 text-muted">{item.category} / {item.service}</p>
                    </td>
                    <td className="max-w-xs px-4 py-3 leading-relaxed text-ink">{item.purpose}</td>
                    <td className="px-4 py-3 text-muted">{item.authentication}</td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {item.configuration.map((value) => <li key={value}><code className="rounded bg-surface px-1 py-0.5 text-[11px] text-ink">{value}</code></li>)}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">秘密値は表示・保存しません。ここには環境変数名と認証方式だけを記載します。</p>
      </Section>

      <Section title="内部API">
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[46rem] text-[12px]">
            <thead><tr className="border-b border-line bg-surface text-left text-muted"><th className="px-4 py-3">Method</th><th className="px-4 py-3">Path</th><th className="px-4 py-3">用途</th><th className="px-4 py-3">認証</th></tr></thead>
            <tbody>
              {data.internalApis.map((api) => (
                <tr key={`${api.method}-${api.path}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-bold text-accent">{api.method}</td>
                  <td className="px-4 py-3"><code className="text-ink">{api.path}</code></td>
                  <td className="px-4 py-3 text-ink">{api.purpose}</td>
                  <td className="px-4 py-3 text-muted">{api.auth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="再現手順">
          <ol className="space-y-3 rounded-xl border border-line bg-panel p-5">
            {data.reproductionSteps.map((step, index) => <li key={step} className="flex gap-3 text-[13px] leading-relaxed text-ink"><span className="font-bold text-accent">{index + 1}.</span><span>{step}</span></li>)}
          </ol>
        </Section>
        <Section title="更新ルール">
          <ul className="list-disc space-y-3 rounded-xl border border-line bg-panel p-5 pl-9 text-[13px] leading-relaxed text-ink">
            {data.maintenanceRules.map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </Section>
      </div>

      <p className="mt-8 text-[11px] text-muted">唯一の管理元: <code>{data.sourceOfTruth}</code> / schema v{data.schemaVersion}</p>
    </main>
  );
}
