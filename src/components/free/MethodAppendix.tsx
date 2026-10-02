/**
 * 付録 B「診断方法と採点基準」と、レポート末尾の次のステップ・注記（design-spec §3.2 付録 B）。
 * 採点の内訳を開示することで、講評やスコアが再現可能であることを示す。
 */
import { SegmentBar } from "@/components/charts";
import {
  CATEGORY_CRITERIA,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_WEIGHTS,
  formatDateTimeSeconds,
} from "@/lib/report";
import { GRADE_BANDS } from "@/lib/ui/grade";
import { palette } from "@/lib/ui/palette";
import { Num, ReportSection, SubHeading } from "./report-parts";
import { BRAND } from "@/lib/brand";

const TH = "border-b border-line px-2 py-2 text-left text-[12px] font-bold text-muted";
const TD = "border-b border-line px-2 py-2 align-top text-[13px] text-ink";

const SCORING_ROWS: { label: string; ratio: string; note: string }[] = [
  { label: "合格", ratio: "配点の 100%", note: "条件を満たしています" },
  { label: "警告", ratio: "配点の 50%", note: "設定はあるものの、内容や量に改善の余地があります" },
  { label: "重大", ratio: "0 点", note: "条件を満たしておらず、優先して直すべき項目です" },
  {
    label: "情報",
    ratio: "採点対象外",
    note: "根拠が確立していない項目・そのページに当てはまらない項目。状態は表示しますが加点も減点もしません",
  },
];

