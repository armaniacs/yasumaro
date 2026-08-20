# PBI: Recording Pipeline — 浅い step群を深い Pipeline moduleに

## ユーザーストーリー
開発者として、`record(ctx) → Result` の1メソッドだけを知れば記録が完結する深い `RecordingPipeline` module がほしい、なぜなら現在の各 step は `execute(context: RecordingContext)` という大きな context を受けつつ実装は20-40行の薄い委譲で、真のバグ（呼び出し順・ErrorStrategy・per-URL Mutex・BEST_EFFORT の相互作用）は step の外に潜み、テストは各 step を個別に mock するため locality が無く、`force`/`skipDuplicateCheck`/`previewOnly` の8通りを `record()` の1 seam でしか検証できないから

## 優先度
- 順位: 02 / 05
- RICEスコア: 1680（Reach=800 / Impact=3 / Confidence=70% / Effort=1.0）
- 根拠: Reachは記録機能利用者（800/1000）、Impactは大きい（記録失敗はコア価値毀損）、ConfidenceはPBI 02で8通りの interface テストを追加済みで中程度、Effortは step 群の internal seam 化で1.0人月。SettingsRepository の次に着手。

## なぜなぜ分析
- **疑問**: なぜ step の単体テストではバグが見つからないのか → なぜ: 真のバグは step 単体ではなく step 間の `context` 共有状態と `Mutex` 競合に潜むから
- **なぜ** `RecordingContext` が大きいままなのか → なぜ: 各 step が必要なフィールドを個別に知る必要があり、interface が漏れているから
- **解**: `RecordingPipeline` の seam 背後に step 群を internal seams として隠蔽し、外部テストは `record()` の interface 越しのみで検証する

## BDD受け入れシナリオ
Scenario: 8通りのフラグ組み合わせが1 seamで検証できる
  Given `force`/`skipDuplicateCheck`/`previewOnly` の任意の組み合わせ
  When `pipeline.record(ctx)` を呼ぶ
  Then 期待される `Result`（成功 / 重複スキップ / プレビューのみ）が返る

Scenario: per-URL Mutex で並行記録が正しく直列化される
  Given 同一URLへの2つの並行 `record` 呼び出し
  When 同時に実行する
  Then 一方が Mutex で待機し、重複保存が発生しない

Scenario: BEST_EFFORT で一部失敗しても全体が継続する
  Given `BEST_EFFORT` 戦略で `saveToObsidianStep` が失敗する
  When `record` を呼ぶ
  Then 失敗は `Result` に集約され、後続 step はスキップされずに実行される

## 受け入れ基準
- [x] `RecordingPipeline` の外部 interface が `record(ctx)` のみに集約されている
- [x] `PipelineStep` / `ErrorStrategy` / `RecordingContext` が外部から import 不可（internal seam）である
- [x] `OfflineNetworkQueue` / `RecordingCacheInstance` が adapter として注入可能である
- [x] 既存の8通り + Mutex のテストが `record()` 越しにパスする

## テスト戦略
- E2E: 実際のページで `VALID_VISIT` → `record` → Obsidian/SQLite への保存を検証
- 統合: `RecordingPipeline` + InMemory adapters で全 step の協調動作を検証
- 単体: 各 step は internal seam として `record()` 越しに間接的に検証。個別の step 単体テストは削除または内部テストに格下げ

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
- [x] 既存の step 単体テストの整理（削除/内部化）が完了している
