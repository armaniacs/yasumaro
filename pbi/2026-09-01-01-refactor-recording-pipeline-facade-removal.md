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
- [ ] `RecordingOrchestrator` に `execute(data, settings)` 相当の明示 settings 経路が用意されるか、`recordingHandlers` が `record(data)` + 事前 settings 注入に移行する
- [ ] `offlineQueueProcessor` の `RecordingPipelineLike` が `RecordingOrchestrator` の公開 Interface（`record` + retryObsidian mode）で表現され、`retryObsidianWriteOnly` の呼び出しが `record(job, { mode: 'retryObsidian' })` に置換される
- [ ] `compositionManifest.ts` の `recordingPipeline` エントリが `createRecordingOrchestrator` 直接生成になる
- [ ] `RecordingPipeline.ts`（facade クラス + `createRecordingPipeline`）が削除される
- [ ] 約 12 テストファイルが `RecordingOrchestrator` seam でパスする（`makeRecordingLogic` ヘルパを orchestrator 生成に書き換え）
- [ ] `MessageRouterDeps.recordingPipeline` の `Pick` 型が orchestrator 由来になる

## テスト戦略
- 統合: 3 経路（VALID_VISIT / MANUAL_RECORD / SAVE_RECORD / PREVIEW_RECORD / offline retry）が orchestrator 経由で観測可能挙動を保つ
- 単体: `recordingHandlers` の明示 settings 経路、offline retry の retryObsidian mode

## 見積もり
5 pt — orchestrator の `execute` 相当 API 追加 1pt + caller 3 経路の移行 2pt + テスト 12 ファイル移行 2pt

## Definition of Done
- [ ] 全 caller が `RecordingOrchestrator` 直接利用
- [ ] `RecordingPipeline.ts` 削除
- [ ] `npm run validate` が green
- [ ] DESIGN_SPECIFICATIONS.md の pipeline 記述を facade 前提から orchestrator 前提に更新
