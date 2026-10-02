# サイト健診

URL を入れるだけで、検索エンジンと AI 検索（AIO）に読まれる土台をルールベースで採点する Next.js アプリです。総合スコアと改善提案を報告書にまとめ、PDF で持ち帰れます。

基本のサイト診断は **API キーもログインも不要**で、そのまま公開して使えます。生成 AI は使いません。GA4・Search Console連携と定期監視は任意機能で、設定しなければ基本診断だけが動きます。

```bash
npm install
cp .env.example .env.local   # 診断だけなら設定不要
npm run dev                  # http://localhost:3000
```

サービスの呼び名（表示名・説明文）は `src/lib/brand.ts` が唯一の定義です。名前を変えるときはこのファイルだけを直せば、画面・メタデータ・PWA マニフェスト・PDF の奥付すべてに伝わります。

---

## 画面と API

管理画面の形で、左のサイドバーに機能ごとのタブを並べています（`src/components/shell/nav.ts` が唯一の定義。スマホでは上部の「メニュー」から開きます）。

| タブ | パス | 内容 |
|---|---|---|
| サイト診断 | `/` | サイト診断（SEO・AIO） |
| ダッシュボード | `/monitor` | 監視サイト数・平均スコア・リンク切れ・未読の通知の集計と、監視サイトの一覧 |
| サイト追加 | `/monitor/new` | 監視するサイトの登録（登録後はそのサイトの詳細へ） |
| リンク切れ | `/monitor/links` | 全監視サイトの最新のリンク切れ |
| 診断履歴 | `/monitor/runs` | 全サイトの診断の記録（サイト・結果で絞り込み） |
| 通知 | `/monitor/alerts` | ツール内の通知（未読 / すべて）。タブに未読数のバッジ |
| システム構成 | `/system` | 構成図、連携API・サービス、内部API、再現手順、更新ルール |
| 設定 | `/settings` | 保存先の接続・ログイン・Cron・上限などの状態（値そのものは表示しない） |

| パス | 内容 |
|---|---|
| `/api/site` | サイト全体の診断（進捗を配信しながらクロール） |
| `/monitor/sites/[id]` | 監視サイトの詳細（スコアの推移・リンク切れ・通知・診断の記録・設定） |
| `/monitor/runs/[id]` | 保存した 1 回分の診断レポート（前回との比較つき） |
| `/api/monitor/sites/[id]/run` | 監視サイトを今すぐ診断して記録する |
| `/api/monitor/alerts/unread` | 未読の通知数（サイドバーの「通知」タブのバッジ） |
| `/api/cron/monitor` | 定期診断（Vercel Cron が呼ぶ） |
| `/api/automation/seo-report` | サイト診断・GA4・GSCを統合するCodex向けAPI（Bearer認証） |

---

<!-- SYSTEM_ARCHITECTURE:START -->
## システム構成（自動生成）

この節は `src/data/system-architecture.json` から生成しています（構成情報の更新日: 2026-10-02）。画面の「システム構成」タブも同じデータを表示します。

```text
手動サイト診断: 利用者 → Next.js画面 → POST /api/site → 診断対象サイト
定期監視: Vercel Cron → GET /api/cron/monitor → 診断エンジン → Postgres
SEO自動分析: Codex → POST /api/automation/seo-report → Vercel OIDC / Google WIF → GA4 + GSC
開発・公開: Codexクラウド環境 → GitHub main → Vercel Build → 本番ツール
```

### 連携API・サービス

