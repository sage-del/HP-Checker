"use client";

import { useActionState } from "react";
import { addSiteAction, type AddSiteState } from "@/app/monitor/actions";
import { Button, Field, Input } from "@/components/ui";
import { FREQUENCIES, FREQUENCY_LABEL } from "@/lib/monitor/schedule";

/** 監視するサイトを登録するフォーム */
export function AddSiteForm() {
  const [state, action, pending] = useActionState<AddSiteState, FormData>(addSiteAction, {});

  return (
    <form action={action} className="grid gap-4 rounded-xl border border-line bg-panel p-5 md:grid-cols-[1fr_12rem]">
      <Field label="サイトの URL" htmlFor="monitor-url" error={state.error} className="md:col-span-2">
        <Input id="monitor-url" name="url" type="text" inputMode="url" placeholder="https://example.co.jp/" required invalid={!!state.error} />
      </Field>
      <Field label="表示名" htmlFor="monitor-name" hint="省略するとドメイン名になります">
        <Input id="monitor-name" name="name" type="text" maxLength={60} placeholder="コーポレートサイト" />
      </Field>
      <Field label="診断の頻度" htmlFor="monitor-frequency">
        <select
          id="monitor-frequency"
          name="frequency"
          defaultValue="daily"
          className="h-11 w-full rounded-lg border border-line bg-panel px-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_LABEL[f]}
            </option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" loading={pending}>
          監視に追加
        </Button>
      </div>
    </form>
  );
}
