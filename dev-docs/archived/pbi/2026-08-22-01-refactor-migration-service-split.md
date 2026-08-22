# PBI: MigrationService の分割 — 4ジョブの god module を LegacyMigration / OpfsRecovery に分離

## ユーザーストーリー
開発者として、565行の MigrationService をジョブ別モジュールに分割し、status/progress/retry の状態マシンを storage adapter の背後に隠したい、なぜなら legacy移行・backfill・cleanup・OPFS復旧という無関係な4ジョブが1クラスに同居し、retry/give-up ロジックが chrome.storage 直呼び出し25箇所に埋もれてテスト不能だから

## 優先度
- 順位: 1 / 4（pass 2）
- RICEスコア: 213（Reach=200 / Impact=2 / Confidence=80% / Effort=1.5人週）
- 根拠: 全ユーザーが起動時マイグレーション経由で通過。Impact 2（god module + 隠れた状態マシン）。Confidence 80%（`PersistentRetryQueue`/`QueueStorageAdapter` に同一パターンの実績あり、消費者は2箇所のみ）。Effort 1.5週。pass 1 の5件（RICE 1200〜12.5）より優先度は低いが、本波内では最高

## BDD受け入れシナリオ

```gherkin
Scenario: legacy移行だけを必要とする消費者が最小依存で動く
  Given LegacyMigration モジュールが run() と mapLegacyEntryToRecord() を公開する
  When deferredMigrations が LegacyMigration.run() を呼ぶ
  Then OpfsRecovery への依存なく移行が完了し、status/progress/retry が内部 seam で管理される

Scenario: retry give-up が chrome mock なしで検証できる
  Given InMemoryMigrationStateAdapter が注入された LegacyMigration がある
  When run() が MAX_MIGRATION_RETRY_COUNT 回連続で失敗する
  Then status が 'failed_permanently' になり、以降の run() が即座に skip することを単体テストで確認できる

Scenario: OPFS復旧は独立した interface で呼ばれる
  Given OpfsRecovery モジュールが needsMigration() と migrate() を公開する
  When dashboardSqliteWiring が needsMigration() を呼ぶ
  Then LegacyMigration の状態（progress/retryCount）を読み書きしない

Scenario: 純粋マッパーは両モジュールから共有される
  Given mapLegacyEntryToRecord が純粋関数としてエクスポートされている
  When legacy entry（28フィールド）を変換する
  Then tags join・null デフォルト・fallback_triggered の boolean→0/1 変換が現行と同一である

Scenario: エラー — ストレージ自体が落ちた場合も retry 記録は best-effort
  Given chrome.storage.local が例外を投げる
  When run() の外側 catch が recordFailureAndMaybeGiveUp() を呼ぶ
  Then retry 記録失敗を WARN ログに残し、クラッシュせず次回起動に委ねる（現行挙動を維持）
```

## 受け入れ基準
- [ ] `migrationService.ts`（565行）が `legacyMigration.ts` と `opfsRecovery.ts` に分割され、各ファイルが400行未満である
- [ ] status/progress/retryCount の6つの private accessor が `MigrationStatePort`（get/set per key）の背後に置換され、production は `ChromeStorageAdapter`（既存 `queueStorageAdapter.ts` を再利用または薄くラップ）、テストは InMemory 実装を使う
- [ ] `deferredMigrations.ts` と `dashboardSqliteWiring.ts` の import が新モジュールへ更新され、各自が必要とするジョブのみに依存する
- [ ] `mapLegacyEntryToRecord` と `convertFallbackRecord` が現行の変換結果と同一であることを契約テストで固定
- [ ] retry/give-up 状態遷移（pending → completed / fresh_install / failed_permanently）が InMemory adapter 越しの単体テストで網羅される
- [ ] `npm run type-check` / `npm test` がパスし、既存マイグレーション系テストが全て生きている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能ロード時に migrationService.run() が起動フローから呼ばれ、legacy データがある環境で SQLite へ移行完了するシナリオ（既存 E2E があれば流用）

### 統合テスト
- LegacyMigration + ChromeStorageAdapter（chrome.storage モック）でバッチ部分成功 → progress checkpoint → 再開の統合テスト
- dashboardSqliteWiring 経由の backfillDiagnosticMetadata → cleanupLegacyStorage の一連の呼び出し

### 単体テスト
- MigrationStatePort の InMemory 実装による give-up 状態遷移（retryCount 0→5、failed_permanently 後の skip）
- mapLegacyEntryToRecord の境界値（tags 空/非空、aiSummary 非文字列、maskedCount 未定義）
- OpfsRecovery.needsMigration() の判定条件

## 見積もり
3pt（要チームでの見積もり）— 分割自体は機械的だが、状態マシンの port 化と既存テストの DI 移行が含まれる

## 技術的考慮事項
- 依存関係: なし。pass 1 PBI（2026-08-21-01〜05）完了後に着手するのが全体順序として自然だが、技術的な前提はない
- テスタビリティ: `queueStorageAdapter.ts` の `QueueStorageAdapter`（get/set インターフェース）をそのまま再利用できるか検証。キー数が異なる場合は薄い `MigrationStatePort` に委譲
- 非機能要件: マイグレーション進捗の永続化キー（YASUMARO_MIGRATION_STATUS 等3キー）とその値形式は不変。ユーザーの中途データに互換性が必要

## 実装者向け注記

### 現状コードの確認
```bash
# 4ジョブと状態マシンの実態
grep -n "async \|function \|export" src/background/migrationService.ts | head -20
# 消費者
grep -rn "from './migrationService.js'" src/background/
# 先行パターン（adapter）
sed -n '1,60p' src/background/queueStorageAdapter.ts
```

### 実装手順
1. `mapLegacyEntryToRecord` / `convertFallbackRecord` を `legacyEntryMapper.ts`（新規・純粋関数のみ）に抽出し、契約テストで現行出力を固定
2. `MigrationStatePort` インターフェース（getStatus/setStatus/getProgress/setProgress/getRetryCount/setRetryCount 相当）を定義し、ChromeStorage 実装と InMemory 実装を作る
3. `legacyMigration.ts`: run() + recordFailureAndMaybeGiveUp + backfillDiagnosticMetadata + cleanupLegacyStorage を移植。状態アクセスを port 経由に置換
4. `opfsRecovery.ts`: needsOpfsRecoveryMigration + migrateOpfsRecovery を移植
5. `migrationService.ts` を後方互換ファサード（既存クラス名で両モジュールに委譲）として一時維持し、消費者2ファイルを個別に新モジュール参照へ更新
6. ファサード削除、`migrationService.test.ts` を新構造へ移行
7. `npm run type-check` → `npm test` → `npm run build`

### 落とし穴
- `run()` 内の progress checkpoint は「バッチ成功時は5バッチごと」「失敗時は即時」の2パターンがあり、port 化時にこの書き込みタイミングを変えると中断からの再開位置がずれる。タイミングは現行どおり維持
- `cleanupLegacyStorage` は diagnostics パネルから呼ばれる破壊的操作。confirm dialog はパネル側にあるため、モジュール側に UI を持ち込まないこと
- OPFS復旧判定は fallback storage キー（`FALLBACK_STORAGE_DATA`）の有無を見る。LegacyMigration 側の状態と混ぜない

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（give-up 状態遷移の分岐）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（ファサード削除、消費者移行済み）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の SQLite migration 記述を新構造に更新）