| API / サービス | 分類 | 用途 | 認証 | 状態 | 設定 |
|---|---|---|---|---|---|
| GitHub<br>sage-del/HP-Checker-sage | ソース管理 | ソースコード・README・変更履歴の保管 | GitHub認証 | 稼働中 | `main branch` |
| Vercel<br>Hosting / Build / Cron / OIDC | 実行基盤 | Next.jsのビルド・公開、定期実行、Google向け短期OIDCトークンの発行 | GitHub連携・Vercel OIDC | 稼働中 | `VERCEL_OIDC_TOKEN（自動設定）` |
| Google Analytics Data API<br>analyticsdata.googleapis.com | 分析データ | 自然検索のセッション、エンゲージメント、ランディングページを取得 | Google Workload Identity + サービスアカウント | 環境変数の設定待ち | `GA4_PROPERTY_ID`<br>`GOOGLE_SERVICE_ACCOUNT_EMAIL`<br>`GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` |
| Google Search Console API<br>searchconsole.googleapis.com | 検索データ | 検索語句・ページ別のクリック、表示、CTR、平均掲載順位を取得 | Google Workload Identity + サービスアカウント | 環境変数の設定待ち | `GSC_SITE_URL`<br>`GOOGLE_SERVICE_ACCOUNT_EMAIL`<br>`GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` |
| Google Security Token Service API<br>sts.googleapis.com | 認証 | Vercel OIDCトークンをGoogleの短期認証情報へ交換 | OIDC / OAuth 2.0 Token Exchange | 疎通確認待ち | `GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` |
| IAM Service Account Credentials API<br>iamcredentials.googleapis.com | 認証 | サービスアカウントの短期アクセストークンを発行 | Workload Identity Federation | 疎通確認待ち | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| PostgreSQL<br>Neon / Supabase / Vercel Postgres等 | データ保存 | 定期監視サイト、診断履歴、リンク切れ、通知を保存 | 接続文字列（サーバー側のみ） | 任意機能 | `DATABASE_URL` |
| 診断対象Webサイト<br>HTTP / HTTPS | 診断入力 | 公開HTML、robots.txt、sitemap、内部リンクを取得して診断 | なし（公開URLのみ） | 稼働中 | `SITE_MAX_PAGES`<br>`ALLOW_PRIVATE_HOSTS（開発時のみ）` |

### 内部API

| Method | Path | 用途 | 認証 |
|---|---|---|---|
| POST | `/api/site` | サイト全体をクロールし、進捗と診断結果を配信 | 任意のサイト全体Basic認証 |
| POST | `/api/automation/seo-report` | 技術診断・GA4・GSCを統合したSEOレポート | AUTOMATION_API_KEY（Bearer） |
| GET | `/api/cron/monitor` | 期限の来た監視サイトを定期診断 | CRON_SECRET（Bearer） |
| POST | `/api/monitor/sites/[id]/run` | 指定した監視サイトを今すぐ診断 | サイト全体Basic認証 |
| GET | `/api/monitor/alerts/unread` | 未読通知数を取得 | サイト全体Basic認証 |

### 再現手順

1. GitHubのmainブランチを取得し、npm installを実行する。
2. .env.exampleを.env.localへコピーし、使う機能の環境変数だけを設定する。
3. GA4/GSC連携ではGoogle API、サービスアカウント、Workload Identity、各プロパティ権限を設定する。
4. npm run docs:system:check、npm run lint、npm run typecheck、npm test、npm run buildで検証する。
5. GitHub mainとVercelを接続し、本番用環境変数を設定してデプロイする。

### 更新ルール

- 外部サービス、API、認証方式、環境変数、主要データフローを変更したら、このJSONを同じ変更で更新する。
- READMEの自動生成範囲は直接編集せず、npm run docs:systemで更新する。
- npm run docs:system:checkを実行し、JSONとREADMEのずれがないことを確認する。
- APIキー、パスワード、接続文字列、JSON秘密鍵などの秘密値はJSON・README・画面へ保存しない。
- 本番反映前にlint、typecheck、test、buildを実行し、変更した連携の疎通も確認する。
<!-- SYSTEM_ARCHITECTURE:END -->

---

## 診断（`/`）

判定はすべてルールベースで、生成 AI は使っていません。

### 診断の範囲

診断はつねに**サイト全体（全ページ）**です。入力した URL を起点に、sitemap（索引の再帰展開）と内部リンクの幅優先探索でサイトの全ページを収集して診断します。範囲を選ぶボタンは無く、入力するのは URL だけです。

診断は進捗を配信しながらクロールし、取得数 / 発見数・現在の URL・経過時間を表示します。途中で中止できます。上限は `SITE_MAX_PAGES`（既定・最大とも 100）と時間予算で制御します。

### レポートの構成

表紙（サイト名・対象 URL・診断範囲・日時・所要時間・診断ページ数・グレード印）に続いて