export function MethodAppendix({
  number,
  fetchedAt,
  version,
}: {
  number: string;
  fetchedAt: string;
  version: string;
}) {
  return (
    <ReportSection
      number={number}
      title="診断方法と採点基準"
      lead="この診断は公開されている HTML・robots.txt・llms.txt・sitemap.xml だけを読み、次の基準で機械的に採点しています。"
    >
      <SubHeading>カテゴリと配点</SubHeading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem]">
          <thead>
            <tr>
              <th scope="col" className={TH} style={{ width: "7.5rem" }}>
                カテゴリ
              </th>
              <th scope="col" className={`${TH} text-right`} style={{ width: "3.5rem" }}>
                配点
              </th>
              <th scope="col" className={TH}>
                主な確認内容
              </th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((id) => (
              <tr key={id}>
                <th scope="row" className={`${TD} font-bold whitespace-nowrap`}>
                  {CATEGORY_LABELS[id]}
                </th>
                <td className={`${TD} text-right tabular-nums`}>{CATEGORY_WEIGHTS[id]}</td>
                <td className={`${TD} text-[12px] leading-relaxed text-muted`}>{CATEGORY_CRITERIA[id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <SegmentBar
          segments={CATEGORY_ORDER.map((id, i) => ({
            label: CATEGORY_LABELS[id],
            value: CATEGORY_WEIGHTS[id],
            color: palette.chart[i % palette.chart.length],
          }))}
          ariaLabel="総合スコアの配点構成"
        />
      </div>

      <SubHeading>判定と得点</SubHeading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[24rem]">
          <thead>
            <tr>
              <th scope="col" className={TH} style={{ width: "6rem" }}>
                判定
              </th>
              <th scope="col" className={TH} style={{ width: "7rem" }}>
                得点
              </th>
              <th scope="col" className={TH}>
                意味
              </th>
            </tr>
          </thead>
          <tbody>
            {SCORING_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className={`${TD} font-bold whitespace-nowrap`}>
                  {row.label}
                </th>
                <td className={`${TD} whitespace-nowrap`}>{row.ratio}</td>
                <td className={`${TD} text-[12px] text-muted`}>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SubHeading>グレードの閾値</SubHeading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem]">
          <thead>
            <tr>
              <th scope="col" className={TH} style={{ width: "5rem" }}>
                グレード
              </th>
              <th scope="col" className={`${TH} text-right`} style={{ width: "6rem" }}>
                総合スコア
              </th>
              <th scope="col" className={TH}>
                評価
              </th>
            </tr>
          </thead>
          <tbody>
            {GRADE_BANDS.map((band, i) => (
              <tr key={band.grade}>
                <th
                  scope="row"
                  className={`${TD} font-bold`}
                  style={{ color: palette.grade[band.grade] }}
                >
                  {band.grade}
                </th>
                <td className={`${TD} text-right tabular-nums`}>
                  {i === 0
                    ? `${band.min} 〜 100`
                    : i === GRADE_BANDS.length - 1
                      ? `0 〜 ${GRADE_BANDS[i - 1].min - 1}`
                      : `${band.min} 〜 ${GRADE_BANDS[i - 1].min - 1}`}
                </td>
                <td className={TD}>{band.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SubHeading>この点数の読み方</SubHeading>
      <ul className="mt-1 space-y-1.5 text-[13px] leading-relaxed text-ink">
        <li>
          この点数は<strong className="font-bold">本ツール独自の技術チェック表</strong>の達成率です。検索順位・流入数・AI
          の回答に引用された回数を測ったものではなく、それらを予測するものでもありません。
        </li>
        <li>
          <strong className="font-bold">100 点を目指す必要はありません。</strong>
          満点は「機械的に判定できる項目をすべて満たした状態」であって、成果の最大値ではありません。優先度の低い項目を無理に埋めるより、
          該当する改善だけを選んで対応してください。
        </li>
        <li>
          根拠が確立していない項目（llms.txt の有無など）と、そのページに当てはまらない項目（FAQ の無いページの FAQPage、下層ページの
          WebSite、トップページのパンくずなど）は<strong className="font-bold">採点していません</strong>。本文も文字数ではなく、具体的な事実が書かれているかで判定します。
        </li>
        <li>
          サイト内検索の結果・カート・送信完了など、
          <strong className="font-bold">もともと検索に載せないページ</strong>
          （noindex や robots.txt でそのページだけを止めているもの）は、ページごと採点から外しています。説明文や本文が無くても問題にならないページで、平均点を下げるだけだからです。診断はしているので、付録 A に参考として一覧します。
        </li>
        <li>
          実際の成果は、Search Console の表示回数・検索語・インデックス状況、問い合わせなどの転換、主要 AI サービスからの参照、Core Web
          Vitals で確認してください。本レポートはそこに至る前段の技術的な土台を点検するものです。
        </li>
      </ul>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        表示速度は、診断サーバーが HTML を取得したときの応答時間と HTML の中身から判定した簡易的な目安で、画像やスクリプトを含めた実際の表示時間（Core
        Web Vitals）ではありません。被リンク・検索順位は含みません。JavaScript で描画される内容は取得時点の HTML に含まれない場合があります。
      </p>
      <p className="mt-1 text-[11px] text-muted">
        診断日時: <Num>{formatDateTimeSeconds(fetchedAt)}</Num> ／ 使用ツール: {BRAND.name}（SEO・AIO 無料診断）v
        <Num>{version}</Num>（ルールベース）
      </p>
    </ReportSection>
  );
}

/** 次のステップ。連絡先の環境変数が無ければブロックごと出さない（ダミーを出さない） */
export function NextSteps() {
  const name = process.env.NEXT_PUBLIC_CONTACT_NAME;
  const url = process.env.NEXT_PUBLIC_CONTACT_URL;
  if (!name && !url) return null;
  return (
    <section className="print-card mt-8">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-[14px] font-bold text-ink">次のステップ</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink">
          本レポートは無料診断版です。全ページの詳細診断や改善実装のご相談は下記まで。
        </p>
        <p className="mt-2 text-[13px] break-all">
          {name && <span className="font-bold text-ink">{name}</span>}
          {name && url && <span className="text-muted"> ／ </span>}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {url}
            </a>
          )}
        </p>
      </div>
    </section>
  );
}

/** レポート末尾の注記（会社名は入れない） */
export function ReportFooter() {
  return (
    <footer className="mt-8 border-t border-line pt-4">
      <p className="text-[11px] leading-relaxed text-muted">
        本レポートはルールベースの自動診断です。生成 AI による解釈は含まれておらず、同じページを診断すれば同じ結果になります。
        公開されている HTML・robots.txt・llms.txt・sitemap.xml のみを対象としており、被リンク・検索順位・実際の AI
        検索での引用状況は評価に含みません。表示速度は HTML の応答時間などから見た簡易的な目安です。スコアは本ツール独自の技術チェック表の達成率であり、検索順位・流入・AI
        の回答への引用を測ったものでも、それらを予測するものでもありません。点数の上昇は「技術的な変更をツールが認識した」ことを示すもので、
        成果そのものの証拠ではありません。実績の確認には Search Console の表示回数・検索語・インデックス状況、問い合わせの転換、Core Web
        Vitals をご利用ください。
      </p>
    </footer>
  );
}
