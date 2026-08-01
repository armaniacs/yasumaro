# PBI: オフラインキュー再送にサイクル上限とレート制限を追加する

**作成日**: 2026-08-01
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（再送処理のスループット制御追加。既存のジョブ処理ロジック自体は変えない）

---

## 背景

Checking Team レビュー（`plans/2026-08-01-1903-review-yasumaro.md`）の FinOps Consultant からの High指摘「オフライン復旧時にAI APIコストがバーストする」。事実確認の結果、**指摘の一部は既に対策済み、一部は依然として妥当なリスク**と判明した。

### 事実確認で判明したこと

- キュー上限 `MAX_QUEUED_JOBS = 200`（`offlineNetworkQueue.ts:25`）、再送アラーム間隔5分（`service-worker.ts:95`）は事実。
- レビューの「RETRY4回」は誤り。正しくは `MAX_RETRY_COUNT = 3`（`offlineNetworkQueue.ts:28`）。
- レビューの「200×4=800回」という計算は成立しない。`retryAll()` は1サイクルにつき1ジョブ1回しかハンドラを実行しないため、1サイクルの理論上限は最大200回。
- **既に別PBI（`2026-07-26-14-fix-offline-queue-retry-skip-ai.md`、アーカイブ済み）で対策済み**: `job.type === 'obsidian_sync'` かつ `payload.summary` がある場合は `retryObsidianWriteOnly()` が呼ばれ、AI API呼び出し自体をスキップする分岐が既に実装されている。全ジョブがAI再実行を伴うわけではない。
- **未対策のまま残っている事実**: `retryAll()` にはサイクルあたりの処理件数上限もレート制限機構も存在しない。`ai_summary` 型ジョブ（またはsummary未設定の旧形式ジョブ）が大量に溜まった場合、1回のアラーム発火で最大200件のクラウドAI呼び出しが直列実行される可能性は残る。複数サイクルにまたがれば呼び出しは累積し続ける。

本PBIは、**既に対策済みのAI再実行スキップ機構を除いた**、サイクル上限・レート制限部分のみをスコープとする。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "MAX_QUEUED_JOBS\|MAX_RETRY_COUNT" src/background/offlineNetworkQueue.ts
grep -n "retryObsidianWriteOnly\|job.type === 'obsidian_sync'" src/background/offlineQueueProcessor.ts src/background/recordingLogic.ts
grep -n "periodInMinutes" src/background/service-worker.ts
```

`retryObsidianWriteOnly()` が既に実装されていること（AI再実行スキップ機構は対応不要）を確認した上で、`retryAll()` にサイクル処理件数上限やレート制限が本当に存在しないことを再確認してから着手する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 1サイクルあたりの処理件数に上限がある
  Given オフラインキューにai_summary型のジョブが100件溜まっている
  When retryAll()が1回のアラーム発火で実行される
  Then 処理されるジョブ数は設定された上限（例: 20件）を超えない

Scenario: 上限を超えた残りのジョブは次回サイクルに持ち越される
  Given 1サイクルの処理上限が20件で、キューに50件のジョブがある
  When 1回目のretryAll()が実行される
  Then 20件のみ処理され、残り30件は次回アラーム発火時に処理される

Scenario: 上限設定は既存の再送ロジック（成功/失敗判定、AI再実行スキップ）と両立する
  Given サイクル処理件数上限が導入された状態
  When obsidian_sync型（AI再実行不要）とai_summary型が混在するキューを処理する
  Then それぞれ従来通りの分岐（AI呼び出しの有無）で処理される
```

## 受け入れ基準
- [ ] `retryAll()`（または呼び出し元）に、1サイクルあたりの処理ジョブ数上限（設定値、デフォルト値は要検討）を追加する
- [ ] 上限を超えた分のジョブはキューに残り、次回アラーム発火時に処理されることを保証する
- [ ] 既存のAI再実行スキップ分岐（`retryObsidianWriteOnly`）や `MAX_RETRY_COUNT` によるジョブ破棄ロジックと矛盾なく共存する
- [ ] 既存の `offlineNetworkQueue` / `offlineQueueProcessor` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 統合テスト
- 上限件数を超えるジョブがキューにある状態で `retryAll()` を実行し、処理件数が上限内に収まり残りが次回に持ち越されることを確認

### 単体テスト
- 上限設定値未満のジョブ数では全件処理されることを確認
- 上限ちょうど・上限超過の境界値で正しく打ち切られることを確認
- 上限適用後も既存の `retryCount` 更新・AI再実行スキップ分岐が正しく動作することを確認

## 実装アプローチ
- **Outside-In**: 統合テスト（上限超過時の挙動）から開始し失敗を確認 → 単体テスト（境界値）→ 実装
- **Red-Green-Refactor**: 各レイヤーでTDDサイクルを適用

## 見積もり

2pt（上限値の追加 + `retryAll()`のスライス処理 + 境界値テスト）

## 技術的考慮事項
- 依存関係: `src/background/offlineNetworkQueue.ts:92-125`（`retryAll()`）, `src/background/offlineQueueProcessor.ts`
- テスタビリティ: 既存のオフラインキューテストのモック基盤を流用可能
- 非機能要件: コスト制御（FinOps）。上限値は将来設定可能にする余地を残すが、本PBIでは固定定数として導入し、設定UI化は別PBIとする
- PBI-14（アラームリスナーのasync化）と技術的に近接する。上限導入により1サイクルの処理時間が短縮され、PBI-14のSW生存期間問題の緩和にも寄与する

## Definition of Done
- [ ] サイクルあたり処理件数上限が実装されている
- [ ] 上限超過時に残りジョブが次回サイクルに持ち越されることがテストで検証されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-08-01-1903-review-yasumaro.md`（FinOps Consultant指摘、High #4）
- 対象コード: `src/background/offlineNetworkQueue.ts:25,73`, `src/background/offlineQueueProcessor.ts:53-61`, `src/background/service-worker.ts:693-702`
- 事実確認: 「200×4=800回」は誤り（正しい理論上限は最大200回/サイクル）。AI再実行スキップは`2026-07-26-14`で対策済み。サイクル上限・レート制限の不在のみが未対策の残存リスク
- 関連PBI: PBI-14（アラームリスナーのSWライフサイクル対応）と関心が近接
