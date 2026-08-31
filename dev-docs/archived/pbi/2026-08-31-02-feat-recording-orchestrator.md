# PBI: RecordingPipeline 深層化 — RecordingOrchestrator 単一 Seam 化と二重 Mutex 解消

## ユーザーストーリー
開発者として、Recording の全経路（通常 / preview / retry）を単一の深い Module `RecordingOrchestrator.record(data)` で実行したい。なぜなら現在 `RecordingPipeline` が 4 methods + 3 factory closures + 二重 PerUrlMutex（instance/static 互換）を公開し、Caller はどの method を使うべきか学ばされる上に、`saveSqliteStep` の closure 注入と他 step の `StepDeps` 注入が不統一で、retry / previewBreakpoint / BEST_EFFORT の結合テストが同じ Seam で検証できないから。

## 優先度
- 順位: 02 / 06
- RICEスコア: **480**（Reach=600 / Impact=2 / Confidence=0.8 / Effort=2）
  - Reach 600: 全 recording（VALID_VISIT / MANUAL_RECORD / SAVE_RECORD / retryObsidianWriteOnly）が対象。hot spot 16 回
  - Impact 2: 大きい。Mutex 二重化と注入不統一による race / silent no-op の修正。Leverage が recording 全経路に波及
  - Confidence 0.8: Pipeline 分断と mutex 乖離はコードで確認済みだが、retry タイミングの再現性に不確実性が残る
  - Effort 2: 2 人週（Orchestrator 集約 + Mutex 単一化 + Step 注入統一）
- 根拠: RICE 2 位。01 Settings が前提（`getSettingsWithCache` を repo に一本化後に Orchestrator が恩恵を受ける）。01 の後に実施することで `record()` テストが versioned Port と組み合わさる。
- 依存: 01 Settings 単一化（前提）。01 なしでも着手可能だが、テストの一貫性が半減する。

## 背景 / なぜなぜ分析
- 表層: `pipeline/record` と `pipeline/retryObsidianWriteOnly` の使い分けが不明
- なぜ1: 歴史的に `retryObsidianWriteOnly` が static mutex 経由で追加され、instance mutex と別経路になった
- なぜ2: `createSaveSqliteStep` が `this.sqliteClient` を closure し、`createSaveToObsidianStep` が `StepDeps` を経由 — 注入スタイルの決定が各 step に委ねられている
- なぜ3: `buildRecordingPipelineDeps` が 6 LOC の identity 関数として shallow に残り、deletion test で価値が証明できない
- なぜ4: `PipelineKernel` と `StepExecutor` の責務（loop/retry/offline vs execute）が caller から不可視で、previewBreakpoint の short-circuit が kernel 内に埋もれている
- 解: 単一 Orchestrator が PerUrlMutex / Kernel / Executor / 13 steps registry を private に束ね、Interface を `record(data)` 一つに。retry は `mode` で吸収。PerUrlMutex static 互換と identity deps を削除。

## BDD受け入れシナリオ

Scenario: 単一 Seam で通常 recording が成功する
  Given 有効な `RecordingData`（title/url/content）と Settings
  When  `orchestrator.record(data)` を呼ぶ
  Then  13 steps（truncate → saveMetadata）が順に実行され `RecordingResult` が返る
  And   PerUrlMutex により同一 URL の並行 record は直列化される

Scenario: preview モードが同一 Seam で動作する
  Given `data.previewOnly = true` の RecordingData
  When  `orchestrator.record(data)` を呼ぶ
  Then  `privacyPipeline` step 後の `previewBreakpoint` で short-circuit し、save 系 steps はスキップされる
  And   Result は preview 用の markdown を含む

Scenario: retry が同一 Seam で動作する
  Given `orchestrator.record({...title, url, summary, mode: 'retryObsidian'})` を呼ぶ
  When  saveObsidian が実行される
  Then  `formatMarkdown` → `saveToObsidian` のみが実行され、他 steps はスキップされる
  And   以前の `retryObsidianWriteOnly` と同等の結果が得られる

