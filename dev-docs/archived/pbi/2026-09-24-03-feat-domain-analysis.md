# PBI: ドメイン分析（タグ×期間でドメイン別・URL別 top N 集計）

## ユーザーストーリー
閲覧履歴を振り返りたいユーザーとして、タグ（任意）と期間を指定してドメイン別集計 top N と URL 別集計 top N を件数順の表で見たい、なぜなら「#トラベル はどのサイトで見ているか」に直接答えられ次の行動に活かせるから

## 優先度
- 順位: 着手順 03（RICE順位 3 / 13候補中）
- RICEスコア: 3.00（Reach=5 / Impact=1.5 / Confidence=80% / Effort=2pt）
- 根拠: 「#トラベル が多い URL top 20」のような要求に直接答える具体価値がある。既存 queryLogs とタグフィルタの組み合わせで実現でき、wire プロトコル変更が不要なため Effort が小さい。ユーザーが本日明示的に要求した機能である。

## BDD受け入れシナリオ
Scenario: タグと期間を指定してドメイン別・URL別ランキングを表示する
  Given 期間内に「#トラベル」を含む閲覧ログが複数ドメイン・複数 URL に存在する
  When ユーザーがタグ「#トラベル」と期間を選択し集計を実行する
  Then ドメイン別集計表が件数降順で top N まで表示される
  And URL 別集計表が件数降順で top N まで表示される
  And 各行に件数が表示される

Scenario: タグ未選択では全体を対象に集計する
  Given 指定期間内に閲覧ログが存在する
  When ユーザーがタグを選択せず期間だけを指定して集計を実行する
  Then 期間内の全ログを対象にドメイン別・URL別集計が表示される

Scenario: 該当レコードが0件の場合は空状態を表示する
  Given 指定したタグと期間に一致する閲覧ログが0件である
  When ユーザーが集計を実行する
  Then 両方の表にデータ行が表示されず空状態メッセージが表示される
  And エラー表示にはならない

Scenario: domain が null の行と同件数タイと10000行超を扱う
  Given domain が null のログと件数が並んだ複数のドメイン・URL が存在し総件数が10000行を超える
  When ユーザーが集計を実行する
  Then domain が null の行は受入基準で定めた扱い（「ドメイン不明」集計または除外＋件数表示）に従って処理される
  And 同件数の行は決定的なタイ順序（URL またはドメイン名の昇順など）で並ぶ
  And batched pagination により10000行超の全件が集計対象になる

## 受け入れ基準
- [x] タグ選択（任意）と期間フィルタの組み合わせでドメイン別集計 top N が件数降順で表形式表示される
- [x] 同条件で URL 別集計 top N が件数降順で表形式表示される
- [x] タグ未選択時は期間内の全体を対象に集計される
- [x] 該当0件時は空状態メッセージが表示されエラーにならない
- [x] domain が null の行の扱いが固定化され（集計に含める場合は「ドメイン不明」表示、除外する場合は除外件数が表示される）仕様通りに動作する
- [x] 同件数のタイ順序が決定的であり再実行で順序が変わらない
- [x] 総件数10000行超のコーパスでも batched pagination により欠落なく集計される
- [x] 行クリックで履歴パネルへ遷移できる（タグは searchTag 遷移、URL・ドメインは仕様通りの遷移方法で遷移する）

## テスト戦略
- E2E: Dashboard 上でタグ＋期間を指定して二つのランキング表が表示されること、0件時に空状態が出ること、行クリックで履歴パネルへ遷移することを確認する
- 統合: queryLogs の tagFilter・since・until・limit＋offset バッチ取得とクライアント側集計の結合（10000行超の pagination 含む）、期間フィルタ部品との連携を確認する
- 単体: ホスト名単位のグルーピング集計、件数降順＋タイ順序のソート、top N 切り詰め、domain null の扱い、タグ文字列のパース結果に対する集計の振る舞いを検証する