1. **総合評価** — ドーナツ、A〜E のグレード、3 行の講評、優先改善 TOP3（見込み効果つき）、判定数の内訳
2. **カテゴリ別スコア** — 横棒グラフ（50 / 80 の目盛）と配点・最低〜最高の表
3. **判定の内訳とページ別スコア分布** — ドーナツとヒストグラム
4. **ページ × カテゴリ 一覧** — スコアで色分けしたヒートテーブル（低い順）
5. **改善提案** — 全ページ共通の問題 / ページによって差がある項目
6. **前回の診断からの変化** — 同じブラウザに前回の結果があるときだけ
7. **付録** — 診断ページ一覧、採点から外したページ、配点と判定基準、クロール統計

講評と優先度は `src/lib/report/summary.ts` の純関数で導出しています（生成 AI 不使用）。

### 採点

| カテゴリ | 重み | 見るもの |
|---|---|---|
| AI クローラ可否 | 15 | robots.txt での**検索用**クローラ（OAI-SearchBot / PerplexityBot / Claude-SearchBot など）の可否、noindex（サイト内検索の結果・カート・送信完了など、索引に載せないのが通例のページは対象外） |
| 構造化データ | 15 | JSON-LD の有無と文法、Organization / sameAs、BreadcrumbList（下層ページのみ）、WebSite（トップのみ）、FAQPage（FAQ のあるページのみ） |
| メタ情報 | 10 | title、meta description（長さ）、OGP、canonical、lang |
| 見出し | 10 | h1 がちょうど 1 つか、h2 / h3 の階層が飛んでいないか |
| コンテンツ | 15 | 具体的な情報（数値・日付・組織名・連絡先）の含有、見出しに本文が伴うか、画像の alt、JS 描画依存（SPA）の疑い |
| 信頼性 | 10 | 会社概要・プライバシーポリシーへのリンク、会社情報（社名・電話番号・郵便番号）の一致（構造化データと画面表記の間、**サイト内のページ間**） |
| 問い合わせ導線 | 10 | 問い合わせページへのリンク・問い合わせフォーム・tel: / mailto: があるか、画面の電話番号がタップで発信できるか |
| 表示速度 | 5 | 診断サーバーから見た応答時間（0.8 秒以下で合格・1.8 秒超で重大）、HTML の大きさ、head で表示を止めるスクリプトの数、画像の width / height 指定 |
| セキュリティ | 5 | HTTPS 配信、https のページへの http の読み込みの混在（HSTS は情報のみ） |
| モバイル対応 | 5 | viewport 指定、拡大表示を禁止していないか |

会社情報の一致は、まずページ内（構造化データと、ヘッダー・フッター・address の表記）で判定し、サイト診断では全ページの多数派（2 ページ以上に載っている値のうち最多のもの）と比べ直します（`src/lib/analyzer/trust.ts` / `site.ts`）。本社と支店の番号の併記のように、多数派の値を含んでいれば食い違いにしません。

表示速度は外部の計測 API を使わない簡易的な目安です。画像やスクリプトまで読み込んだ実際の表示時間（Core Web Vitals）ではなく、診断サーバーの設置場所（Vercel のリージョン）からの距離も応答時間に含まれます。

**もともと検索に載せないページは採点しません。** サイト内検索の結果・カート・ログイン・送信完了・印刷用ページなどを noindex や robots.txt で止めるのは正しい運用で、説明文や本文が無くても問題になりません。これらを採点に混ぜると直しようのない減点でサイト全体の平均だけが下がるため、URL の形（`/search`、`?s=…`、`/cart`、`/thanks` など）で判別して採点から外し、付録 A に参考として一覧します。判別は URL だけを見るので、方針で分かれるページ（記事一覧・タグページなど）は外しません。robots.txt がサイト全体を止めている場合も、サイトの問題として今まで通り減点します。

各項目は 合格（満点）/ 警告（半分）/ 重大（0 点）で採点し、情報は採点対象外です（コード上は pass / warn / fail / info）。配点は `src/lib/analyzer/types.ts` の `CATEGORY_WEIGHTS` と各 `check({ weight })` で変えられます。

スコアはこのツール独自の技術チェック表の達成率です。検索順位・流入・AI の回答への引用を測るものではなく、それらを予測するものでもありません。

### 具体性の測り方（多言語対応）

コンテンツの「具体的な情報があるか」は文単位で数えます。句点を持たない言語のページを 1 文と数えてしまわないよう、文の割り方は言語ごとに変えます（`src/lib/analyzer/sentences.ts`）。

