# PBI: ダッシュボード診断パネルに OPFS 移行状態を表示

## ユーザーストーリー

開発者として、OPFS 旧DB→新DB 移行（`opfsMigrationV2`）の状態をダッシュボード診断パネルで確認できるようにしたい。なぜなら現状 `OPFS_MIGRATION_V2_DONE` フラグは `chrome.storage.local` に保存されているが UI から一切参照できず、除去判断に必要な「全ユーザーの何%が移行済みか」の手がかりすら得られないから。

出典: [[2026-07-16-07-decide-opfs-migration-v2-removal]] の結論（「計測基盤を先に作る」）。

## ビジネス価値

- `opfsMigrationV2` 除去の判断材料を提供する（いつ除去して安全かの手がかり）
- 移行に失敗したユーザーが診断パネルで問題を発見できる
- 将来の移行コードでも再利用可能な「移行状態可視化」パターンを確立する

## 既実装確認

```bash
# 移行フラグは chrome.storage.local に保存済み
grep -n "OPFS_MIGRATION_V2_DONE" src/utils/storage/types.ts src/utils/storage/defaults.ts
# → types.ts:212 StorageKeys.OPFS_MIGRATION_V2_DONE = 'opfs_migration_v2_done'
# → defaults.ts:152 デフォルト false

# 診断パネルは既存（SQLite 状態・FTS5・OPFS spike 等を表示）
ls src/dashboard/panels/diagnostic/ src/dashboard/diagnosticsPanel.ts

# 状態取得のデータフロー
# dashboardSqliteService.ts → DASHBOARD_SQLITE 'status' → SW dashboardSqliteHandlers.ts 
# → sqliteClient.getStatus() → SQLITE_STATUS → offscreen.ts → sqliteGetStatus()
```

- `OPFS_MIGRATION_V2_DONE` キーは定義済みだが、ダッシュボード・SW・offscreen のいずれからも参照されていない
- 診断パネルは既に OPFS spike テスト・FTS5 状態・乖離警告などを表示する枠組みがある
- 移行失敗時に記録される情報（試行日時、完了日時、レコード数）は現状存在しない

## BDD受け入れシナリオ

```gherkin
Feature: ダッシュボード診断パネルに OPFS 移行状態を表示

  Scenario: 移行完了済みユーザーには「移行完了」が表示される
    Given ユーザーの chrome.storage.local に OPFS_MIGRATION_V2_DONE = true が保存されている
    When  ダッシュボードの SQLite 診断パネルを開く
    Then  「OPFS データ移行: 完了」が表示される
    And   移行完了日時と移行レコード数が表示される（記録がある場合）

  Scenario: 移行未完了ユーザーには「未移行」が表示される
    Given ユーザーの chrome.storage.local に OPFS_MIGRATION_V2_DONE = false が保存されている
    When  ダッシュボードの SQLite 診断パネルを開く
    Then  「OPFS データ移行: 未完了」が表示される
    And   最終試行日時が表示される（記録がある場合）

  Scenario: 移行フラグが存在しないユーザー（初回起動）には何も表示されない
    Given ユーザーが新規インストールで、OPFS_MIGRATION_V2_DONE キーが存在しない
    When  ダッシュボードの SQLite 診断パネルを開く
    Then  移行状態の表示行が存在しない（または「対象外」と表示される）

  Scenario: 移行試行・完了のタイムスタンプが Worker 起動時に記録される
    Given OPFS Worker が起動し runMigrationV2() が実行される
    When  移行が試行される
    Then  chrome.storage.local に OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT が記録される
    And   移行が成功した場合、OPFS_MIGRATION_V2_COMPLETED_AT が記録される
```

## 受け入れ基準
- [ ] `opfsWorker.ts` の `runMigrationV2()` で移行試行日時・完了日時を `chrome.storage.local` に記録する
- [ ] `StorageKeys` に `OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT`、`OPFS_MIGRATION_V2_COMPLETED_AT`、`OPFS_MIGRATION_V2_RECORD_COUNT` を追加
- [ ] `sqliteGetStatus()`（offscreen側）の戻り値に移行状態フィールドを追加
- [ ] `dashboardSqliteService.ts` の `SqliteStatus` 型に移行状態フィールドを追加
- [ ] ダッシュボード診断パネル（`diagnosticsPanel.ts` または `panels/diagnostic/`）に移行状態の表示行を追加
- [ ] i18n メッセージ（日英）を追加

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `opfsWorker.ts`: `runMigrationV2()` が移行試行/完了時に storage に書き込むことのテスト
- `diagnosticsPanel.ts`: 移行状態の表示/非表示の分岐テスト（完了/未完了/対象外）

### 統合テスト
- `offscreen.ts`: `SQLITE_STATUS` ハンドラが移行状態フィールドを含むことのテスト

## 実装アプローチ
- **Inside-Out**: データ層（storage keys → opfsWorker 記録 → offscreen 状態取得 → dashboard 表示）の順に実装
- 既存の診断パネル（`diagSqliteStats`）に移行状態行を追加する最小限の変更

## 見積もり
3pt（データ層2ファイル + offscreen状態 + dashboard表示 + i18n + テスト）

## 技術的考慮事項
- 依存関係: 本PBI単体で完結。他PBIとは独立
- `chrome.storage.local` が Worker 内で利用不可の場合のフォールバック（既存の `chromeStorageAvailable` フラグを流用）
- 移行状態の表示は診断パネルの「SQLite 状態」セクション（`diagSqliteStats`）内に追加するのが自然

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "OPFS_MIGRATION_V2_DONE" src/utils/storage/types.ts src/utils/storage/defaults.ts
grep -n "runMigrationV2" src/offscreen/opfsWorker.ts
grep -n "sqliteGetStatus" src/offscreen/offscreen.ts
grep -n "diagSqliteStats" src/dashboard/diagnosticsPanel.ts src/dashboard/panels/diagnostic/diagnosticsPanel.ts
```

### 実装手順
1. `src/utils/storage/types.ts` と `defaults.ts` に新キー（`OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT`、`OPFS_MIGRATION_V2_COMPLETED_AT`、`OPFS_MIGRATION_V2_RECORD_COUNT`）を追加
2. `src/offscreen/opfsWorker.ts` の `runMigrationV2()` 内で、移行試行時・完了時に `chrome.storage.local` へ書き込む
3. `src/offscreen/offscreen.ts` の `sqliteGetStatus()` で `chrome.storage.local` から移行状態を読み取り、戻り値に含める
4. `src/background/handlers/dashboardSqliteProtocol.ts` の status 戻り値型に移行フィールドを追加
5. `src/dashboard/dashboardSqliteService.ts` の `SqliteStatus` 型に移行フィールドを追加
6. `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（または旧 `diagnosticsPanel.ts`）の `diagSqliteStats` に移行状態行を追加
7. i18n メッセージを追加（`_locales/ja/messages.json`、`_locales/en/messages.json`）

### 落とし穴
- `opfsWorker.ts` 内では `chrome.storage.local` が利用不可の可能性がある。既存の `runMigrationV2()` 内の `chromeStorageAvailable` パターンを踏襲すること
- 本PBIの目的は「除去判断の材料提供」であり、ダッシュボード UI の凝り過ぎに注意。最小限の情報表示でよい
- 移行未了ユーザーへの警告表示（「データ移行が完了していません」等の赤文字）は本PBIのスコープ外。状態表示のみ

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] ダッシュボード診断パネルに移行状態が表示される
- [ ] コードレビュー完了