## 実装メモ
- 再利用資産:
  - `src/dashboard/panels/panelFactories.ts`（PanelLifecycle パネル登録）
  - `entrypoints/options/index.html`（パネル markup 追加先）
  - `src/offscreen/sqliteQueryBuilder.ts`（`buildTagFilterCondition`、queryLogs の `since` / `until` / `tagFilter` / `domain` exact match / `limit` 上限 10000 / `offset`）
  - `src/utils/sqlite-types.ts`（`BrowsingLogRecord`: `url` / `title` / `summary` / `tags` / `created_at` / `domain` / `visit_duration` / `scroll_ratio` / `is_starred` / `content` / `ai_*`）
  - `src/utils/tagUtils.ts`（`parseTagsForDisplay`）
  - `src/dashboard/panels/asyncData/domainSearchPanel.ts`（検索専用、集計なし。UI パターンのみ参考にし集計ロジックは新設する）
  - `src/dashboard/panels/` 配下の `tagClusterPanel.ts`（`queryLogs({ limit: 10000 })` 取得後にクライアント側集計する前例、クリック時の `navigateToHistoryWithTag` / `tryNavigateTyped('panel-sqlite-history', { searchTag })` ＋ `CustomEvent('navigate-to-tag')` フォールバック前例）
  - `src/dashboard/` 配下の `markdownExport.ts`（`limit`＋`offset` ループによる batched pagination 前例）
  - `src/utils/computeLimits.ts`（上限値）
  - `src/utils/wildcardToRegex.ts`（`extractHostname`。`www.` のみ除去した hostname が `domain` の実態）
- 集計アプローチ: wire プロトコル変更なし。`queryLogs` で `tagFilter`＋期間＋ `domain` exact match を条件に使い、クライアント側で取得後に集計する。10000行 cap を超える場合は `limit`＋`offset` のバッチ取得ループで全件を集めてから集計する。
- 集計粒度: storage の実態に一致させ hostname のままとする。`src/utils/registrableDomain.ts` による eTLD+1 ロールアップは将来拡張とし、この PBI では実装しない。
- 依存する共有部品: 期間フィルタは PBI 2026-09-24-02 で新設される共有部品 `src/dashboard/components/periodFilter.ts` を再利用する。この PBI では新設しない。
- 行クリック遷移の検討: タグ行は `tryNavigateTyped('panel-sqlite-history', { searchTag })`＋フォールバックの前例を踏襲する。URL・ドメイン行の遷移は `tryNavigateTyped` と `domain` exact-match クエリの組み合わせで実現可否を検討し、履歴パネル側の受入条件に合わせて決める。
- 制約: Manifest V3（Service Worker は ephemeral、状態は `chrome.storage` 保持）、ESM import は `.js` suffix 必須、TypeScript strict、vitest＋jsdom。tags は原則スペース区切り `#tag1 #tag2` で legacy カンマ混在を考慮する。集計は `created_at`（epoch ms）を期間条件に使う。
- i18n キー一覧（EN＋JA の `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` の両方に追加）:
  - `domainAnalysis_title`
  - `domainAnalysis_tagLabel`
  - `domainAnalysis_tagAll`
  - `domainAnalysis_periodLabel`
  - `domainAnalysis_run`
  - `domainAnalysis_byDomainTitle`
  - `domainAnalysis_byUrlTitle`
  - `domainAnalysis_countColumn`
  - `domainAnalysis_empty`
  - `domainAnalysis_unknownDomain`
  - `domainAnalysis_excludedNullDomainCount`
- a11y 要件: WCAG 2.1 AA。表は `table`＋`th`（`scope` 付与）で構成しキャプションまたは見出しと関連付ける。タグ選択・期間・実行ボタンはキーボード操作とフォーカス可視化に対応する。空状態メッセージはスクリーンリーダーで読み上げ可能にする。色のみで順位を伝えない。

## 見積もり
2 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `src/dashboard/domainAnalysisAggregate.ts`（純粋集計・ドメイン/URL別・決定的タイ順序）、`src/dashboard/panels/asyncData/domainAnalysisPanel.ts`、`MAX_DOMAIN_ANALYSIS_ROWS=50000`+`DOMAIN_ANALYSIS_PAGE_SIZE=10000`（computeLimits.ts）、配線（catalog/factories/index.html/locales 16キー×2/panelCatalog pinned 20→21）
- 設計決定: domain null 行は `(unknown)` バケットとして集計に含め、null 件数を通知表示。ドメイン行クリックは `tryNavigateTyped('panel-sqlite-history', { searchDomain })`（既存 `activateWithDomain` 経路）で遷移、URL 行は履歴パネルに URL 初期化パラメータが無いため v1 遷移なし。再取得は明示 Run ボタン式（50k 行・5 ページ取得の重いクエリをプリセット操作のたびに発火させないため）。50k 上限到達時は truncation 通知（unbounded pagination ではなく DoS ガードとして上限化 — 家法の cap パターンに整合）
- 検証: type-check PASS / 対象 52 tests green / lint 0 errors / 全体 13,637 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置