- **言語の決め方** — `<html lang>` → 要素の `lang` → 文字種（かな・漢字の比率）の順。ブロックごとに切り替えるので、日本語のページに英語の引用が混ざっても壊れません
- **文の区切り** — 日本語は `。！？`、英語などは `. ! ?` ＋空白／行末。略語（Inc. Ltd. No. Mr.）・頭字語（U.S. A.I.）・小数（1.5）・桁区切り（33,000）・URL・メールアドレスでは区切りません
- **ブロックは最小単位** — 句読点の無い箇条書き（li）・表のセル・見出しは、それぞれ 1 文として数えます
- **事実の合図** — 半角／全角の数字と単位、通貨（円・¥・yen・JPY）、日付（2026 年 4 月 18 日 / November 6, 2024 / 2026-04-18）、法人格（株式会社 / Inc. / Co., Ltd.）、連絡先（〒・電話・メール・URL）、割合（%）を日英どちらの書き方でも拾います
- **分母が小さいときは比率で減点しない** — 総文数 5 文以上なら比率（具体情報 10% 以上かつ 2 文以上で合格）、5 文未満なら絶対数（3 文以上で合格。1〜2 文は「測定不能」として減点しない）
- **判定根拠を出す** — レポートには総文数・比率・使ったしきい値・判定に使った言語・具体情報と判定した文の実例 3 件を載せます

### 出力

- **課題一覧（CSV）** — 重大 → 警告 → 情報の順に「課題 × ページ」を 1 行ずつ出します（重要度・カテゴリ・項目・配点・ページ URL・根拠・対応方法）。Excel で開けるよう BOM 付き UTF-8 です（`src/lib/report/csv.ts`）
- **前回の診断からの変化** — 同じブラウザで同じサイトを再診断すると、総合スコア・重大 / 警告 / 情報の件数・カテゴリ別スコアの増減と、解消した課題・新たに見つかった課題をレポートに載せます。前回の結果はサーバーではなく**診断した人のブラウザ（localStorage）**にサイトごとに要約だけ残すため、別の端末・別のブラウザでは比較が出ません（`src/lib/report/history.ts`）
- **PDF でダウンロード** — 画面をブラウザ内で A4 の PDF にします（画像なので文字は選択できません）
- **印刷** — 印刷ダイアログから「PDF に保存」を選ぶと、文字を選択・検索できる PDF になります

---

## 定期監視（`/monitor`）

登録したサイトを決まった頻度（毎日 / 毎週）で自動診断し、**前回より悪くなったときにツール内で通知**します。Slack やメールなどの外部サービスには送りません。サイドバーの「通知」タブに未読の数が出ます。

### 通知の出し方

前回の診断と比べて、変化があったときだけ通知します（`src/lib/monitor/alerts.ts`）。変化が無ければ通知は 0 件です。

| 重要度 | 出る条件 |
|---|---|
| 重大 | サイトを診断できなくなった（続けて失敗している間は最初の 1 回だけ） / 重大な問題が新たに出た / リンク切れが新たに出た |
| 警告 | 総合スコアが 5 点以上下がった / 警告が新たに出た |
| お知らせ | 初回の診断 / 診断が再開できた / 問題が解消した・スコアが 5 点以上上がった |

### リンク切れの検出

定期監視の診断では、採点に加えて**サイト内のリンク切れ**（ページへのリンク・画像・CSS・JavaScript）を確かめます（`src/lib/links/`）。

- 対象は同じサイト内の参照だけです。外部サイトへのリンクは確かめません
- クロールで取得済みのページはそのステータスを使い、それ以外（画像・PDF・上限で取得しなかったページなど）に HEAD を送ります（受け付けないサーバーには GET）。1 回あたり 300 件・45 秒まで
- 404 / 410 / 5xx / 接続できない、をリンク切れとします。401 / 403 / 429 は「見せない・混んでいる」の意味でリンク先が無いとは限らないので数えません
- リンク切れは採点には入れません（無料診断のスコアは変わりません）

### 保存するもの

保存先は Postgres です（`DATABASE_URL`。テーブルは初回に自動で作ります）。診断レポート本体はサイトごとに直近 20 回分だけ残し、それより古い回はスコアの推移に使う要約だけにします。要約は 400 回分（毎日で 1 年強）まで残します。

