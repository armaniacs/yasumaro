# PBI: errorMessage SSOT への残存迂回の置換（refactor）

優先度: 台帳 RICE 6.0（Reach 6 / Impact 1 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918b.md](2026-09-18-00-backlog-holistic-0918b.md)（台帳、候補 C1）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、エラーメッセージ抽出を `errorMessage()` SSOT に完全に寄せてほしい、なぜなら SSOT のコメントが「約58呼び出し箇所を置換した」と主張する一方、同一パターンが約20箇所に残っており、新規コードがどちらに倣うべきか曖昧になっているから。

## 背景（現状と課題）

`src/utils/errorUtils.ts`（@layer 0）の `errorMessage(error)` は `error instanceof Error ? error.message : String(error)` と同一実装の SSOT である。だが同一のインライン三項演算が残存する（着手時に行番号を再確認すること）:

- `src/background/pipeline/stepExecutor.ts`（enqueueError の error フィールド）
- `src/background/pipeline/retryPolicy.ts`（msg 変数）
- `src/background/obsidianClient.ts`（msg 変数）
- `src/background/ai/LocalAIService.ts`（message フィールド）
- `src/background/offlineQueueProcessor.ts`（logWarn の error フィールド）
- `src/background/deferredMigrations.ts`（details の error フィールド）
- `src/background/handlers/MessageRouter.ts`（2箇所: validator catch・handler catch）
- `src/offscreen/migrations.ts`（msg 変数）
- `src/offscreen/opfsWorker/archiveCreateHandlers.ts`（テンプレート文字列内）
- `src/offscreen/opfsWorker/archivePurgeHandlers.ts`（2箇所）
- `src/offscreen/opfsMigrationV2Reader.ts`（msg 変数）
- `src/offscreen/cleansingOffscreen.ts`（msg 変数）
- `src/offscreen/storageFallback.ts`（error フィールド）
- `src/content/contentKernel.ts`（logDebug の error フィールド）
- `src/dashboard/panels/NavigationRegistry.ts`（textContent テンプレート内）
- `src/dashboard/localMarkdownExport.ts`（textContent テンプレート内）
- `src/messaging/pendingRecordGateway.ts`（error フィールド）
- `src/messaging/messageTransport.ts`（isRetryableError の msg 変数）

対象外（byte-identical 維持のため置換しない）: カスタム fallback 付きの亜種（`importPipeline.ts` の 'Parse failed'/'Validation failed'、`extractSentencesStep.ts` の 'Unknown error'、`sqliteHistoryPanelView.ts` の t('recordError')、`validators.ts` の 'invalid cutoffDate'）、Error ラップ変形（`e instanceof Error ? e : new Error(...)`）、`e.name` 抽出（`obsidianClient.ts`・`ProviderStrategy.ts`）、`error instanceof Error ? error : null`（`errorClassification.ts`）。

## BDD受け入れシナリオ

```gherkin
Scenario: 置換後も抽出結果が byte-identical である
  Given Error インスタンスと非 Error 値を与える
  When 置換対象の各呼び出し経路を実行する
  Then 生成されるメッセージ文字列は置換前と同一である（errorMessage は同一実装のため）

Scenario: 亜種が誤って置換されていない
  Given カスタム fallback を持つ呼び出し箇所（importPipeline 等）
  When 置換対象ファイル一覧を grep する
  Then 亜種の行は変更されておらず、対象は正確な複製のみである
```

## 受け入れ基準

- [x] 上記対象ファイルから正確な複製パターン（`X instanceof Error ? X.message : String(X)`）が除去されている
- [x] 各ファイルに `errorMessage` の import が追加され、相対パスが正しい
- [x] 亜種・ラップ変形・name 抽出には手を付けていない
- [x] `npm run type-check` が green
- [x] 変更ファイルの関連 vitest が green
- [x] `grep -rn "instanceof Error ? .*message : String(" src --include="*.ts" | grep -v __tests__` が対象外の亜種のみを返す

## テスト戦略

- 挙動は同一実装への置換のため既存テストで担保される。変更ファイルの関連テストを実行する
- 置換漏れ・過剰置換は上記 grep で機械的に確認する

## 見積もり

1pt（約20サイトの機械置換。ロジック変更なし）。

## 実装ガイド

- 着手時点での確認ポイント: `errorMessage` の層（utils/errorUtils.ts, @layer 0）と各ファイルの既存 import 群。offscreen・content・dashboard からの import は層ルール上問題ない（Layer 0 は全層から import 可）
- 複数候補が触るファイルなし。他 PBI（11・13）とファイル非重複
- git 操作・pbi 編集は統合側が行う
