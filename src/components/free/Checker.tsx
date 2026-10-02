"use client";

/**
 * サイト診断（SEO・AIO）の画面。
 *
 * - フォーム・進捗・操作行は no-print、レポート本体（reportRef）だけを PDF 化する
 * - 診断は POST /api/site の NDJSON ストリーム（readNdjson 経由）。範囲はサイト全体だけ
 * - 進捗・中止はここで持ち、描画は free/ の各セクションに任せる
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Callout } from "@/components/ui";
import type { SiteAnalysisResult, SiteProgress } from "@/lib/analyzer/types";
import { requestSiteAnalysis, SiteRequestError } from "@/lib/crawl/client";
import { downloadPdf } from "@/lib/pdf/download";
import {
  buildIssuesCsv,
  compareSnapshots,
  issuesCsvFileName,
  previousSnapshot,
  reportFileName,
  saveSnapshot,
  snapshotOf,
  type DiagnosisComparison,
} from "@/lib/report";
import { DiagnosisForm } from "./DiagnosisForm";
import { Download } from "./Icons";
import { ProgressPanel } from "./ProgressPanel";
import { SiteReport } from "./SiteReport";

type State =
  | { phase: "idle" }
  | { phase: "loading"; progress: SiteProgress | null }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      result: SiteAnalysisResult;
      cached: boolean;
      elapsedMs: number;
      comparison: DiagnosisComparison | null;
    };

/** 課題一覧の CSV を保存させる。Excel で文字化けしないよう BOM を付ける */
function downloadCsv(text: string, fileName: string) {
  const blob = new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function messageOf(err: unknown): string {
  if (err instanceof SiteRequestError) return err.message;
  if (err instanceof TypeError) {
    return "サーバーに接続できませんでした。通信の状態を確認して、もう一度お試しください。";
  }
  if (err instanceof Error && err.message) return err.message;
  return "診断に失敗しました。しばらく待ってからもう一度お試しください。";
}

export function Checker() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdf, setPdf] = useState<"idle" | "working" | "failed">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  // 診断中だけ経過時間を進める（no-print 領域なので PDF には影響しない）
  const loading = state.phase === "loading";
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // 画面を離れるときは走っているクロールを止める
  useEffect(() => () => abortRef.current?.abort(), []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: "idle" });
    setNotice("診断を中止しました。");
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const target = url.trim();
    if (!target) {
      setFormError("URL を入力してください。");
      return;
    }
    setFormError(null);
    setNotice(null);
    setPdf("idle");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ phase: "loading", progress: null });

    try {
      const { result, cached } = await requestSiteAnalysis(target, {
        signal: controller.signal,
        onProgress: (progress) =>
          setState((prev) => (prev.phase === "loading" ? { ...prev, progress } : prev)),
      });
      if (controller.signal.aborted) return;
      // 同じブラウザに前回の診断があれば比較を出し、今回の要約を残す
      const snapshot = snapshotOf(result);
      const previous = previousSnapshot(snapshot);
      saveSnapshot(snapshot);
      setState({
        phase: "done",
        result,
        cached,
        elapsedMs: Date.now() - startedAtRef.current,
        comparison: previous ? compareSnapshots(previous, snapshot) : null,
      });
    } catch (err) {
      // 中止ボタン・画面離脱による中断はエラーとして扱わない
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setState({ phase: "error", message: messageOf(err) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function onDownloadPdf(fileName: string) {
    const element = reportRef.current;
    if (!element) return;
    setPdf("working");
    try {
      await downloadPdf({ element, fileName });
      setPdf("idle");
    } catch {
      setPdf("failed");
    }
  }

  const fileName =
    state.phase === "done" ? reportFileName(state.result.entryUrl, state.result.fetchedAt) : "";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
      <DiagnosisForm
        url={url}
        onUrlChange={setUrl}
        onSubmit={onSubmit}
        busy={state.phase === "loading"}
        error={formError}
      />

      {state.phase === "loading" && (
        <ProgressPanel progress={state.progress} elapsedMs={elapsedMs} onAbort={abort} />
      )}

      {notice && state.phase !== "loading" && (
        <p className="no-print mb-6 text-[13px] text-muted" role="status">
          {notice}
        </p>
      )}

      {state.phase === "error" && (
        <Callout tone="fail" className="no-print mb-6" title="診断できませんでした">
          {state.message}
        </Callout>
      )}

      {state.phase === "done" && (
        <>
          <div className="no-print mb-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {state.cached && (
              <span className="mr-auto text-[12px] text-muted">直近の診断結果を表示しています</span>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => downloadCsv(buildIssuesCsv(state.result), issuesCsvFileName(fileName))}
              icon={<Download className="h-4 w-4" />}
            >
              課題一覧（CSV）
            </Button>
            <Button
              size="sm"
              onClick={() => onDownloadPdf(fileName)}
              loading={pdf === "working"}
              icon={<Download className="h-4 w-4" />}
            >
              {pdf === "working" ? "PDF を作成中…" : "PDFでダウンロード"}
            </Button>
            {pdf === "failed" && (
              <p className="w-full text-right text-[12px] text-fail" role="alert">
                PDF を作成できませんでした。時間をおいて、もう一度お試しください。
              </p>
            )}
          </div>

          <div ref={reportRef} className="@container">
            <SiteReport result={state.result} elapsedMs={state.elapsedMs} comparison={state.comparison} />
          </div>
        </>
      )}
    </main>
  );
}