### 定期実行のしくみ

`vercel.json` の Cron が毎日 18:00 UTC（日本時間 3:00）に `/api/cron/monitor` を呼びます。期限の来たサイトを、最後の診断が古い順に 1 つずつ診断し、1 回の呼び出し（最大 300 秒）で終わらなかったサイトは次の呼び出しに回します。登録サイトが多い・大きいサイトがある場合は、Vercel Pro で Cron を 1 時間ごと（`0 * * * *`）にすると取り残しが減ります（Hobby プランの Cron は 1 日 1 回まで）。

### セットアップ（Vercel）

1. Postgres を用意する（Vercel の Storage から Neon を追加する、または Supabase の接続文字列を使う）
2. Vercel の環境変数に `DATABASE_URL`・`BASIC_AUTH_PASSWORD`・`CRON_SECRET` を設定する
3. デプロイし、`/monitor` からサイトを登録する。「今すぐ診断」で 1 回目を取っておくと、翌日から前回比較の通知が出ます

### アクセス制限

`BASIC_AUTH_PASSWORD` を設定すると**サイト全体**に Basic 認証が掛かります（`src/proxy.ts`。ユーザー名は `BASIC_AUTH_USER`、既定 `admin`）。監視機能を本番で有効にしているのにパスワードが無いときは、診断の記録を誰でも見られる状態にしないよう `/monitor` と `/api/monitor` を 503 で止めます。`/api/cron/*` は Basic 認証の対象外で、`CRON_SECRET` で呼び出し元を確かめます。

---

## 環境変数

`.env.example` を `.env.local` にコピーして設定します。キーはすべてサーバー側でのみ読み、ブラウザには渡しません（`NEXT_PUBLIC_` の付いたものを除く）。

| 変数 | 要否 | 用途 |
|---|---|---|
| `SITE_MAX_PAGES` | 任意 | 1 回の診断で見るページ数の上限（既定・最大とも 100） |
| `NEXT_PUBLIC_APP_VERSION` | 任意 | フッターのバージョン表記 |
| `NEXT_PUBLIC_CONTACT_NAME` / `NEXT_PUBLIC_CONTACT_URL` | 任意 | レポート末尾「次のステップ」に出す運営元の連絡先 |
| `DATABASE_URL` | 監視で必須 | 定期監視の保存先（Postgres の接続文字列）。未設定なら監視機能は出ない |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | 監視で必須 | サイト全体の Basic 認証（ユーザー名の既定は `admin`） |
| `CRON_SECRET` | 監視で必須 | Vercel Cron の呼び出しを確かめる合言葉。本番で未設定だと定期診断は動かない |
| `ALLOW_PRIVATE_HOSTS` | 開発用 | localhost や LAN 内のサイトを診断したいときだけ `1`。**本番では絶対に設定しない** |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Vercel自動化で必須 | Workload Identityから利用するサービスアカウント |
| `GOOGLE_WORKLOAD_IDENTITY_AUDIENCE` | Vercel自動化で必須 | GoogleのWorkload Identityプロバイダ完全名 |
| `VERCEL_OIDC_TOKEN` | Vercelが自動設定 | Vercelが実行ごとに発行する短時間のOIDCトークン。手動登録しない |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ローカル開発用 | JSON鍵が許可される環境だけで使う代替方式。本番では不要 |
| `GA4_PROPERTY_ID` | 自動化で必須 | GA4の数字のプロパティID（測定IDではありません） |
| `GSC_SITE_URL` | 自動化で必須 | `sc-domain:example.com` またはURLプレフィックス |
| `AUTOMATION_API_KEY` | 自動化で必須 | 自動化APIを保護するランダムなBearerキー |
| `HP_CHECKER_BASE_URL` | Codexで必須 | デプロイしたツールのURL |
| `HP_CHECKER_API_KEY` | Codexで必須 | `AUTOMATION_API_KEY`と同じ値をCodex側に設定 |
| `SEO_TARGET_URL` | 任意 | Codexが診断する既定URL |

---

## GA4・Search Console・Codex 自動化

自社サイトだけを無人実行する用途では、Googleのサービスアカウントを使います。Vercel本番環境ではWorkload Identity連携を使用し、長期間有効なJSON秘密鍵は保存しません。利用者のGoogleログイン操作は不要です。手動診断の画面と `/api/site` は、Google連携を設定しなくても従来どおり動きます。

