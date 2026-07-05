# 設計: 週次/月次サマリのローカルMarkdown出力 + 統計セクション

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 関連PBI: `dev-docs/plans/2026-07-04-01-feat-weekly-review-summary.md`（本設計に合わせて改訂する）
- 関連実装済みPBI: `dev-docs/plans/2026-07-04-07-feat-local-markdown-export.md`（出力機構を再利用）

## 背景

既存PBIは「Obsidian週次ノートへの追記」を前提としていたが、Obsidian Local REST API未導入でも使える形に変更する。あわせて、記録履歴ページに個別ページ単位で表示されている統計情報（トークン数・コンテンツ抽出削減率・AI要約クレンジング削減率など）を期間集計として活用したいという要望があり、同じサマリファイルに統合する。

## スコープ

1. 週次/月次のダイジェスト（メタ要約）をローカルMarkdownファイルとして出力する
2. 同じファイル内に、対象期間の処理統計セクションを追加する
3. Obsidian連携（Local REST APIへの追記）は行わない

範囲外: ダッシュボードでの統計可視化（グラフ等）、SQLite/OPFSストアへの移行（別途進行中の`[SQLite Persistence Goal]`と独立）。

## 出力先とファイル命名

- 週次: `~/Downloads/Yasumaro/YYYY-week-NN.md`（`NN`はISO 8601週番号、01-53）
- 月次: `~/Downloads/Yasumaro/YYYY-month-NN.md`（`NN`は月番号、01-12）
- 出力先フォルダは既存の`local_markdown_export_path`設定（デフォルト`'Yasumaro'`）と同一階層を使う
- 出力手段は既存の`chrome.downloads` + `conflictAction: 'overwrite'`パターン（`saveLocalMarkdownStep.ts`）を踏襲する新規ステップとして実装する

## 発火タイミング

- **週次**: 翌週月曜日にYasumaroが最初に動作したタイミングで自動生成
- **月次**: 翌月初日にYasumaroが最初に動作したタイミングで自動生成
- **手動生成**: ダッシュボードに週次/月次それぞれの手動生成ボタンを用意する
- 二重生成防止のため、`chrome.storage.local`に直近生成済みの週番号・月番号を保持し、同一周期に対する自動生成は1回のみ行う
- Service Workerはステートレスなため、起動時（`chrome.alarms`または既存の起動フック）に「前回生成済み週/月」と現在の週/月を比較する方式とする。既存の`sessionAlarmsManager.ts`のalarmsパターンを参考にする

## ダイジェスト生成方式（メタ要約）

- 対象期間内の`SavedUrlEntry.aiSummary`（各ページの既存AI要約）を集約し、既存AIクライアント（`aiClient`系）に渡して期間の振り返り文章を新規生成する
- 新規のAI要約ロジックや別プロバイダ統合は行わない。既存の設定済みAIプロバイダ・モデルをそのまま使う
- 対象期間の履歴が0件の場合は、AI呼び出し・ファイル生成の両方をスキップする（空サマリを作らない、エラーにしない）

## 統計セクション

ダイジェスト本文とは別のMarkdownセクションとして、対象期間の以下を集計して追加する。集計元は`SavedUrlEntry`の既存フィールドで、専用の集計ストレージは持たず、生成のたびに都度計算する。

- 合計送信トークン数 / 合計受信トークン数（`sentTokens` / `receivedTokens`の合計）
- 平均処理時間（`aiDuration`の平均）
- コンテンツ抽出: 合計削減バイト数、平均削減率（`pageBytes`→`candidateBytes`、または`originalBytes`→`cleansedBytes`から算出）
- AI要約クレンジング: 合計削除要素数、平均削減率（`aiSummaryCleansedElements`、`aiSummaryOriginalBytes`→`aiSummaryCleansedBytes`）
- AIプロバイダ/モデル別の内訳（`aiProvider` / `aiModel`でグルーピングした件数・トークン数）

## データ保持期間の変更

- `src/utils/urlEntry.ts:11`の`URL_RETENTION_DAYS`を`7`から`35`に延長する
  - 理由: 月次サマリ（過去1ヶ月分）を集計するには現行の7日保持では不足するため
- 影響確認が必要な箇所: 7日保持を前提にしたロジック・UI表示・ストレージ容量見積もりがないか実装時に洗い出す

## 既存PBIとの差分（重要）

`dev-docs/plans/2026-07-04-01-feat-weekly-review-summary.md`のBDDシナリオは全面的に書き換える:

- 「Obsidianの週次ノートの所定セクションに追記される」→「`~/Downloads/Yasumaro/`配下にMarkdownファイルとして出力される」
- 「Obsidianが未起動のときは静かにスキップする」シナリオは不要（Obsidian非依存のため）
- 「履歴ゼロ件の場合はスキップ」シナリオは維持する
- 統計セクションの生成に関するシナリオを新規追加する

## 再利用する既存資産

- `src/background/pipeline/steps/saveLocalMarkdownStep.ts` — ダウンロード機構パターン
- `src/utils/storage/`（`StorageKeys`、`defaults.ts`）— 新規設定キー追加パターン
- `src/background/sessionAlarmsManager.ts` — alarms/起動検知パターン
- 既存AIクライアント — メタ要約生成
- `src/utils/urlEntry.ts`の`SavedUrlEntry` — 統計集計の元データ

## テスト戦略（概要、詳細はPBI文書側で定義）

- 単体: ISO週番号算出、月境界判定、統計集計ロジック（0件時のゼロ除算回避含む）
- 統合: `SavedUrlEntry`期間抽出クエリ、Markdown生成〜`chrome.downloads`書き出しの連携
- E2E: 履歴投入→週/月境界を跨いだ起動→ローカルMarkdown生成までの一連