Scenario: 境界 — 同一 URL の並行 record で mutex タイムアウト
  Given 同一 URL で 2 つの `record()` が同時に呼ばれる
  When  一方が mutex を長時間保持する
  Then  他方はタイムアウトせず待機し、先行が完了後に実行される
  And   traceId は各実行で一意に生成される

Scenario: エラー — SqliteClient 未設定でも BEST_EFFORT で継続
  Given `sqliteClient = null` の Orchestrator
  When  `record(data)` を呼ぶ
  Then  saveSqlite step は WARN ログを残して skip し、後続の saveMetadata は実行される

## 受け入れ基準
- [x] `RecordingPipeline` facade から `recordWithPreview` を削除（production は `execute(data)` / `record(data)` の `previewOnly` で preview を通す）。`retryObsidianWriteOnly` は AI 再実行なしの Obsidian-only retry という別操作として facade に残す（offlineQueueProcessor が `RecordingPipelineLike` 経由で依存）。`RecordingOrchestrator` の同名 convenience alias（`recordWithPreview` / `retryObsidianWriteOnly`）はまだ残存
- [x] `PerUrlMutexMap` の static 互換 (`urlRecordMutexes` / `getOrCreateStatic` / `runExclusiveStatic`) が削除され、instance `mutexMap` のみに
- [x] `buildRecordingPipelineDeps` identity 関数を削除し、`createRecordingPipeline` / `createBackgroundServices` / テストヘルパが deps を直接渡す形に一本化
- [x] 全 13 steps が Orchestrator の private array に登録され、caller から `create*Step()` が不可視。`saveSqliteStep` も `StepDeps` 経由
- [x] 既存の `steps/__tests__/*` + `recordingPipeline-*.test.ts` が同一 Seam で green
- [x] `service-worker` / `manualRecord` / `saveRecord` の 3 経路が Orchestrator 経由で green（container singleton の `perUrlMutexMap` を pipeline deps に配線し、cross-instance の URL 直列化を回復済み）

## テスト戦略
- E2E: VALID_VISIT → Obsidian 保存 → SQLite 保存の一連が成功。preview と retry の手動実行が同一 Orchestrator で成功
- 統合: 同一 URL 並行 record の直列化、previewBreakpoint の short-circuit、BEST_EFFORT（saveObsidian 失敗でも saveMetadata まで到達）
- 単体: Step registry の 13 steps 列挙テスト、traceId 生成（randomUUID / fallback）、StepDeps 注入の統一性、mutex タイムアウト待機

## 見積もり
5 pt（要チームでの見積もり）— Orchestrator 集約 2pt + Mutex 単一化 1pt + Step 注入統一と registry 化 2pt

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（pipeline / handlers / service-worker の影響確認 — 2026-09-01。`perUrlMutexMap` 未配線による duplicate-entry race を発見・修正）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md §8.3 Per-URL Recording Serialization を新設。pipeline の step registry は Orchestrator private のため章追加は見送り）
- [x] `npm run validate` が green

## 残作業（フォローアップ）
- `RecordingOrchestrator` の `recordWithPreview` / `retryObsidianWriteOnly` convenience alias の削除（呼出側は既に `record` / facade 経由。orchestrator の内部整理のみ）
- `RecordingPipeline` facade（`execute` / `record` / `retryObsidianWriteOnly` の 3 メソッド）と `createRecordingPipeline` の完全撤去と、~12 テストファイル + `offlineQueueProcessor` + `recordingHandlers` の `RecordingOrchestrator` 直接利用への移行。blast radius が大きいため別 PBI で扱う

## 実装メモ（任意）
- `PipelineKernel` と `StepExecutor` は Orchestrator の private 実装として残し、外部 Interface には出さない（internal seam）
- `traceId` 生成は Orchestrator の private method に抽出し、テストでは deterministic に差し替え可能に
- `createRecordingPipeline` は互換 shim として一時残す場合も、内部で Orchestrator に委譲し deprecated マーク
