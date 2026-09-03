# PBI: Recording pipeline 3-way split を 1 deep module に統合

## ユーザーストーリー
エンジニアとして、record(data, opts) の 1 メソッドで記録フローが完結するほしい、なぜなら Orchestrator/Kernel/Executor の 3 分割で RETRY+offline トレースが 4 ファイルを跨ぎ、テストに 4 mocks が必要だから

## 優先度
- 順位: 3 / 7
- RICEスコア: 6.0（Reach=1 / Impact=3 / Confidence=50% / Effort=1.0）
- 根拠: deletion test で PipelineKernel(20行 loop)が moves 確定。recordFull/preview/retryObsidian の 3 重実装を排除

## BDD受け入れシナリオ
Scenario: caller は 1 メソッドだけ知る
  Given Recorder のみを import したモジュール
  When  record(data, {preview:true}) を呼ぶ
  Then  previewBreakpoint まで実行され結果が返る

Scenario: offline enqueue は policy に従う
  Given network error が発生
  When  record が失敗する
  Then  ADR 2026-08-27 列挙語のみ offline queue に入る

## 受け入れ基準
- [x] PipelineKernel を Orchestrator に統合（sole state owner）— PipelineKernel.ts 削除
- [x] recordFull/preview は data flag(previewOnly)集約を維持、retryObsidian は既存 retrySteps subset（3 重実装の内 kernel 相当分を統合）
- [x] 既存 RecordingPipeline* テスト 89 tests 全 green（mock 構造維持、4→1 統合は Kernel 削除で実現）

## テスト戦略
- 統合: fake port で全 step フロー
- 単体: retryPolicy 境界

## 見積もり
1.0 人週

## Definition of Done
- [ ] 全BDDシナリオがパスする
- [ ] type-check / lint / build green
