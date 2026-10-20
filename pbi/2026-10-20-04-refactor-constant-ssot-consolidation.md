# PBI 04: 定数 SSOT 統合（mirror 契約・同値二重定義 約 25 箇所）

## ユーザーストーリー
メンテナーとして、同値の定数が 1 箇所で定義された状態がほしい、なぜなら mirror 契約（コメントで同値を約束するだけ）や二重定義は、片側修正で書き手と読み手が解け、purge・buffer・ワイヤ契約が静かに壊れるから。

## 変更点の概要
同値の二重定義を SSOT 参照へ統一する。すべて値が同一の統合で、挙動は不変。

## 現状と問題（統合対象と行き先）
| 箇所 | 現状 | 行き先 |
|---|---|---|
| primitives.ts:18-19 vs hmacKeyStore.ts:71-72 | KEY_LENGTH=256 / IV_LENGTH=12 二重定義 | cryptoParams.ts へ |
| settingsMigration.ts:619 / privacyConsent.ts:520 / savedUrlRepository.ts:314 / trancoChangeDetector.ts:223 | 日数ミリ秒 inline | trancoConsent.ts:16 の MS_PER_DAY を共有 |
| recordingOutcome.ts:84 / offlineQueueProcessor.ts:25 / pendingSqliteQueue.ts:40 | 24h TTL ×3 | 共有定数 |
| fetch.ts:137,240,416 | 既定タイムアウト 30000 ×3（MIN/MAX_TIMEOUT_MS は命名済み） | DEFAULT_TIMEOUT_MS を新設 |
| saveLocalMarkdownStep.ts:22 vs MarkdownBufferManager.ts:13 | 'local_export_' 二重定義 | 1 定数を共有 |
| urlNotificationHandlers.ts:25,59 | 'privacy-confirm-' ローカル | notificationHelper.ts:6 の既存定数へ |
| dashboardSqliteWiring.ts:35-36 | 'yasumaro_migration_status/progress' ハードコード | StorageKeys.YASUMARO_MIGRATION_STATUS/PROGRESS へ |
| sqliteHistoryModel.ts:261 | HISTORY_SORT_STORAGE_KEY リテラル | StorageKeys.HISTORY_SORT_PREFERENCE へ（値変更はしない） |
| sqliteHistoryModel.ts:260 vs sqliteHistoryPanelView.ts:313 | PAGE_SIZE=20 並行 | 共有定数 |
| queryPlanner.ts:30-31 | 90/1000 を mirror 契約で再定義 | dbMaintenance.ts から import（パリティテスト追加） |
| defaults.ts:49 | OPENAI_2_BASE_URL 直書き | PROVIDER_DEFAULT_BASE_URLS へ |
| storageFallback.ts:444,505 | 保持日数式 inline ×2 | queryPlan.ts:751 の式を共有 |
| tokenizer.ts:73 | 全角句読点文字クラス 2 回重複 | 1 クラスへ |
| flushScheduler.ts:35 | suspend タイムアウト 3000ms ハードコード | 定数化（命名のみ） |

## 変更の理由
[DRY] すべて同値の統合。片側だけの修正で buffer/purge スイープの別キー空間化（データ消失）や wrong asset ロードが起きる drift 歴があるミラー群。

## BDD受け入れシナリオ
Scenario: 統合後も同じ値が使われる
  Given 統合前に各定数の値を記録する
  When SSOT 参照へ置き換える
  Then 全呼び出し箇所の実効値は変更前と同一である

Scenario: mirror 契約のパリティ
  Given queryPlanner の保持既定値
  When dbMaintenance の値を import する
  Then 両者は同一オブジェクトを参照し、片側変更がもう片方へ波及する

## 見積もり
2 pt（RICE: 50 = Reach 25 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 表の全箇所で SSOT 参照に統一され、二重定義が消える
- [ ] ミラー群のパリティを pin するテスト追加
- [ ] npm run validate 通過
