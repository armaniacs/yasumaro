# PBI: RecordingPipeline facade の完全撤去 — 全 caller を RecordingOrchestrator 直接利用へ

## ユーザーストーリー
開発者として、Recording の実行経路を `RecordingOrchestrator` 一つに統一したい。なぜなら現在は互換 facade の `RecordingPipeline`（`execute` / `record` / `retryObsidianWriteOnly` の 3 メソッド）と `createRecordingPipeline` が残っており、新しい経路を書くときに「facade を使うのか orchestrator を使うのか」を毎回判断させられ、facade → orchestrator の薄い委譲を追う往復が発生するから。

## 背景
PBI 2026-08-31-02（RecordingOrchestrator 単一 Seam 化）で orchestrator への集約と `perUrlMutexMap` の race 修正、`buildRecordingPipelineDeps` / `recordWithPreview` の削除まで完了した。残ったのは facade クラス本体と `createRecordingPipeline` の撤去で、これは blast radius が大きいため独立 PBI として切り出した。

### 現状の caller
- **production**
  - `createBackgroundServices` / `compositionManifest.ts` — `createRecordingPipeline({...})` で生成し container に登録
  - `recordingHandlers.ts:229,288` — `pipeline.execute(data)`（明示 settings 経由。orchestrator には `execute` がなく `record` が settings を再取得する）
  - `offlineQueueProcessor.ts` — `RecordingPipelineLike` interface 経由で `record` と `retryObsidianWriteOnly`
  - `MessageRouterDeps.recordingPipeline` — `Pick<RecordingPipeline, 'record'>`
- **test**: 約 12 ファイル（`recordingPipeline-*.test.ts` / `RecordingPipeline*.test.ts` / `service-worker.test.ts` / `backgroundComposition.test.ts` / `createBackgroundServices.test.ts` / `helpers/makeRecordingLogic.ts` / `checkPrivacyHeadersStep.test.ts` 他）が `RecordingPipeline` / `createRecordingPipeline` を import またはモック

## 受け入れ基準
- [x] `RecordOptions` に `settings?: Settings` を追加し、`record(data, { settings })` で `getSettingsWithCache` をバイパスできる。`recordingHandlers` は `pipeline.execute(data, settings)` → `pipeline.record(data, { settings })` に移行。deps 型は `RecordingRunner`（`record` 一つ）に縮小
- [x] `offlineQueueProcessor` の `RecordingPipelineLike` は `RecordingOrchestrator` が満たす（`record` + `retryObsidianWriteOnly`）。`retryObsidianWriteOnly` は AI 再実行なしの Obsidian-only retry という別操作として orchestrator の公開メソッドに残す（`record(_, { mode: 'retryObsidian' })` の named wrapper）
- [x] `compositionManifest.ts` の `recordingPipeline` エントリが `createRecordingOrchestrator` 直接生成
- [x] `RecordingPipeline.ts`（facade クラス + `createRecordingPipeline` + `buildRecordingPipelineDeps`）を削除。`RecordingOrchestrator` から `recordWithPreview` convenience alias も削除
- [x] 影響した約 12 テストファイル + `makeRecordingLogic` ヘルパ（`makeOrchestrator` positional variant を追加）が orchestrator seam でパス
- [x] `MessageRouterDeps.recordingPipeline` / `alarmHandler` / `recordingHandlers` の型が `RecordingRunner` / `RecordingOrchestrator` 由来

## テスト戦略
- 統合: 3 経路（VALID_VISIT / MANUAL_RECORD / SAVE_RECORD / PREVIEW_RECORD / offline retry）が orchestrator 経由で観測可能挙動を保つ
- 単体: `recordingHandlers` の明示 settings 経路、offline retry の retryObsidian mode

## 見積もり
5 pt — orchestrator の `execute` 相当 API 追加 1pt + caller 3 経路の移行 2pt + テスト 12 ファイル移行 2pt

## Definition of Done
- [x] 全 caller が `RecordingOrchestrator` 直接利用
- [x] `RecordingPipeline.ts` 削除
- [x] `npm run validate` が green（type-check / lint / test 11117 passed / build）
- [x] DESIGN_SPECIFICATIONS.md §8.3 を orchestrator 前提に更新

## 実装メモ
- テストの `.execute(data, settings)` は `.record(data, { settings })` に一括移行。`makeRecordingLogic` は orchestrator を返し、旧 positional 署名向けに `makeOrchestrator` を追加
- `service-worker.test.ts` は `.execute` / `.record` が別メソッドだった前提で `prototype` を書き換える箇所があり、両方 `.record` になったため `beforeEach` で `prototype.record` をデフォルトに復元する処理を追加（テスト間汚染の防止）
- `resultBuilder.ts` の logError context 文字列 `'RecordingPipeline'` は cosmetic なため変更せず（テストの期待値と一致）
