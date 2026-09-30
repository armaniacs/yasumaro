# PBI: 監査ログ（audit_log）に保持期間と削除経路を設ける

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ1）。監査ログが無期限保持され、clear_all でも消えない状態を解消する。

## ユーザーストーリー

拡張を利用者として、AI 送信履歴（監査ログ）を明示的に全削除でき、一定日数を超えたら自動的に消える状態が欲しい、なぜなら「どのプロバイダにどの URL を送ったか」の記録はプライバシー保証の根幹であり、消せないままだと保証にならないから

## 優先度

- 順位: 1 / 10
- RICE スコア: 36.0（Reach=6 / Impact=3 / Confidence=100% / Effort=0.5）
- 根拠: 削除経路が存在しないのは仕様欠落であり確度は 100%。sweep SQL と clearAll への追記で完結し、プライバシー記述の整合という高リスク面も同時に閉じる

## 現状と問題（file:line 証拠付き）

- 監査ログの書き込みは `src/messaging/auditLogGateway.ts:45-55`。クラウド AI 送信ごとに 1 行を `insertAuditLog` に `created_at: Date.now()` で追記する。best-effort 設計で失敗はログのみ
- スキーマに保持期限を表す列がない: `src/offscreen/schema.ts:431-438`
- リポジトリ全体に `DELETE FROM audit_log` が 0 件。削除経路そのものが未定義（rg で確認済み）
- 既存の purge は `browsing_logs` のみ: `src/offscreen/queryPlan.ts:578,582`（purgeOldRecords / content purge SQL）、`src/offscreen/opfsWorker/purgeHandlers.ts:95-100`（handleClearAll は `DELETE FROM browsing_logs` のみ）、`src/offscreen/IdbVfsBackend.ts:407-413`（clearAll も同様）
- 保持期間の一元管理装置 `src/background/dailyPurgeHandler.ts:82-139` は 5 種の sweep（clearExpiredPages / purgeOldRecords / purgeContent / cleanupExpiredSettingsBackups / purgeExpiredDownloadRecords / sweepExpiredLocalExportBuffers）を持つが audit_log を含まない
- 結果として、ユーザーの明示的削除操作（clear_all）でも消えない無期限保持になっている

## 改善方針（方向性）

1. `src/background/dailyPurgeHandler.ts:82-139` に audit_log の保持 sweep を追加する。SQL は `DELETE FROM audit_log WHERE created_at < ?` とし、opfs / IDB 両経路に実装する。保持日数は独立キーとし、既定値は browsing_logs の content 保持設定の既定値に合わせる
2. `src/offscreen/opfsWorker/purgeHandlers.ts:95-100` の handleClearAll と `src/offscreen/IdbVfsBackend.ts:407-413` の clearAll に `DELETE FROM audit_log` を追加する
3. purge 失敗時に「0 件成功」と誤記録しない規約を踏襲する。先例は `src/background/dailyPurgeHandler.ts:103-105` の PBI-02 コメント（失敗時は 0 件成功ではなく失敗として記録する）

## BDD 受け入れシナリオ

```gherkin
Scenario: 古い監査ログ行が日次 purge で削除される
  Given 監査ログに既定保持期間より古い行と新しい行がある
  When 日次 purge が走る
  Then 古い行のみ削除され、新しい行は残る

Scenario: clear_all で監査ログも削除される
  Given 監査ログに行がある
  When ユーザーが全データ削除（clear_all）を実行する
  Then browsing_logs と audit_log の両方が空になる

Scenario: purge 失敗が成功として誤記録されない
  Given audit_log の sweep SQL が失敗する
  When 日次 purge の結果が記録される
  Then purged 件数は 0 件成功ではなく、失敗として記録される
```

## 受け入れ基準

- [x] `src/background/dailyPurgeHandler.ts:82-139` に audit_log の保持 sweep が追加され、保持日数の既定値が content 保持の既定値と一致する
- [x] audit_log の sweep が opfs 経路と IDB 経路の両方で同じ SQL として実行される（`src/offscreen/queryPlan.ts:578,582` の既存 purge と同じ規約に従う）
- [x] `src/offscreen/opfsWorker/purgeHandlers.ts:95-100` の handleClearAll が audit_log も削除する
- [x] `src/offscreen/IdbVfsBackend.ts:407-413` の clearAll が audit_log も削除する
- [x] sweep 失敗時に 0 件成功として記録されない（`src/background/dailyPurgeHandler.ts:103-105` の失敗記録規約に準拠）
- [x] 決定: schema 列追加は不要 — 既存 `created_at` フィルタで充足（`idx_audit_log_created` が既にあり、追加も backfill も不要のため該当なし）

## テスト戦略

- 単体: `dailyPurgeHandler` の audit_log sweep 呼び出しと保持期間計算（閾値ちょうど / 直上 / 直下の境界）
- 統合: opfsWorker の purgeHandlers と IdbVfsBackend の purge・clearAll の SQL 経路（dashboardSqliteMock 等の既存モック規約に従う）

## 見積もり

0.5 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

### 変更ファイル

生成（新規）:

- `src/background/__tests__/dailyPurgeAuditLog.test.ts` — 日次 sweep の呼び出し・保持窓・失敗記録
- `src/offscreen/__tests__/auditLogRetention.test.ts` — OPFS / IDB 両経路が同一 SQL を実行すること、clear_all の audit_log 削除
- `src/offscreen/__tests__/auditLogPurgeSeam.test.ts` — メッセージハンドラの fail-closed と各 StorageBackend 実装の応答

