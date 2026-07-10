# PBI: 週次/月次の振り返りサマリ自動生成（ローカルMarkdown出力）

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: A. 知識活用・検索強化
- type: feat / 優先度: ★推奨（第一弾候補）
- 設計ドキュメント: `docs/superpowers/specs/2026-07-05-weekly-monthly-local-summary-design.md`
- 関連PBI: `dev-docs/plans/2026-07-04-07-feat-local-markdown-export.md`（出力機構を再利用、完了済み）

> **改訂履歴（2026-07-05）**: 当初案の「Obsidian週次ノートへの追記」を撤回し、`~/Downloads/Yasumaro/` へのローカルMarkdown出力に変更。あわせて記録処理の統計セクションをサマリに統合する。

## ユーザーストーリー

Yasumaro 利用者として、1週間（または1ヶ月）に読んだページのダイジェストをローカルのMarkdownファイルとして自動生成してほしい。なぜなら、日々の記録が溜まるだけでは振り返りづらく、期間単位でまとめて把握できると学びの定着や情報整理に役立つから。また、Obsidian Local REST APIを導入していなくても振り返り機能を使えるようにしたいから。

## ビジネス価値

「記録した後」の価値を最大化する差別化機能。Obsidian REST未導入層にも届き、対象ユーザーを拡大する。デイリーの断片を週次/月次で俯瞰でき、利用継続の動機になる。測定: サマリ生成の実行回数 / 生成ファイルの利用有無。

## BDD受け入れシナリオ

```gherkin
Scenario: 週次サマリがローカルMarkdownとして生成される
  Given 直近の週（月曜始まり）に複数の閲覧履歴が記録されている
  And   週次サマリ機能が有効に設定されている
  When  翌週月曜日にYasumaroが最初に動作する
  Then  対象期間の履歴を要約したダイジェストが生成される
  And   ~/Downloads/Yasumaro/YYYY-week-NN.md（NNはISO週番号）として出力される
  And   同ファイル内に対象期間の処理統計セクションが含まれる

Scenario: 月次サマリがローカルMarkdownとして生成される
  Given 直近1ヶ月間に複数の閲覧履歴が記録されている
  And   月次サマリ機能が有効に設定されている
  When  翌月初日にYasumaroが最初に動作する
  Then  対象期間の履歴を要約したダイジェストが生成される
  And   ~/Downloads/Yasumaro/YYYY-month-NN.md として出力される
  And   同ファイル内に対象期間の処理統計セクションが含まれる

Scenario: 対象期間に履歴がない場合はスキップする
  Given 対象期間に閲覧履歴が1件も記録されていない
  When  週次または月次サマリ生成が実行される
  Then  ファイル生成もAI呼び出しも行われない
  And   空サマリを生成しない

Scenario: 同一周期の自動生成は一度だけ行われる
  Given 対象週（または対象月）のサマリが既に生成済みである
  When  同じ週（または月）の間にYasumaroが再度起動する
  Then  サマリの再生成は行われない

Scenario: 手動でサマリを生成できる
  Given 利用者がダッシュボードから週次（または月次）サマリの手動生成を実行する
  When  対象期間に閲覧履歴が存在する
  Then  スケジュールを待たずにサマリファイルが生成される
```

## 受け入れ基準

- [ ] 週次・月次それぞれで自動生成が動作する（週次: 翌週月曜初回起動時、月次: 翌月初日初回起動時）
- [ ] ダッシュボードから手動生成できる
- [ ] 対象期間を `SavedUrlEntry.timestamp` から正しく抽出する（週次: ISO週境界、月次: 月境界）
- [ ] 生成結果が `~/Downloads/Yasumaro/YYYY-week-NN.md` / `YYYY-month-NN.md` として出力される
- [ ] ダイジェスト（メタ要約）と統計セクションの両方がファイルに含まれる
- [ ] 履歴ゼロ件で例外を出さず、ファイルも生成しない
- [ ] 同一周期内での二重自動生成が起きない
- [ ] 要約は既存プライバシーモード設定に従う
- [ ] `URL_RETENTION_DAYS` を35日に延長し、月次集計に必要な履歴が保持される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 履歴投入 → 週/月境界を跨いだ起動 → ローカルMarkdown生成までの一連（happy path、週次/月次それぞれ）
- 履歴投入 → ダッシュボードから手動生成 → ファイル生成

### 統合テスト
- `SavedUrlEntry` 期間抽出クエリが対象期間の行のみ返す（週境界・月境界の境目を含む）
- ダイジェスト生成（既存AIクライアント呼び出し）→ Markdown組み立て → `chrome.downloads` 書き出しの連携
- `chrome.alarms`（または起動フック）発火 → サマリ生成ハンドラ起動 → 二重生成防止チェック

### 単体テスト
- ISO週番号の算出ロジック（年またぎ、53週年を含む）
- 月境界（月初・月末）の抽出ロジック
- 履歴ゼロ件時のスキップ判定
- 統計集計ロジック（合計トークン数、平均処理時間、削減率、プロバイダ/モデル別内訳、0件時のゼロ除算回避）
- 週次/月次ファイルパス生成

## 実装アプローチ

- Outside-In: E2E(失敗) → 統合 → 単体 → 実装 → グリーン → リファクタ
- Red-Green-Refactor を各レイヤーで適用

## 見積もり

8pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし（既存資産で完結）
- 再利用:
  - `src/background/pipeline/steps/saveLocalMarkdownStep.ts`（`chrome.downloads` 書き出しパターン）
  - 既存AIクライアント（`aiClient` 系、メタ要約生成に利用）
  - `src/utils/storage/`（`StorageKeys`・`defaults.ts`、新規設定キー追加パターン）
  - `src/background/sessionAlarmsManager.ts`（alarms/起動検知パターン）
  - `src/utils/urlEntry.ts` の `SavedUrlEntry`（統計集計の元データ）
- Service Worker はステートレスなので状態（直近生成済み週/月番号など）は `chrome.storage.local` に保持
- Obsidian Local REST API には依存しない（未導入でも動作する）

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "weekly\|週次\|reviewSummary\|periodSummary" src/
grep -rn "saveLocalMarkdownStep" src/background/pipeline/steps/
grep -rn "URL_RETENTION_DAYS" src/utils/urlEntry.ts
```

未実装であることを確認してから着手する。

### 落とし穴

- Service Worker は任意タイミングで終了する。`chrome.alarms` または起動フックで起こす前提で設計し、メモリ状態に依存しない。
- 週の開始曜日（月曜）・ISO週番号・タイムゾーン（`ja-JP`）の扱いをテストで固定する。
- `URL_RETENTION_DAYS` を7日→35日に延長する際、既存の7日保持を前提にしたロジック・UI・ストレージ容量への影響を洗い出す。
- 統計セクションはサマリ生成のたびに `SavedUrlEntry` から都度集計する。専用の集計ストレージは持たない。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] E2E/統合/単体すべてカバレッジ基準を満たす
- [ ] コードレビュー完了 / リファクタ完了
- [ ] CHANGELOG・関連ドキュメント更新