### Google側の準備

1. Google Cloudでプロジェクトを作り、**Google Analytics Data API**、**Google Search Console API**、**IAM Service Account Credentials API** を有効にします。
2. サービスアカウントを作成します。JSONキーは発行しません。
3. GA4の「管理 → プロパティのアクセス管理」で、サービスアカウントのメールアドレスを**閲覧者**として追加します。
4. Search Consoleの「設定 → ユーザーと権限」で、同じメールアドレスを**フルユーザー**として追加します。
5. Google CloudでVercelチームを発行元とするWorkload IdentityプールとOIDCプロバイダを作り、Vercel本番環境の`subject`だけにサービスアカウントの利用を許可します。
6. Vercelのプロジェクト設定で次をProduction環境変数へ追加し、再デプロイします。`VERCEL_OIDC_TOKEN`はVercelが自動設定します。

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL=hp-checker-sage@project-id.iam.gserviceaccount.com
GOOGLE_WORKLOAD_IDENTITY_AUDIENCE=//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel-hp-checker/providers/vercel
GA4_PROPERTY_ID=123456789
GSC_SITE_URL=sc-domain:example.com
AUTOMATION_API_KEY=十分に長いランダム値
```

`GA4_PROPERTY_ID` は `G-XXXXXXXXXX` 形式の測定IDではなく、GA4管理画面の「プロパティ設定」にある数字です。`AUTOMATION_API_KEY` は `openssl rand -hex 32` などで生成できます。ローカル開発では従来の`GOOGLE_SERVICE_ACCOUNT_JSON`も利用できますが、Workload Identityが設定されている本番環境では不要です。

### API

```bash
curl -X POST "https://hp-checker-sage.vercel.app/api/automation/seo-report" \
  -H "Authorization: Bearer $HP_CHECKER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.example.com","maxPages":50}'
```

期間を省略すると前日までの28日間を取得します。応答には次が含まれます。

- `audit` — このツールによる技術診断と改善項目
- `ga4` — 自然検索のセッション、エンゲージメント、ランディングページ
- `gsc` — 検索語句・ページ別のクリック、表示、CTR、平均掲載順位
- `opportunities` — 3つのデータを優先順位付きで統合した改善候補

### Codexから実行

Codexのクラウド環境に `HP_CHECKER_BASE_URL`、`HP_CHECKER_API_KEY`、必要なら `SEO_TARGET_URL` を設定します。その後は次のコマンドを実行できます。

```bash
npm run seo:report -- --url "https://www.example.com"
npm run seo:report -- --url "https://www.example.com" --start-date 2026-09-01 --end-date 2026-09-30
```

リポジトリの `AGENTS.md` にこの手順を記載しているため、Codexへ「example.comのSEOレポートを作成して」と指示すると、このAPIを使う前提で作業します。

### 導入状況

- [x] Google Analytics Data APIとGoogle Search Console APIを有効化
- [x] サービスアカウントを作成し、GA4へ閲覧者、Search Consoleへフルユーザーとして追加
- [x] Vercel本番環境だけを許可するWorkload IdentityプールとOIDCプロバイダを作成
- [x] JSON秘密鍵を使わないVercel OIDC認証をアプリに実装
- [ ] VercelへGoogle識別子、GA4/GSC識別子、`AUTOMATION_API_KEY`を登録して再デプロイ
- [ ] Codex環境へ`HP_CHECKER_API_KEY`を登録して設定を公開
- [ ] `npm run seo:report -- --url "対象サイトURL"`で実データ接続を確認

サービスアカウントのJSONキーやAPIキーは、README・GitHub・チャットには保存しません。

---

## コマンド

```bash
npm run dev        # 開発サーバー
npm run build      # 本番ビルド
npm run start      # 本番サーバー
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run docs:system        # 構成JSONからREADMEを更新
npm run docs:system:check  # 構成JSONとREADMEのずれを検出
npm test           # vitest（判定ロジックの単体テスト）
# 本番と同じ postgres ドライバーでの保存も確かめるとき（空のデータベースを指定する。テーブルを作り直す）
TEST_DATABASE_URL=postgres://... npm test
```

---

## 構成

```
src/
  app/
    page.tsx            # サイト診断（SEO・AIO）
    api/site/           # サイト診断（Route Handler、nodejs runtime）
    monitor/            # 定期監視の画面（ダッシュボード・サイト追加・リンク切れ・診断履歴・通知）とサーバーアクション
    system/             # システム構成・連携API・再現手順（構成JSONを表示）
    settings/           # 設定の確認画面
    api/monitor/ api/cron/monitor/  # 今すぐ診断・未読数・定期診断
  proxy.ts              # Basic 認証（旧 middleware）
  components/
    free/               # 診断の画面とレポート
    monitor/            # 定期監視の画面部品（今すぐ診断・集計カードなど）
    ui/ charts/ shell/  # 共通部品・依存なしの SVG グラフ・シェル（サイドバー / フッター）
  lib/
    analyzer/           # 判定ルール（fetch.ts の assertPublicHost + fetchText が唯一の取得経路）
    crawl/              # 全ページクロール（sitemap 展開 + 内部リンク BFS）
    report/             # レポートの導出（グレード・講評・優先改善）
    pdf/                # レポートの PDF 化（html2canvas + jsPDF）
    links/              # リンク切れの検出（参照の抽出・ステータス確認）
    monitor/            # 定期監視（保存・スケジュール・通知の導出・認証）
    system/             # 構成JSONの型と表示用ラベル
    brand.ts            # サービスの呼び名（唯一の定義）
    ui/                 # 色トークンの単一定義（palette.ts / grade.ts）
