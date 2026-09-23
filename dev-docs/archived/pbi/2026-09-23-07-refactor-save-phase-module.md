# PBI 2026-09-23-07 — SavePhase Module（保存 fan-out＋retry 投影の一元化）

**優先度**: 順位 7 / RICE 12.8（Reach 6 × Impact 2 × Confidence 80% ÷ Effort 0.75 人週）
**根拠**: 録画パイプラインの保存 tail（4-sink fan-out＋手書き retry 部分集合＋2 注入方式）は今後の録画機能すべてに課税する最大の順序/interface 残債。Seam 配置が明確で削除テストが決定的。
**種別**: refactor（非機能追加）

## 背景

`RecordingOrchestrator.ts` の公開 interface は 3 エントリ（record/preview/retryObsidianWrite）だが、保存 tail は 4 つの BEST_EFFORT step（saveObsidian/saveLocalMarkdown/saveSqlite/saveMetadata、:99-102）と手書き 2-step retry 部分集合（formatMarkdown+saveObsidian、:106-109）の二重登録で、別ループ（executeRetrySubset、:177-183）が回す。各 save step は `RecordingContext→params` を独自マップし、dep 注入が closure（`this.obsidian`/`this.aiService`、:117-120）と execute 時解決（`deps?.sqliteClient`＋WARN+skip fallback、:123-149）の 2 方式に分裂。`processPrivacyPipelineStep.ts:29` は呼び出しごとに `new PrivacyPipeline(...)` し、previewOnly 分岐（:44-65）を複製する。

## 実装戦略

1. `SavePhase` Module を新設し、`save(context, deps) → SaveReceipt` を唯一 Seam にする。4-sink fan-out 順序・BEST_EFFORT 継続政策・retry 投影（`retryProjection()`）を所有する。
2. 全 sink を `StepDeps` から均一解決する（`this.*` closure を廃止）。sqlite 欠如の skip は Seam の明示エラー様式にする（inline WARN 分岐の廃止）。
3. `processPrivacyPipelineStep` は注入 factory 経由の薄い Adapter にする。
4. 保存順序（Obsidian→local→sqlite→metadata）・BEST_EFFORT 継続・preview 短絡は不変。

## 受け入れ基準（BDD）

### シナリオ 1: 新 sink の追加は 1 箇所で完結する
- **Given** 5 個目の保存 sink を追加する
- **When** SavePhase の fan-out 表に 1 行を追加する
- **Then** step 配列・retry 配列・dep closure の個別編集は不要である

### シナリオ 2: retry 部分集合は投影で導出される
- **Given** retry 対象の sink 集合
- **When** `retryProjection()` を呼ぶ
- **Then** 手書きの第 2 配列なしで、現行の retry 対象（formatMarkdown+saveObsidian）と同一の集合が返る

### シナリオ 3: 保存語義は不変
- **Given** 4 sink の成否パターン全通り
- **When** 現行と新 Seam の実行結果を比較する
- **Then** 順序・継続・preview 短絡・sqlite 欠如 skip が同一である

## DoD（Definition of Done）

- [x] `save(context, deps)` が唯一 Seam になり、手書き retry 配列と closure 注入が消える
- [x] 既存の保存系テストが無修正で緑（語義不変の証明）
- [x] 保存行列（4 sink×有無×retry）の単体テストが Seam に対して追加される
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- `savePhase.ts` を新設（SAVE_FAN_OUT 表 4 行・`save(context, deps) → SaveReceipt`）。retryProjection は手書き部分集合と名前・strategy・offlineRetry メタデータが完全一致。closure 注入を廃し、sqlite 欠如 skip を明示エラー様式（SqliteClientAbsentError）に。
- 検証: type-check / pipeline 40 ファイル 447 テスト緑（既存 18 ファイルは無修正）。
