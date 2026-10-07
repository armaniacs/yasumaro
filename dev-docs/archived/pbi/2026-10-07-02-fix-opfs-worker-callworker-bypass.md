# PBI: OpfsWorkerBackend の mutation 経路を callWorker に集約し失敗カウンタを完全にする

## ユーザーストーリー

ストレージ保守担当者として、OPFS Worker が死んだセッションで記録系書き込みが degrade ladder を発火してほしい。mutation 経路が counter を迂回していて、insert が永遠に失敗し続け degraded 判定が起きないから。

## 優先度

- 順位: 2/17
- RICE: 10.0（R5 / I3 / C1.0 / E1.5）
- 根拠: モジュール自身の interface 不変宣言（「Routing every proxy call through it is what makes the failure counter complete」）が mutation で破られている実害
- 依存: なし

## 背景（file:line 現状）

- 迂回箇所: `src/offscreen/OpfsWorkerBackend.ts:104-107`（insert）/ `:109-112`（insertBatch）/ `:127-130`（update）/ `:132-135`（delete）/ `:137-140`（toggleStar）が `this.engine.sendToOpfsWorker(...)` を直接呼ぶ。`:246-249`（insertAuditLog）/ `:271-274`（clearAll）も同様
- 正経路: `:57-66` の `callWorker` → `tryOpfsProxy`（`opfsWorkerProxy.ts:134-142`）が失敗を null に畳み `#consecutiveFailures` を加算。`sendToOpfsWorker`（`opfsWorkerProxy.ts:107`）は生 rejection
- 影響: worker 死亡時、mutation は生 rejection で失敗し続け、3 連続失敗 → `onDegraded` 再解決が発火しない。callWorker 経由（query 等）は `{success:false}`、迂回系は throw と 2 つの失敗語彙

## BDD受け入れシナリオ

```gherkin
Scenario: worker 死亡時に insert が失敗を報告しカウンタが進む
  Given OPFS Worker が利用できない状態
  When insert / insertBatch / update / delete / toggleStar を実行する
  Then 生 rejection ではなく { success: false, error: OPFS_WORKER_UNAVAILABLE_ERROR } を返す

Scenario: 3 連続 mutation 失敗で degrade が発火する
  Given OPFS Worker が利用できない状態
  When 同一操作を 3 回連続で実行する
  Then onDegraded が 1 回だけ発火する
```

## 受け入れ基準

- [x] 全 proxy 呼び出し（insert/insertBatch/update/delete/toggleStar/insertAuditLog/clearAll）が callWorker 経由になる
- [x] 迂回系の生 rejection が消え、エラー語彙が OPFS_WORKER_UNAVAILABLE_ERROR に統一される
- [x] 既存 degradation テストを insert に拡張する
- [x] mutation 呼び出し元が BackendOrError を処理していることを確認（throw 前提の箇所があれば追従）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/offscreen/__tests__/opfsWorkerBackend-degradation.test.ts` を拡張
- fixture 先行: worker 死亡時の insert 失敗 fixture を先に追加して現挙動（throw）を pin してから変える
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する

## 実装記録

- 変更ファイル: `src/offscreen/OpfsWorkerBackend.ts`（7 mutation を callWorker 経由に集約）/ `src/offscreen/__tests__/opfsWorkerBackend-degradation.test.ts`（mutation 失敗カウンタ拡張）
- ゲート: 対象 59 tests green / type-check PASS / lint PASS / validate PASS