```

### 設計上の約束

- **ユーザーが入れた URL をサーバーで取得するときは、必ず `assertPublicHost` → `fetchText`（`src/lib/analyzer/fetch.ts`）を通す。** リダイレクトは自分で追い、初回のホップを含めて毎回ホストを検査します（SSRF 対策）。
- **色は `src/lib/ui/palette.ts` と `globals.css` の `@theme` トークンだけ**から取ります。JSX に生の hex は書きません。
- **データを捏造しない。** 測れなかった項目は「未取得」として扱い、0 や「なし」と混同しません。
- 判定ロジックは純関数として `src/lib/**` に置き、`__tests__` でテストします。
- **連携API・サービス・認証・環境変数・主要フローを変えるときは `src/data/system-architecture.json` も更新し、`npm run docs:system` を実行します。** READMEの自動生成範囲と「システム構成」タブは同じデータを使います。

---

## OEM（ホワイトラベル）前提

**画面から外部サイトへ出るリンクは 1 つも置きません。** 提供元を利用者に見せないためで、次を守ってください。

- サイドバー・フッター・診断フォーム・レポートに外部リンクを足さない
- 診断対象サイトへ送る User-Agent（`src/lib/analyzer/fetch.ts` の `USER_AGENT`）に、提供元が特定できる URL やリポジトリ名を入れない。相手のアクセスログに残ります
- 画面に出る唯一の外部向け連絡先は `NEXT_PUBLIC_CONTACT_NAME` / `NEXT_PUBLIC_CONTACT_URL`。**運営元自身のもの**を設定してください（未設定なら、そのブロックごと表示されません）

---

## 入っていないもの

- ログイン（Clerk）・課金（Stripe）。アクセス制限は Basic 認証だけで、利用者ごとのアカウントはありません
- `/tools/*` のツール群、`/settings`、`/admin`
- 外部サービスへの案内ページ（`/plans`・`/sign-up`）
- サービス資料の PDF（機能一覧・料金プランの掲載）
- MEO（Google マップ・店舗情報）の診断 — 扱いません
- 生成 AI を使う機能（想定 FAQ の下書きなど）— 採点も講評もすべてルールベースで、外部の AI API は呼びません
- 1 ページだけの診断 — 診断はつねにサイト全体（全ページ）です
- 利用規約・プライバシーポリシー・特商法表記のページ（**公開して使う場合はご自身で用意してください**）

---

## 既知の制限

- **JavaScript で描画されるページ（SPA）** は取得した HTML に本文が無いため低スコアになります。代わりに「JS 描画依存の可能性」として警告を出します。
- **キャッシュと回数制限はプロセス内**です。サーバーレスではインスタンスごとに独立します。
- 対象サイトには `SiteKenshin/0.1` の User-Agent でアクセスします。
- 「今すぐ診断」の二重実行の防止は同じサーバーインスタンス内だけです。

---
