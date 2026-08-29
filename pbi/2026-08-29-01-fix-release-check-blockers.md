# PBI: リリース前チェックのブロッカー2件を解消する

## ユーザーストーリー

リリース担当者として、`npm run release:check:fast` がすべてのゲートをパスする状態にしたい。なぜなら、i18n 未翻訳キーと branches カバレッジ不足でリリースが止まっており、本来リリースに使う時間を問題調査に費やしているから。

## 優先度

- 順位: 01 / 01
- RICE スコア: 4800（Reach=20 / Impact=3 / Confidence=80% / Effort=1日）
- 根拠: `release:check:fast` が失敗しているため、次回リリースがブロックされている。i18n キー追加は数分で完了し、branches カバレッジは既存テスト不足の解消で対応可能。両方独立して並列作業できる。

## 背景

`scripts/release-checks/` に新設した `npm run release:check:fast` を実行すると、以下2件が失敗している。

1. **i18n 未翻訳キー（4件）**
   - `src/dashboard/models-dev-dialog.html` / `.ts` で使用されている `modelsDevDialogTitle`, `tabAll`, `tabAggregator`, `tabOthers` が `public/_locales/en/messages.json` に未追加。
   - `public/_locales/ja/messages.json` には既存キーは含まれているが、上記4キーも不足している可能性がある。

2. **branches カバレッジ不足（全体 83.4% < 90%）**
   - `npm run test:coverage` の結果、lines は 94.1% で達しているが branches が 83.4% と 90% ゲートを下回っている。
   - 不足ファイルは `coverage/` 内のレポート（HTML / JSON）で特定可能。

## BDD 受け入れシナリオ

### Scenario: i18n キーがすべて登録されている

Given `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` が存在する
When `scripts/release-checks/check-i18n.mjs` を実行する
Then 失敗ゼロ、警告ゼロで終了する

### Scenario: branches カバレッジが 90% 以上になる

Given 既存のテストスイートが実行可能である
When `npm run test:coverage` を実行する
Then `branches` が 90.0% 以上、`lines` が 90.0% 以上になる

### Scenario: release:check:fast がすべてパスする

Given i18n キー追加と branches カバレッジ向上が完了している
When `npm run release:check:fast` を実行する
Then 全カテゴリが PASS になる

## 受け入れ基準

- [x] `public/_locales/en/messages.json` に `modelsDevDialogTitle`, `tabAll`, `tabAggregator`, `tabOthers` が追加されている
- [x] `public/_locales/ja/messages.json` に上記4キーの日本語訳が追加されている
- [ ] `npm run test:coverage` で `branches >= 90.0%` かつ `lines >= 90.0%`（2026-08-29 時点 88.94%まで改善、残り ~130 branches。以下14ファイルで branches カバレッジテストを追加済み、マージ済み: masterPassword.ts(69→97.5%), stripExtended.ts(69→86%), historyPendingPanel.ts(74→100%), migration.ts(59→98%), promptSanitizer.ts(67→96%), historyEntryRow.ts(84→100%), OpenAIProvider.ts(76→95%), createBackgroundServices.ts(49→100%), tagClusterPanZoom.ts(67→92%), storageFallback.ts(85→99%), legacyMigration.ts(85→99%), domainFilterTagUI.ts(75→98%), privacy.ts(76→84%), sessionStore.ts(80→92%)。再開手順: `npm run test:coverage` で最新の未達ファイル一覧を取得し、branches 不足の多いファイル順に同様のテスト追加を継続。直近のフルカバレッジ実行が vitest-pool の worker timeout で不安定だったため、再開時はまず `npm run test:coverage` を単独実行してインフラ起因の flake でないか確認すること）
- [ ] `npm run release:check:fast` が全カテゴリ PASS（tests カテゴリのみ coverage 未達で FAIL）
- [x] `npm run validate` が PASS
- [x] 追加・変更した i18n キー/テストがレビュー不要の範囲を超える場合、コードレビュー済み

## テスト戦略

- **i18n**: 既存の `scripts/release-checks/check-i18n.mjs` をゲートとする。人間は4キーの英文/和文を確認するだけ。
- **branches カバレッジ**: `coverage/coverage-summary.json` または HTML レポートで低いファイルを抽出し、対象ファイルごとに単体テストを追加。既存の Vitest 環境を使用する。
- **統合**: `npm run release:check:fast` を最終ゲートとする。

## タスク分解

1. i18n キー追加
   1.1 `src/dashboard/models-dev-dialog.html` / `.ts` から既存のフォールバックテキストを取得
   1.2 `public/_locales/en/messages.json` に4キー追加
   1.3 `public/_locales/ja/messages.json` に4キーの日本語訳追加
   1.4 `check-i18n.mjs` で PASS 確認

2. branches カバレッジ向上
   2.1 `npm run test:coverage` を実行
   2.2 `coverage/coverage-summary.json` から branches 不足ファイルを抽出
   2.3 不足ファイルごとに単体テストを追加（`__tests__/*.test.ts`）
   2.4 カバレッジ 90% 達成を確認

## 見積もり

1 story point（i18n: 0.2pt、branches カバレッジ: 0.8pt）

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト/チェックスクリプトでパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新不要（PBI 作成時点で README/コメントに変更なし）
- [ ] `pbi/00-INDEX.md` の進行中表に本 PBI が記載され、完了時にアーカイブ履歴へ移動
