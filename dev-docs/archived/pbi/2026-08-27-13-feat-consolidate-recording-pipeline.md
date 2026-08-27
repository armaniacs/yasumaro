# PBI: RecordingPipeline Context Bag の PipelineKernel 統合 — Phase A (薄いラッパー)

## ユーザーストーリー
開発者として、`RecordingContext` の7 intersection bag を `PipelineKernel` の薄いラッパーに統合したい、なぜなら全ステップが全フィールドを可視し、`RETRY`/`offlineRetry` がテーブルと `StepExecutor` に分散して組み合わせバグを検出できないから。Phase A では副作用境界の明確化に留め、typed builder は Phase B で行う。

## 優先度
- 順位: 2 / 7
- RICEスコア: 420（Reach=80 / Impact=3 / Confidence=70% / Effort=0.4）→ Phase A は 3pt、Phase B は 5pt で分割。Phase A は Strong かつ QueryPlanner と相乗で leverage 最大。
- 根拠: 新AIプロバイダ/保存先追加ごとにステップが増えるホットスポット。Phase A で `StepExecutor` 統合と副作用境界を先に固め、Phase B で typed builder と `isNetworkError`  분류を導入する2段階が `leverage` と `locality` の両立で最短。

## なぜなぜ分析
- なぜ bag が問題か: `RecordingContext = 7 intersection` で全ステップが全フィールドを可視
- なぜ気づかないか: 各ステップ単体テストでは offline enqueue の組み合わせが検出できない。`saveObsidian` の `BEST_EFFORT` + `offlineRetry` と `extractSentences` の内部 `BEST_EFFORT` フォールバックが混在し、`enqueueOfflineJob` に `isNetworkError` ガードがなく論理エラーまで queue に載る
- 解: Phase A: `PipelineKernel { record(data): Result }` が `StepExecutor` を統合し `RETRY`/`offlineRetry` を内部で完結。Phase B: `isNetworkError` 分類と typed builder (`Readonly<PipelineInput> & Mutable<StagePatch>`) を導入

## BDD受け入れシナリオ
Scenario: ハッピーパス — record が一括で完結する
  Given `RecordingData` を渡す
  When `PipelineKernel.record` を呼ぶ
  Then `Privacy -> Obsidian -> Sqlite` が内部で実行され `RecordingResult` が返る。現行 `RecordingPipeline.record()` は facade として残す

Scenario: エッジケース — offline 分岐が一箇所で完結し、論理エラーは enqueue されない
  Given ネットワーク断で `saveToObsidian` が失敗する
  When `record` を呼ぶ
  Then `isNetworkError(error)` が `true` の場合のみ `offlineRetry` に enqueue され、 `DOMAIN_BLOCKED` は enqueue されない

## 受け入れ基準
- [ ] Phase A: `PipelineKernel` が `StepExecutor` を統合し `RETRY`/`offlineRetry` が内部で完結している。`RecordingPipeline.record()` は facade として残る
- [ ] `enqueueOfflineJob` に `isNetworkError(error)` ガードが追加されている
- [ ] `RecordingPipeline-offline-policy` テストが Kernel 単体で完結する
- [ ] Phase B: `RecordingContext` bag が `Pick<RecordingContext, ...>` の read/write 宣言を持つ typed builder に置換されている (本PBIでは Phase A のみ)

## テスト戦略
- 単体: Phase A: `PipelineKernel` の 13ステップ × `RETRY` 組み合わせを `NoOpOfflineNetworkQueue` + `ChromeStorageAdapter` fake で検証
- 統合: 実 pipeline で `previewBreakpoint` と `saveSqlite` の連携を検証
- E2E: `content-script-recording` で 50% scroll + 5s 滞在の発火を検証

## 見積もり
3pt（Phase A, 要チームでの見積もり） — Phase B は 5pt で別PBI化推奨

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