変更:

- `src/background/dailyPurgeHandler.ts` — `AUDIT_LOG_RETENTION_DAYS` 定数と `handleDailyPurgeAlarm` の第 4 引数 `purgeAuditLog`。設定で無効化できない無条件 sweep
- `src/background/alarmRegistry.ts` — `maintain({ type: 'purgeAuditLog' })` の PurgeFn を結線
- `src/background/sqlite/offscreenGateway.ts` — `maintain` の `purgeAuditLog` オーバーロード
- `src/offscreen/queryPlan.ts` — `buildAuditLogPurgeStatements`（両経路が共有する単一の SQL 定義）
- `src/offscreen/StorageBackend.ts` — `Mutable.purgeAuditLog` と `NoopBackend.purgeAuditLog`
- `src/offscreen/IdbVfsBackend.ts` — `purgeAuditLog` 実装と `clearAll` への `DELETE FROM audit_log` 追加
- `src/offscreen/OpfsWorkerBackend.ts` — `AUDIT_LOG_PURGE` ワーカーメッセージへの委譲
- `src/offscreen/FallbackStorageAdapter.ts` — fallback は audit_log を持たないため `AUDIT_LOG_UNSUPPORTED_ERROR` で拒否
- `src/offscreen/auditLogRepo.ts` — `purgeAuditLog` リポジトリ関数
- `src/offscreen/sqliteMessageHandlers.ts` — `SQLITE_AUDIT_LOG_PURGE` ハンドラ（`runPlannedPurge` 経由で fail-closed）
- `src/offscreen/opfsWorker/purgeHandlers.ts` — `handleAuditLogPurge` と `handleClearAll` への `DELETE FROM audit_log` 追加
- `src/offscreen/opfsWorker/types.ts` / `src/offscreen/opfsWorker.ts` — `AUDIT_LOG_PURGE` メッセージ型とディスパッチ
- `src/messaging/sqliteMessages.ts` / `src/messaging/sqliteRpcClient.ts` / `src/messaging/sqliteWireTable.ts` / `src/messaging/transportRetryPolicy.ts` — 新メッセージ型の登録（wire table 1 行追加、retry は既存の purge 2 件に倣って `RETRY_UNSAFE`）

テスト追従（網羅的な SSOT ピンの更新）:

- `src/messaging/__tests__/sqliteMessages.test.ts`（33 → 34）
- `src/messaging/__tests__/transportRetryPolicy.test.ts`（wire route 32 → 33、UNSAFE 14 → 15）
- `src/messaging/__tests__/sqliteMaintainWireTable.test.ts`（maintain op 7 → 8）
- `src/offscreen/__tests__/sqliteMessageHandlers-coverage.test.ts`（ハンドラ 33 → 34、auditLogRepo モックに `purgeAuditLog` を追加）

### 検証

```
npx tsc --noEmit -p tsconfig.json                      → エラー 0
npx eslint <変更 20 ファイル>                          → 指摘なし
npx vitest run src/offscreen/__tests__/auditLogRetention.test.ts \
  src/offscreen/__tests__/auditLogPurgeSeam.test.ts \
  src/offscreen/__tests__/sqliteMessageHandlers-coverage.test.ts \
  src/offscreen/__tests__/sqliteHandlers-twins-parity.test.ts \
  src/offscreen/__tests__/StorageBackend-comprehensive.test.ts \
  src/offscreen/__tests__/query-backends-parametric.test.ts \
  src/offscreen/__tests__/opfsWorker-transactionIntegrity.test.ts \
  src/offscreen/__tests__/opfsWorker.test.ts \
  src/background/__tests__/dailyPurgeAuditLog.test.ts \
  src/background/__tests__/dailyPurgeHandler.test.ts \
  src/background/__tests__/daily-purge-alarm.test.ts \
  src/background/__tests__/dailyPurgeExpiredPages.test.ts \
  src/background/__tests__/alarmRegistry.test.ts \
  src/messaging/__tests__ \
  src/background/__tests__/sqliteClient-auditLog.test.ts \
  src/background/__tests__/sqliteMaintainWireDispatch.test.ts \
  src/background/__tests__/sqliteClient-unit.test.ts \
  src/background/__tests__/sqliteClient.test.ts \
  src/background/__tests__/OffscreenTransportBase.retry.test.ts \
  src/background/__tests__/message-types-consistency.test.ts
  → Test Files 48 passed / Tests 653 passed
```

### 逸脱

- 保持日数はユーザー設定にせず名前付き定数 `AUDIT_LOG_RETENTION_DAYS = 7` とした。値は content 保持の既定値
  （`DEFAULT_SETTINGS[StorageKeys.CONTENT_RETENTION_DAYS]`）と一致し、テストで同一性を固定している。`DEFAULT_SETTINGS` は
  全キーが `Partial` かつ nullable な型なので導出すると「既定値が未設定になった日」に sweep が黙って無効化される
- JSON fallback（`FallbackStorageAdapter`）は audit_log 自体を持たないため、成功ではなく `AUDIT_LOG_UNSUPPORTED_ERROR`
  を返す。insert / query と同じ契約
- メッセージ型は `SQLITE_` 接頭辞に揃えた `SQLITE_AUDIT_LOG_PURGE` とした。`CONTENT_PURGE` だけ例外的に接頭辞が無い
  ため、その例子には合わせない

