# PBI-0823a-06: RecordingPipeline の PerUrlMutex / OfflineRetry 分離

## ユーザーストーリー

開発者として、`RecordingPipeline` の `PerUrlMutex` と `OfflineRetry` を分離したい。なぜなら519行に steps宣言 + Mutex + OfflineQueue が同居し、`executeWithStrategy` の retry loop が steps 配列と密結合しているから。

## 優先度

- **順位**: 6 / 8
- **RICE**: 120 (Reach 4 × Impact 2 × Conf 70% / Effort 1.6w)
- **根拠**: pipeline 実行部の分離。B 完了後に着手。
- **依存**: B（ServiceContainer 移行）完了後

## BDD受け入れシナリオ

```gherkin
Scenario: 同一URLへの並行記録が Mutex で直列化される
  Given 同一URLへの2つの record() 呼び出し
  When  同時に実行
  Then  Mutex により順序実行される

Scenario: steps 宣言は残し実行は StepExecutor に委譲
  Given 13 steps が宣言されている
  When  pipeline.execute() を呼ぶ
  Then  StepExecutor が各 step を順に実行し、retry + offline enqueue を担当
```

## 受け入れ基準

- [x] `PerUrlMutexMap` を `src/background/pipeline/perUrlMutex.ts` に抽出
- [x] `StepExecutor`（retry backoff + offline enqueue）を `src/background/pipeline/stepExecutor.ts` に抽出
- [x] `RecordingPipeline` は steps宣言のみ残し、実行を委譲
- [x] `npm run type-check` / `npm test` PASS

## 見積もり

8pt（1.6人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] RecordingPipeline が 250行以下
- [x] コードレビュー完了
