# PBI: pendingSqliteQueueに定期リトライアラームを追加する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（新規アラーム追加のため、既存の他アラームとの実行タイミング競合がないか確認が必要）

## 実装メモ（2026-07-26）

フェーズ0確認で、リトライ処理関数`flushPendingRecords()`（`pendingSqliteQueue.ts:73`）が既に実装済み
であることを確認した（PBI記載の`retryPendingSqliteWrites()`相当）。ただし呼び出し箇所は
`lifecycleHandlers.ts`のService Worker起動時のみで、定期アラームからの呼び出しは存在しなかった。

既存アラーム一覧を確認したところ`yasumaro-offline-network-retry`（5分間隔）が既に存在し、
レポートが提案する「既存アラームへの統合」案を採用した。`service-worker.ts`の該当アラーム
ハンドラー（653-654行目）に`flushPendingRecords(sqliteClient)`の呼び出しを1行追加した。

`service-worker.test.ts`に`pendingSqliteQueue.js`の`vi.mock`を追加し、
「offline-network-retryアラームでpendingSqliteQueueがリトライされる」テストを1件追加した。
既存の`chrome.alarms.onAlarm dispatch`テストブロックの構造（`onAlarmListener`を直接呼び出し、
非同期ディスパッチを`setTimeout`で待つパターン）に倣った。

`pendingSqliteQueue.test.ts`（既存）・`service-worker.test.ts`（151件、新規1件含む）ともに
全てパス。型チェック・全テストスイート（7372件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の System Architect（および重複指摘）からの指摘。`src/background/pendingSqliteQueue.ts` はSQLite insert失敗時にキューへエンキューされるが、定期リトライのトリガーが存在しない。拡張機能が再起動されるまで再試行されず、データ損失のリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "alarm\|Alarm\|chrome.alarms" src/background/pendingSqliteQueue.ts
grep -n "chrome.alarms.create" src/background/service-worker.ts
```

既存の `service-worker.ts` に登録されているアラーム一覧（`yasumaro-daily-purge`, `yasumaro-offline-network-retry` 等）を確認し、命名規則・実行間隔を揃える。既存の `yasumaro-offline-network-retry` アラーム内で併せて処理する案（レポート提案）と、新規専用アラームを追加する案のどちらが適切か判断する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 定期アラームでpendingSqliteQueueが再試行される
  Given pendingSqliteQueueに未処理のエントリがある
  When 定期アラーム（例: yasumaro-pending-sqlite-retry、5分間隔）が発火する
  Then キュー内のエントリがSQLiteへの再書き込みを試行される

Scenario: 再試行が成功したエントリはキューから削除される
  Given リトライでSQLite書き込みが成功する
  When リトライ処理が完了する
  Then 該当エントリがpendingSqliteQueueから削除される

Scenario: 再試行が失敗した場合はキューに残る
  Given リトライでSQLite書き込みが再度失敗する
  When リトライ処理が完了する
  Then 該当エントリはキューに残り、次回のアラームで再試行される
```

## 受け入れ基準
- [ ] `pendingSqliteQueue.ts` にキュー内容を処理する関数（`retryPendingSqliteWrites()` 等）を実装する
- [ ] `service-worker.ts` に定期アラーム（既存の `yasumaro-offline-network-retry` に統合するか、新規 `yasumaro-pending-sqlite-retry` を追加）を登録する
- [ ] アラーム発火時にキュー処理関数が呼ばれるようリスナーを追加する
- [ ] 既存の `pendingSqliteQueue` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- キュー処理関数が成功エントリを削除し失敗エントリを残すことを確認
- アラームリスナーが正しく登録されていることを確認

### 統合テスト
- アラーム発火から実際のSQLite再書き込みまでの一連の流れを確認

## 実装アプローチ

1. `pendingSqliteQueue.ts` にリトライ処理関数を実装（既存のSQLite書き込みロジックを再利用）
2. `service-worker.ts` の `init()` にアラーム登録を追加
3. `chrome.alarms.onAlarm` リスナーに処理を追加
4. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/sqliteClient.ts`
- テスタビリティ: `chrome.alarms` のモックで発火をシミュレート可能
- 非機能要件: データ整合性

## Definition of Done
- [ ] 定期リトライアラームが実装されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（System Architect指摘、重複を統合）
- 対象コード: `src/background/pendingSqliteQueue.ts`, `src/background/service-worker.ts`
