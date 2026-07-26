# PBI: オフラインキューのリトライ時にObsidian書き込みのみ再試行しAI要約を再実行しない

**作成日**: 2026-07-26
**優先度**: High
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（リトライ処理のロジック変更。既存のオフラインキューデータ構造にAI要約結果を含める必要があり、後方互換性の考慮が必要）

---

## スキップメモ（2026-07-26）

実装着手前の追加調査で、`RecordingData`型に既に`skipAi?: boolean`フィールドが存在するが、
`RecordingPipeline.ts`・`processPrivacyPipelineStep.ts`のどこからも一切参照されていない
デッドフィールドであることを確認した。既存の`alreadyProcessed`フラグ（`privacyPipeline.ts:73`）
はローカルAI・マスキング設定のみを制御し、クラウドAI呼び出し自体（`privacyPipeline.ts:132-142`、
L3 Cloud Summarization）はスキップしない。

つまり「`payload.summary`が既にある場合はAI要約をスキップしてObsidian書き込みのみ行う」という
分岐を実装するには、既存フラグの再利用では済まず、`processPrivacyPipelineStep.ts`・
`RecordingPipeline.ts`・`recordingLogic.ts`・`service-worker.ts`の4ファイルにまたがる新規実装が
必要だと判明した。当初見積もり（🟡中、2pt）よりも実際の規模が大きく、既存のリトライフロー全体
（ロック機構、他ステップとの相互作用）への影響リスクも考慮すべきと判断し、ユーザー確認の上で
本セッションでは実装を見送った。着手する際は上記4ファイルの変更範囲を前提に再見積もりすること。

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の FinOps Consultant, Tuning Expert からの High指摘。`src/background/service-worker.ts:436-459`（現状の `processOfflineNetworkQueue()`）は `recordingLogic.record()` を呼び出し、Obsidian書き込み失敗のリトライ時にパイプライン全体（AI要約含む）を再実行する。`recordingLogic.record()` が常にAI要約を実行する設定の場合、本来不要な追加AI APIコールが発生し、最大3回の追加コール + 5分間隔のアラームリトライで無視できないコストになりうる。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "processOfflineNetworkQueue\|recordingLogic.record" src/background/service-worker.ts
grep -n "interface OfflineJob\|job.type\|job.payload" src/background/*.ts src/utils/*.ts 2>/dev/null
```

`OfflineJob` の型定義を確認し、AI要約結果（summary）を既にpayloadに含んでいるか（`payload.summary` フィールドが439行付近に存在することを確認済み）確認する。既にsummaryを保持しているなら、リトライ時にAI要約をスキップしてObsidian書き込みのみ行う経路を作ることは比較的小さな変更で済む。

## 受け入れ基準（BDD）

```gherkin
Scenario: Obsidian書き込み失敗のリトライではAI要約を再実行しない
  Given オフラインキューにObsidian書き込み失敗のジョブがあり、payload.summaryに既にAI要約結果が保存されている
  When processOfflineNetworkQueue() がこのジョブをリトライする
  Then AI APIは呼び出されず、保存済みのsummaryを使ってObsidian書き込みのみが再試行される

Scenario: summaryが保存されていない古い形式のジョブは従来通り処理する
  Given オフラインキューに summary フィールドを持たない旧形式のジョブがある
  When リトライが実行される
  Then 後方互換のため recordingLogic.record() のフルパイプラインが実行される（AI要約も含む）

Scenario: リトライ成功時はキューから正しく削除される
  Given Obsidian書き込みのみのリトライが成功する
  When リトライ処理が完了する
  Then 該当ジョブがオフラインキューから削除される
```

## 受け入れ基準
- [ ] `OfflineJob` の `payload` にAI要約結果（`summary`）が含まれる場合、リトライ時はObsidian書き込み専用の軽量な関数（AI要約をスキップする経路）を呼び出す
- [ ] `payload.summary` が存在しない旧形式のジョブは、後方互換のため従来通り `recordingLogic.record()` のフルパイプラインを実行する
- [ ] 既存の `service-worker` / オフラインキュー関連テストが全てパスする
- [ ] リトライ時にAI APIモックが呼ばれないことを確認するテストを追加する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `summary` を含むジョブのリトライで、AI要約関数のモックが呼び出されないことを確認
- `summary` を含まない旧形式ジョブのリトライで、従来通りフルパイプラインが実行されることを確認

### 統合テスト
- オフラインキュー全体のリトライフロー（追加→リトライ→成功→削除）が回帰しないことを確認

## 実装アプローチ

1. `recordingLogic.ts` または新規モジュールに、Obsidian書き込みのみを行う軽量関数（例: `recordingLogic.retryObsidianWriteOnly()`）を追加
2. `processOfflineNetworkQueue()` を、`payload.summary` の有無で分岐するよう変更
3. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/recordingLogic.ts`, `src/background/service-worker.ts:436-459`
- テスタビリティ: AI APIモックの呼び出し有無を検証可能な既存テスト基盤
- 非機能要件: コスト削減（FinOps）、パフォーマンス

## Definition of Done
- [ ] Obsidian書き込み専用のリトライ経路が実装されている
- [ ] AI要約の不要な再実行がテストで検証されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（FinOps Consultant, Tuning Expert指摘、High）
- 対象コード: `src/background/service-worker.ts:436-459`

## 実装メモ（2026-07-26完了、当初のスキップ判断を覆した経緯）

前回セッションで「4ファイルにまたがる新規実装が必要」と判断しスキップしていたが、
`RecordingPipeline.ts`の`enqueueOfflineJob()`（385行目）を再調査した結果、
**当初懸念より大幅に小さい規模で実装可能**と判明した。

決め手となった事実: `enqueueOfflineJob()`は失敗ステップ名に応じて
`type: stepName === 'saveObsidian' ? 'obsidian_sync' : 'ai_summary'`という形で
**既にジョブの種類を判別してキューに積んでいた**（`OfflineJob.type`は
`'ai_summary' | 'obsidian_sync'`のリテラル型ユニオン、`offlineNetworkQueue.ts:12`）。
つまり「AI要約が既に成功しObsidian書き込みだけが失敗した」ケースは
`type === 'obsidian_sync'`かつ`payload.summary`ありのジョブとして既に区別可能で、
新規のフラグや型追加は不要だった。

実装内容:
- `src/background/recordingLogic.ts`に`retryObsidianWriteOnly(job)`メソッドを追加。
  最小限の`RecordingContext`（`data`, `settings`, `force`, `errors`, `privacyResult.summary/tags`）を
  組み立て、既存の`formatMarkdownStep` → `saveToObsidianStep`の2関数のみを呼ぶ
  （フルパイプラインの`RecordingPipeline.execute()`は呼ばない → AI要約ステップを経由しない）
- `src/background/service-worker.ts`の`processOfflineNetworkQueue()`に、
  `job.type === 'obsidian_sync' && payload.summary`の場合は`retryObsidianWriteOnly()`を、
  それ以外（`ai_summary`型、または`summary`のない旧形式ジョブ）は従来通り
  `recordingLogic.record()`のフルパイプラインを呼ぶ分岐を追加
- `src/background/__tests__/recordingLogic.test.ts`に`retryObsidianWriteOnly`の単体テスト2件
  （AI未呼び出しでのObsidian保存成功、Obsidian書き込み失敗時のエラー伝播）を追加
- 変更ファイルは`recordingLogic.ts`と`service-worker.ts`の2ファイルのみ
  （`processPrivacyPipelineStep.ts`への変更は不要だった）
- `npm run type-check`・全7269テスト・`npm run build`とも成功
