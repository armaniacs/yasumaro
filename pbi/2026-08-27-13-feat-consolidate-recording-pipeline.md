# PBI: RecordingPipeline Context Bag の PipelineKernel 統合

## ユーザーストーリー
開発者として、`RecordingContext` の7 intersection bag を typed builder を持つ `PipelineKernel` に統合したい、なぜなら全ステップが全フィールドを可視し、offline/RETRY 分岐がテーブルと executor に分散して組み合わせバグを検出できないから。

## 優先度
- 順位: 2 / 7
- RICEスコア: 420（Reach=80 / Impact=3 / Confidence=70% / Effort=0.4）
- 根拠: 新AIプロバイダ/保存先追加ごとにステップが増えるホットスポット。Strong かつ QueryPlanner と相乗で leverage 最大。

## なぜなぜ分析
- なぜ bag が問題か: `RecordingContext = 7 intersection` で全ステップが全フィールドを可視
- なぜ気づかないか: 各ステップ単体テストでは offline enqueue の組み合わせが検出できない
- 解: `PipelineKernel { record(data): Result }` が Privacy→Obsidian→Sqlite の副作用境界を内部で完結

## BDD受け入れシナリオ
Scenario: ハッピーパス — record が一括で完結する
  Given `RecordingData` を渡す
  When `PipelineKernel.record` を呼ぶ
  Then `Privacy -> Obsidian -> Sqlite` が内部で実行され `RecordingResult` が返る

Scenario: エッジケース — offline 分岐が一箇所で完結する
  Given ネットワーク断で `saveToObsidian` が失敗する
  When `record` を呼ぶ
  Then `offlineRetry` に enqueue され、再試行が Kernel 内で完結する

## 受け入れ基準
- [ ] `RecordingContext` bag が typed builder に置換されている
- [ ] `StepExecutor` が `PipelineKernel` に統合され `RETRY`/`offlineRetry` が内部完結している
- [ ] `RecordingPipeline-offline-policy` テストが Kernel 単体で完結する

## テスト戦略
- 単体: `PipelineKernel` の 13ステップ × offline/RETRY 組み合わせテスト
- 統合: 実 pipeline で `previewBreakpoint` と `saveSqlite` の連携を検証
- E2E: `content-script-recording` で 50% scroll + 5s 滞在の発火を検証

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
