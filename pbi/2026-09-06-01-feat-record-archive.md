# PBI: 日付指定でのレコードアーカイブ作成（SQLite書き出し＋本体削除）

## ユーザーストーリー

yasumaroの長期利用者として、指定日（例: 2026-03-31）以前の閲覧履歴レコードをまとめて標準SQLiteファイルとして退避し、本体DBからは削除してほしい。なぜなら、保持設定を無制限のままだとストレージが増え続け、既存のパージはデータが失われ、全体エクスポート（.db）は日付絞り込みができず不要なレコードまで含むから。

## ビジネス価値

- **ストレージ解放**: `retentionUnlimitedWarning`（entrypoints/options/index.html:442）が示す無制限蓄積問題を「削除ではなく退避」で解消する。退避先はブラウザ外のダウンロードフォルダなので、ブラウザ内ストレージが実際に減る
- **測定方法**: アーカイブ実行前後の `get_count` 差分 = 退避件数。アーカイブ.db のレコード数が退避件数と一致すること。VACUUM 後の本体 .db ファイルサイズ減少
- **外部可読性**: 書き出された .db は DB Browser for SQLite / sqlite3 CLI でそのまま閲覧できる（標準SQLite形式）

## BDD受け入れシナリオ

```gherkin
Feature: 日付指定アーカイブ

Scenario: 境界日以前のレコードをアーカイブして本体から削除する
  Given 本体DBに 2026-01-10 / 2026-03-31 / 2026-04-02 作成のレコードがある
  And ダッシュボードのアーカイブ日付に 2026-03-31 を入力した
  And 実行前確認に対象件数が表示されている
  When ユーザーが確認トークンを取得して実行する
  Then アーカイブ.db のダウンロードが始まる
  And アーカイブ.db には 2026-01-10 と 2026-03-31 のレコードが含まれる
  And アーカイブ.db には 2026-04-02 のレコードは含まれない
  And 本体DBからは 2026-03-31 以前のレコードが物理削除されている
  And 結果表示に「退避件数」と「本体の残存件数」が表示される

Scenario: スター付きレコードも退避対象に含まれる
  Given 境界日以前に is_starred=1 のレコードがある
  And 実行前確認にスター付き件数が表示されている
  When ユーザーが確認して実行する
  Then スター付きレコードもアーカイブ.db に含まれ、本体から削除される

Scenario: 削除済み行はデフォルトで除外され、含めなかった分は戻せない旨が表示される
  Given 本体DBに境界日以前の is_deleted=1 のレコードがある
  And 実行前確認の「削除済み行を含める」チェックボックスはデフォルトでオフである
  When ユーザーがチェックせずに実行する
  Then アーカイブ.db に is_deleted=1 の行は含まれない
  And 確認画面に「含めなかった削除済み行はアーカイブから復元できない」旨が表示される

Scenario: 削除済み行を含めてアーカイブする
  Given 実行前確認で「削除済み行を含める」をチェックした
  When ユーザーが確認して実行する
  Then アーカイブ.db に is_deleted=1 の行も含まれる
  And yasumaro_archive_meta に include_deleted=1 が記録される

Scenario: 対象0件のときは実行しない
  Given 本体DBに境界日以前のレコードが1件もない
  When アーカイブ日付を入力して確認する
  Then 対象件数 0 件であることが表示される
  And アーカイブ処理は実行されず、本体DBは変更されない

Scenario: 確認トークンなしでは実行できない
  Given アーカイブ対象のレコードが存在する
  When 有効な確認トークンなしでアーカイブ操作が送信される
  Then 操作は拒否され、本体DBは変更されない
```

## 受け入れ基準

- [ ] ダッシュボード（オプションページ）に、日付入力 → 実行前確認（対象件数・スター付き件数・削除済み件数・対象期間の最古/最新日）→ 実行 → 結果表示のUIがある
- [ ] 境界日は「指定日の終日まで」を含む（ローカルタイムゾーンの指定日 23:59:59.999 まで、`created_at <= cutoff`）
- [ ] 実行には確認トークンが必要（破壊的操作として既存の tokenRequired 仕様に従う。tokenExempt に含めない）
- [ ] アーカイブ.db は標準SQLiteで、`browsing_logs` テーブル（`SCHEMA_SQL` 準拠・**FTS5/トリガーなし**）と `yasumaro_archive_meta` テーブル（archived_at / cutoff_created_at / cutoff_date / record_count / include_deleted / yasumaro_version）を含む。`id` 列の値は本体と同一
- [ ] 実行前確認に「削除済み行を含める」チェックボックスがある（**デフォルトOFF = is_deleted=1 を除外**。含めない場合は「含めなかった削除済み行はアーカイブから復元できない」旨を確認画面に表示する）
- [ ] アーカイブ.db はOPFSステージングファイル（`archive_outgoing_<nonce>.db`）経由で引き渡され、dashboard がそれを読んでダウンロードする。ステージングファイルはクリーンアップされるまでOPFSに残り、そこから再ダウンロードできる
- [ ] アーカイブ後、本体DBから対象レコードが物理削除され、VACUUM（または同等の空き領域解放）が実行される
- [ ] OPFS バックエンドでのみ提供する（フォールバック環境では既存の生.dbエクスポートと同様「OPFSストレージでのみ利用可能」の注記を表示）
- [ ] 起動時・次回アーカイブ実行時に孤児ステージングファイル（`archive_outgoing_*.db` / `archive_incoming_*.db` / `yasumaro_archive_tmp_*.db`）を掃除する
- [ ] i18n（en/ja）がすべての新規UI文言に適用されている（data-i18n）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで日付指定 → 確認 → 実行 → 本体件数減少を画面越しに確認（testDir/e2e の dashboard-ui.spec.ts パターンに倣う）

### 統合テスト
- opfsWorker アーカイブハンドラ: 生成されたアーカイブ.db の内容（件数・カラム・meta・FTSなし）と本体削除の整合（sqliteTestApi.js を使う既存テストパターンに倣う）
- 境界値: `created_at == cutoff` は含まれる / `cutoff + 1ms` は含まれない
- セキュリティ: トークンなしでは拒否される（既存の tokenRequired マトリクステストに追加）
- ステージングファイル（`archive_outgoing_*.db`）が検証失敗時に残らず、クリーンアップが機能すること

### 単体テスト
- cutoff 計算（日付文字列 → ローカル終日UTCミリ秒変換、月境界・夏時間（DST）切り替え日）
- アーカイブファイル名生成（`yasumaro_archive_YYYY-MM-DD.db`、同日再実行時の接尾辞）
- meta 生成（include_deleted の反映、record_count と実行件数の一致）
- 削除SQL + VACUUM の実行順序
- 例外ハンドリング: アーカイブ生成が失敗した場合、本体を一切削除しない（fail-safe順序）

## 実装アプローチ

- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

5pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: なし。本PBIがアーカイブファイル形式（`browsing_logs` + `yasumaro_archive_meta`、FTS5なし）を定義し、PBI-02 / PBI-03 がそれを参照する
- **テスタビリティ**: offscreen ハンドラは `sqliteTestApi.js` 経由で実SQLiteによる統合テストが可能。dashboard 側は Gateway / exportDb 相当をモック
- **非機能要件**: 10万件規模でのアーカイブ時間（SELECT→INSERT→DELETE→VACUUM が同期的に長時間化する可能性 → 進捗表示または将来的な非同期化を検討）。CSP遵守（インラインスクリプト禁止）・MV3遵守・`async/await` 使用・`onMessage` の `return true`

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# アーカイブ・退避関連の既存実装の有無を再確認
grep -rn "archive\|ARCHIVE" src/offscreen/ src/messaging/ src/dashboard/ | grep -v test
# 全体.dbエクスポートとダウンロードの既存パターン
grep -rn "exportDb\|downloadBlob" src/dashboard/
# 保持パージ（削除のみ）の現状
grep -rn "purgeOldRecords" src/offscreen/ | head
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。
（2026-09-06 作成時点の調査結果: 日付指定の退避機能は未実装。既存は「削除のみのパージ」「全体バックアップ」「全体.dbエクスポート」のみ）

### 実装手順
1. E2EテストをRedで書く（ダッシュボードUIフロー: 日付入力→確認→実行→件数確認）
2. 統合テストをRedで書く（opfsWorker アーカイブハンドラ: 生成内容・本体削除・境界値・トークン拒否）
3. メッセージ経路に `archive_before`（仮称）を追加: `src/messaging/sqliteMessages.ts` / `sqliteRpcClient.ts`（MaintainOp）、`src/background/handlers/dashboardSqliteProtocol.ts`（subtype）、`src/messaging/sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に追加。tokenExempt には入れない＝デフォルトでトークン必須）、`src/messaging/validators.ts`、`src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts`（**`MAINTENANCE_BATCH_SUBTYPES` への追加が必須 — router はこの Set から dispatch を導出する**）
4. opfsWorker にアーカイブハンドラを実装（src/offscreen/opfsWorker/ に新ファイル。purgeHandlers.ts / backupHandlers.ts パターンに倣う）:
   - `archive_outgoing_<nonce>.db` を OPFS に直接作成し `createEngine` で開く（同一ワーカー内の第2エンジンは backupHandlers.ts:88 の restore 検証が先例。**createEngine はDDLフリー（sqliteEngine.ts:47-51）。SCHEMA_SQL適用は opfsWorker.ts:116-120 のメインエンジン初期化経路にあるため、そのヘルパーを流用しないこと**）
   - `SCHEMA_SQL` を適用（FTS5_STATEMENTS は適用しない）→ `yasumaro_archive_meta` テーブル作成 → meta 1行書き込み（include_deleted 含む）
   - 1トランザクションで `SELECT ... WHERE created_at <= ?`（+ include_deleted に応じ `AND is_deleted = 0`）`ORDER BY id` → アーカイブ側へ INSERT（`buildInsertParams` を流用。id 含む）
   - 検証（アーカイブ側件数 == SELECT件数、テーブル存在）→ close → `PRAGMA wal_checkpoint(TRUNCATE)`（backupHandlers.ts:53 の先例）
   - **検証が完全に成功した後にのみ** 本体で `DELETE FROM browsing_logs WHERE created_at <= ?`（+ include_deleted に応じ `AND is_deleted = 0`）+ `VACUUM` を実行し、応答は**ステージングファイル名のみ**（バイト列をメッセージに載せない）
5. ダッシュボードUIを追加（`entrypoints/options/index.html` + `src/dashboard/`）: 配置は保持ポリシー節の近くか Export Logs パネル。日付入力・削除済み行チェックボックス・プレビュー（対象件数・スター付き件数・削除済み件数・最古/最新日）・confirmToken取得（`create_confirm_token`）・**OPFSステージングファイルを読んで `downloadBlob`**・クリーンアップまでの再ダウンロード
6. i18n（`public/_locales/en/messages.json` / `public/_locales/ja/messages.json`）に data-i18n キーを追加
7. Green → リファクタリング（ハンドラの共通化・テスト整理）

### 落とし穴
- **DELETE だけではファイルサイズは減らない**: OPFS 上の SQLite は空き領域を freelist に残す。VACUUM 必須。sqlite-wasm の OPFS VFS で VACUUM が動くかを最初に検証し、動かない場合は `auto_vacuum` 方式へ切り替える設計にしておく
- **削除→ダウンロード失敗のデータロス**: ダウンロード（アンカークリック）は完了検知できない。アーカイブはOPFSステージングファイルに残るため、クリーンアップまでの間は再ダウンロード可能にする（メモリ内Blob保持に依存しない）
- **境界日のタイムゾーン**: `created_at` はUTCミリ秒。UIのローカル日付を「その日の24:00（UTC換算）」へ変換しないと1日ずれる（単体テストで固定）
- **大容量転送はメッセージに載せない**: アーカイブはOPFSステージング経由で引き渡す。base64応答（`backup_db` パターン）は chrome メッセージングの実用上限に触れる可能性があるため使わない（deep-dig 2026-09-06 の決定）
- **削除済み行のデフォルト除外**: 含めない場合、その分はアーカイブに存在しない。確認画面の注意文言（「含めなかった削除済み行はアーカイブから復元できない」）を省略しないこと
- **本体の FTS 索引**: 本体からの DELETE で `browsing_logs_ad` トリガーが発火する。FTS 索引との整合は既存トリガーに委ねる（アーカイブ.db 側にはトリガーを作らない）
- **WAL 未チェック**: ステージングファイルへ書き出す前に `wal_checkpoint(TRUNCATE)` を忘れると最新データがアーカイブに入らない
- **audit_log は対象外**: 本PBIでは `browsing_logs` のみ退避する

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック + テスト + lint）が通る
- [ ] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み: `docs/SETUP_GUIDE.md` の保持ポリシー節、`public/PRIVACY.md` と `docs/PRIVACY.md`（**両方同時に**同一内容へ更新）、`CHANGELOG.md`

---

## 設計ノート（レビュー依頼用 / 2026-09-06 作成、feature-dev スキルによるコードベース精査後）

> このセクションは実装前のレビューを受けるためのもの。実装はまだ着手していない。
> 3 PBI 共通の基盤設計は本 PBI-01 に集約し、PBI-02 / PBI-03 はここを参照する。

### A. 現状アーキテクチャの精査結果（実装前提の確認）

精査で判明した「PBI 記述と現コードのギャップ」および「実装を縛る制約」:

| # | 事実 | 出典（file:line） | 設計への影響 |
|---|------|------------------|-------------|
| A-1 | **dashboard（options ページ）は OPFS に一切アクセスしていない**。履歴 DB へのアクセスは 100% `chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE' })` 経由。OPFS が触れるのは offscreen ドキュメントと opfsWorker のみ | `src/dashboard/**` に `navigator.storage` の使用なし（`diagnoseDeficiencies.ts` は feature-detect のみ）。OPFS Worker は `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts:42` で offscreen 内に `new Worker()` される | PBI が要求する「dashboard がステージングファイルを直接読み書き」は**新規サーフェスの追加**。options ページも同一オリジンで `navigator.storage.getDirectory()` は使えるはずだが、前例ゼロ。実機検証項目に加える（下記 F-1） |
| A-2 | **base64 `.db` 転送の上限は 10MB**（`VALIDATOR_LIMITS.MAX_RESTORE_DB_BYTES = 10_000_000`、VULN-008）。`restore_db` はこの上限で弾かれる | `src/messaging/validators.ts:53,171-178` | ステージング方式（メッセージはファイル名のみ）が必須。deep-dig 2026-09-06 の決定と整合 |
| A-3 | **SW→offscreen メッセージのタイムアウトは 10 秒**（デスクトップ）、**offscreen→Worker は 15 秒** | `src/background/offscreenTransport.ts:18` (`MESSAGE_TIMEOUT_MS_DESKTOP = 10000`)、`src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts:98-101` (15s) | **10万件の同期アーカイブ（SELECT→INSERT→検証→DELETE→VACUUM）は 10 秒を超える可能性が高い**。これは PBI の「非機能要件」で触れられているが、初版の設計判断として明示が必要（下記 C-6） |
| A-4 | **新しい DASHBOARD_SQLITE subtype 1 個の追加に 7〜9 ファイルの同期更新が必要**。startup assert がパーティション整合を強制するため、1 つでも漏れると起動時例外 | `src/background/handlers/dashboardSqlite/index.ts:14-27`（`GROUPED_SUBTYPES` パーティション assert）、`src/background/handlers/dashboardSqliteProtocol.ts:75-80`（`_UnionCovered` コンパイル時 assert） | 実装手順 3 のファイルリストは正確。追加で `src/background/sqlite/offscreenGateway.ts` の `maintain()` case、`src/offscreen/OpfsWorkerBackend.ts`、`src/offscreen/dbMaintenance.ts`、`src/offscreen/sqliteMessageHandlers.ts` の登録、`src/offscreen/opfsWorker/types.ts` の `WORKER_MESSAGE_TYPES` も要る |
| A-5 | **確認トークンは送信側で完全自動**。`dashboardGateway.sendDashboard()` が `!tokenExempt.has(subtype)` を見て `create_confirm_token` を自動発行・添付。受信側 `dashboardSqlite/index.ts:39-60` が `verifyConfirmToken`（単回使用・60秒TTL・action/id 一致）で再検証 | `src/messaging/dashboardGateway.ts:37-52`、`src/background/confirmTokenManager.ts` | **`archive_create` を `TOKEN_EXEMPT_OPS` に入れないだけでトークン必須になる**。dashboard 側にトークンコードは 1 行も不要。BDD「確認トークンなしでは実行できない」は既存の `sqlite-security-integrity.test.ts` のマトリクスに subtype 名を 1 行追加すればカバーされる |
| A-6 | **`createEngine(dbPath, wasmUrl)` は完全に DDL フリー**（`useOpfsStorage` → `initSQLite` → `wrapDb` のみ）。SCHEMA_SQL / FTS5_STATEMENTS / migration はすべて呼び出し側（`opfsWorker.ts:115-143` の `initSqliteInner`）が適用 | `src/offscreen/sqliteEngine.ts:47-51` | archive.db 生成は `createEngine` で第2エンジンを開き、**`SCHEMA_SQL` のみ適用**（`FTS5_STATEMENTS` は適用しない、`AUDIT_LOG_SCHEMA_SQL` も適用しない）→ `yasumaro_archive_meta` 作成。`initSqliteInner` は流用しない |
| A-7 | **第2エンジンの前例は `handleRestore` の `tmpEngine` のみ**（`src/offscreen/opfsWorker/backupHandlers.ts:88-96`）。用途は「restore 前検証で数秒」。トリガー数 0 チェックが SQL インジェクション対策として既に実装済み | 同上 | archive 検証（`browsing_logs` + `yasumaro_archive_meta` 存在 + トリガー 0）はこのパターンをそのまま流用。共通ヘルパー `validateArchiveEngine()` に切り出し、PBI-02 / PBI-03 と共有 |
| A-8 | **`handleBackup` は `wal_checkpoint(TRUNCATE)` → `getFile()` 直読み**。`createSyncAccessHandle` は `OPFSCoopSyncVFS` がファイルを保持しているため INVALID_STATE になり使えない | `src/offscreen/opfsWorker/backupHandlers.ts:50-63` | ステージングファイルは**別パス**（`archive_outgoing_<nonce>.db`）なので `createSyncAccessHandle` は使える。ただし第2エンジンで開いている間は同じ制約 → 第2エンジンを close してから `getFile()` で dashboard に渡す or 開いたまま checkpoint |
| A-9 | **孤児ステージング掃除は未実装**。`handleRestore` は失敗時に `.restore-tmp` を 1 個 `removeEntry` するのみ。起動時スイープなし | `src/offscreen/opfsWorker/backupHandlers.ts:98`、`opfsWorker.ts` の init に掃除なし | 新規実装。`opfsWorker.ts` の `initSqliteInner` 末尾 or `offscreen.ts` の起動時に `archive_incoming_* / archive_outgoing_* / yasumaro_archive_tmp_*` をパターンマッチで `removeEntry`。3 PBI 共通 |
| A-10 | **`showOpenFilePicker` / File System Access API はコードベースに一切なし**。ファイル入力は全て `<input type="file">` + サイズ確認 → `file.text()` / `file.arrayBuffer()`（`encryptedBackupPanel.ts`） | `grep -rn "showOpenFilePicker" src/` → 0 件 | PBI-02 の書き戻し設計に影響（PBI-02 の設計ノート参照） |
| A-11 | **history 一覧のデータ取得層は既に injectable**。`sqliteHistoryQuery.ts` の `HistoryQuerySources`（`sources.queryLogs ?? queryLogs`）、`sqliteHistoryModel.ts` の `deps.queryHistory ?? queryHistory` | `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:206-208`、`sqliteHistoryModel.ts:319,369` | PBI-02 のアーカイブ表示は既存 UI コンポーネントの deps 差し替えで実現可能（新規一覧コンポーネント不要） |
| A-12 | **`buildInsertParams` / `INSERT_SQL` は `id` を含まない**（`id INTEGER PRIMARY KEY AUTOINCREMENT`）。`COLUMN_NAMES` は「SCHEMA_SQL の CREATE TABLE 順と一致」という契約付き単一ソース | `src/offscreen/schema.ts:69-108` | archive.db は「id 同一」が要件（本 PBI）だが復元時は「id 再採番」（PBI-03）。→ **schema.ts に archive 専用定数を追加**（下記 C-3） |
| A-13 | opfsWorker 内は**リクエストを 1 件ずつ直列化するキュー**（`requestQueue` / `processQueue`）で `SQLITE_LOCKED` を回避 | `src/offscreen/opfsWorker.ts:289-321` | archive 中は他の SQLite 操作がキューで待たされる。長時間アーカイブ中は履歴一覧の読み込みもブロックされる（UX 注意） |
| A-14 | `CLAUDE.local.md` の「`web_accessible_resources` 更新必須」ルールは **`src/utils/` / `src/content/` の動的インポート**が対象。offscreen / opfsWorker はエクステンションページコンテキストで WAR 不要 | `wxt.config.ts:87-103`（WAR は content script 用のみ） | `src/offscreen/opfsWorker/` を分割しても WAR 更新は**不要**（ただし念のためビルド後に `dist/chromium-mv3/manifest.json` を確認する） |

### B. 全体アーキテクチャ（採用案 = OPFS ステージング方式）

ユーザー判断: **OPFS ステージング方式で進める**（deep-dig 2026-09-06 が base64 チャンク転送を既に却下済み）。モジュールを薄く隔離する。

```
┌─ dashboard (options page) ─────────────────────────────────────┐
│  archivePanel.ts (新規, panel-archive, 静的HTMLスタイル)          │
│    ├─ 日付入力 <input type="date"> + 削除済みチェックボックス     │
│    ├─ プレビュー: archive_preview subtype で件数取得（読み取り）  │
│    ├─ 実行: archive_create subtype（トークン自動添付）           │
│    │    → 応答はステージングファイル名のみ                       │
│    └─ archiveStagingService.ts (新規, OPFS アクセス隔離)         │
│         navigator.storage.getDirectory()                        │
│         → archive_outgoing_<nonce>.db を getFile() → downloadBlob│
│         → クリーンアップ用の archive_cleanup subtype             │
└────────────────────────────────────────────────────────────────┘
                    │ chrome.runtime.sendMessage DASHBOARD_SQLITE
                    │ payload = { subtype, cutoffDate, includeDeleted, stagingName }
                    ▼
┌─ service worker ──────────────────────────────────────────────┐
│  dashboardSqlite/maintenanceBatchHandler.ts                    │
│    case 'archive_create': deps.archiveCreate(cutoffMs, incDel) │
│    case 'archive_preview': deps.archivePreview(cutoffMs)       │
│    case 'archive_cleanup': deps.archiveCleanup()               │
│  deps.ts → SqliteClient.maintain({ type: 'archiveCreate', ...})│
│  offscreenGateway.ts maintain() → SQLITE_ARCHIVE_CREATE msg    │
└───────────────────────────────────────────────────────────────┘
                    │ chrome.runtime.sendMessage (target: offscreen)  [10s timeout ← A-3]
                    ▼
┌─ offscreen document ──────────────────────────────────────────┐
│  sqliteMessageHandlers.ts: SQLITE_ARCHIVE_CREATE → dbMaintenance│
│  dbMaintenance.archiveCreate() → engine.getBackend()           │
│  OpfsWorkerBackend.archiveCreate() → tryOpfsProxy('ARCHIVE_CREATE')│
└───────────────────────────────────────────────────────────────┘
                    │ Worker.postMessage  [15s timeout ← A-3]
                    ▼
┌─ opfsWorker (Worker) ─────────────────────────────────────────┐
│  opfsWorker.ts router: case 'ARCHIVE_CREATE'                   │
│  → opfsWorker/archiveHandlers.ts (新規, backupHandlers.ts 準拠)  │
│  → opfsWorker/archiveValidation.ts (新規, validateArchiveEngine)│
│  → schema.ts の ARCHIVE_* 定数 (新規)                           │
└───────────────────────────────────────────────────────────────┘
```

**新規ファイル**:
- `src/offscreen/opfsWorker/archiveHandlers.ts` — `handleArchiveCreate` / `handleArchivePreview` / `handleArchiveCleanup`（PBI-02 で `handleArchiveOpen/Query/Update/Save/Close`、PBI-03 で `handleArchiveRestore` を追加）
- `src/offscreen/opfsWorker/archiveValidation.ts` — `validateArchiveEngine(engine): Promise<{ recordCount, meta }>` 共通検証（PBI-02 / 03 と共有）
- `src/dashboard/archiveStagingService.ts` — dashboard 側 OPFS アクセス隔離（テストでモック可能）
- `src/dashboard/panels/diagnostic/archivePanel.ts` — 新パネル
- `src/dashboard/fileSystemAccess.ts` — （PBI-02 用）FS Access API のモック可能ラッパー

**既存ファイル更新（subtype 追加の連鎖、PBI-01 分）**:
`src/messaging/sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に `archive_create` `archive_preview` `archive_cleanup` 追加。`archive_preview` のみ `READ_ONLY_OPS` + `TOKEN_EXEMPT_OPS`）/ `src/background/handlers/dashboardSqliteProtocol.ts` / `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts`（`MAINTENANCE_BATCH_SUBTYPES`）/ `src/background/handlers/dashboardSqlite/deps.ts` / `src/messaging/sqliteRpcClient.ts`（`MaintainOp`）/ `src/background/sqlite/offscreenGateway.ts`（`maintain()`）/ `src/messaging/sqliteMessages.ts`（`SqliteMessage` + `SQLITE_MESSAGE_TYPES`）/ `src/offscreen/opfsWorker/types.ts`（`WORKER_MESSAGE_TYPES`）/ `src/offscreen/OpfsWorkerBackend.ts` / `src/offscreen/dbMaintenance.ts` / `src/offscreen/sqliteMessageHandlers.ts` / `src/offscreen/schema.ts`（archive 定数）/ `entrypoints/options/index.html`（サイドバー nav + `<section id="panel-archive">`）/ `public/_locales/{en,ja}/messages.json`

### C. 主要な設計判断（なぜなぜ分析の結論）

#### C-1. プレビューは専用の読み取り subtype `archive_preview` を用意する

BDD シナリオ「実行前確認に対象件数・スター付き件数・削除済み件数・最古/最新日が表示」。既存の `query` / `get_count` は「`is_deleted = 0` の全体件数」しか返さない（`crudHandlers.ts:109`）。cutoff 以前・スター付き・削除済みの内訳を 1 往復で返すには専用 SQL が要る。

→ `archive_preview { cutoffDate }` を **読み取り専用**（`READ_ONLY_OPS` + `TOKEN_EXEMPT_OPS`）として追加。`SELECT COUNT(*) FILTER (WHERE ...)` 相当を 1 クエリで実行し `{ total, starred, deleted, oldestCreatedAt, newestCreatedAt }` を返す。整合テスト `exempt ⊆ read-only` を満たす。

#### C-2. cutoff の計算 — `new Date(y, m-1, d, 23,59,59,999).getTime()`

なぜなぜ分析:
- `created_at` は UTC ミリ秒。UI は `"2026-03-31"` 文字列。「指定日の終日まで」を含める（受け入れ基準）。
- `new Date("2026-03-31")` は ECMAScript 仕様で **UTC 00:00:00** 解釈 → 3/31 の記録がほぼ全部除外され 1 日ずれる。
- `new Date("2026-03-31T23:59:59.999")` は date-time なので**ローカルタイムゾーン**解釈だが、`Date.parse` の date-time ローカル解釈は歴史的にブラウザ差があった。
- **`new Date(year, monthIndex, day, 23, 59, 59, 999)`（数値引数コンストラクタ）はローカルタイムゾーン + ランタイムの DST 処理**が仕様上明確。存在しない時刻（DST 開始日の 02:00 台）はランタイムが繰り上げ。

→ `src/utils/archiveCutoff.ts` に切り出し:
```ts
/** ローカルタイムゾーンの指定日の末尾(23:59:59.999)を UTC ミリ秒で返す。 */
export function cutoffMsFromLocalDate(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`Invalid date: ${dateStr}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime();
}
```
アーカイブ SQL は `created_at <= ?`。

単体テスト: 月末 / 月境界（`2026-02-28`）/ うるう年（`2028-02-29`）/ DST 切り替え日（`TZ=America/New_York` で `2026-03-08`、`vitest` の `process.env.TZ` 設定）で例外を投げず単調 / `created_at === cutoff` は含む・`cutoff + 1` は含まない。

#### C-3. archive.db への INSERT — schema.ts に archive 専用定数を追加（`buildInsertParams` は流用しない）

なぜなぜ分析:
- 本 PBI は「id 列の値は本体と同一」。`buildInsertParams` / `INSERT_SQL` は `id` を含まない（A-12）。
- `buildInsertParams` に id 分岐を足すと本番 insert / insertBatch / migration に波及し `schema-insertParams.test.ts` 等が壊れる。`COLUMN_NAMES` は「単一ソース、CREATE TABLE 順と一致」契約付き。
- archive.db への書き込みは「本体スキーマのサブセット + id 保持」という独立用途。

→ `src/offscreen/schema.ts` に追加:
```ts
/** archive.db への INSERT — id を含む全列。本体 COLUMN_NAMES + 先頭 'id'。 */
export const ARCHIVE_INSERT_COLUMN_NAMES = ['id', ...COLUMN_NAMES] as const;
export const ARCHIVE_INSERT_SQL =
  `INSERT INTO browsing_logs (${ARCHIVE_INSERT_COLUMN_NAMES.join(', ')}) ` +
  `VALUES (${ARCHIVE_INSERT_COLUMN_NAMES.map(() => '?').join(', ')})`;
export function buildArchiveInsertParams(row: BrowsingLogRecord): SqliteValue[] {
  return [row.id, ...buildInsertParams(row, row.domain ?? null)];
}
/** archive 生成時の SELECT 列（id + 全列）。 */
export const ARCHIVE_SELECT_COLUMNS = ARCHIVE_INSERT_COLUMN_NAMES.join(', ');
```
`COLUMN_NAMES` を再利用するのでスキーマ変更に自動追従。単体テスト: `ARCHIVE_INSERT_COLUMN_NAMES` が `['id', ...COLUMN_NAMES]` と一致、params 配列長が 33。

#### C-4. `yasumaro_archive_meta` スキーマ

```sql
CREATE TABLE yasumaro_archive_meta (
  archived_at        INTEGER NOT NULL,   -- Date.now()
  cutoff_created_at  INTEGER NOT NULL,   -- cutoffMsFromLocalDate() の結果（UTC ms）
  cutoff_date        TEXT    NOT NULL,   -- UI 入力の "YYYY-MM-DD"（ローカル日付、人間可読）
  record_count       INTEGER NOT NULL,   -- 実際に INSERT した件数（検証に使う）
  include_deleted    INTEGER NOT NULL,   -- 0 / 1
  yasumaro_version   TEXT    NOT NULL    -- manifest.json の version
);
```
`src/offscreen/schema.ts` に `ARCHIVE_META_SCHEMA_SQL` 定数として追加。1 行だけ INSERT。

#### C-5. fail-safe な実行順序（本体を壊さない保証）

```
1. archive_outgoing_<nonce>.db を OPFS に作成、createEngine で開く（第2エンジン）
2. SCHEMA_SQL のみ適用（FTS5_STATEMENTS / AUDIT_LOG_SCHEMA_SQL は適用しない）
3. ARCHIVE_META_SCHEMA_SQL 適用、meta 1 行 INSERT
4. メインエンジンで wal_checkpoint(TRUNCATE)  ← 最新データを .db に反映（落とし穴「WAL 未チェック」）
5. 1 トランザクション内で:
   メインエンジン SELECT (ARCHIVE_SELECT_COLUMNS) WHERE created_at <= ? [AND is_deleted = 0] ORDER BY id
   → 第2エンジンへ ARCHIVE_INSERT_SQL でバッチ INSERT
6. 検証: validateArchiveEngine() で
   - archive 側 COUNT(*) === SELECT 件数
   - browsing_logs テーブル存在、yasumaro_archive_meta テーブル存在
   - トリガー数 === 0
7. 第2エンジン close → メインエンジンで wal_checkpoint(TRUNCATE)
8. 【検証が完全成功した後にのみ】メインエンジンで:
   DELETE FROM browsing_logs WHERE created_at <= ? [AND is_deleted = 0]   ← browsing_logs_ad トリガー発火、FTS 索引整合は既存トリガーに委任
   VACUUM                                                                  ← freelist 解放（F-2 で要検証）
9. 応答: { stagingName: 'archive_outgoing_<nonce>.db', recordCount, remainingCount }
   ※ バイト列はメッセージに載せない
```
どこで失敗しても手順 8 に到達しない限り本体は無傷。ステージングファイルは残る（後述の掃除まで再ダウンロード可能）。

#### C-6. 10万件・10秒タイムアウト問題（A-3）— 初版の判断

**問題**: 手順 5〜8 の同期実行が SW→offscreen の 10 秒（A-3）を超える可能性。

**初版の判断（レビューで異論を求む）**:
- 初版は**同期実行 + 「処理中…」表示のみ**。PBI 技術的考慮事項の「進捗表示または将来的な非同期化を検討」に沿い、非同期チャンク化は**別 PBI に切り出す**。
- ただし 10 秒対策として最低限:
  - `offscreenTransport` の `MESSAGE_TIMEOUT_MS_DESKTOP` は変更しない（他の全操作に影響するため）
  - 代わりに **`archive_create` は「開始応答」だけを 10 秒以内に返し、実処理は offscreen 側で継続、dashboard は `archive_status { nonce }` をポーリング**する非同期パターン。これは `opfs_spike` や migration が取る「長時間処理は状態をポーリング」の変形。
  - あるいは**件数上限を設けて分割アーカイブを促す**（例: 5万件を超えたら「日付を絞って複数回に分けてください」と案内）。
- どちらを採るかは**スパイク（F-3）で 5万件・10万件の実測**をしてから決める。初版 PBI としては「ポーリング方式を第一候補、実測で分割案内にフォールバック」とする。

#### C-7. archive ファイル名の採番

`yasumaro_archive_YYYY-MM-DD.db`（`YYYY-MM-DD` は cutoff の日付、`yasumaro_export_${date}.db` 慣習に沿う）。同日再実行時は dashboard 側で `_2`, `_3` 接尾辞。ステージングファイル名（`archive_outgoing_<nonce>.db`）とダウンロードファイル名は別物（nonce は衝突回避用、DL 名は人間可読）。

#### C-8. ステージングファイルの nonce と掃除（A-9）

- nonce: `crypto.randomUUID()`（`confirmTokenManager.ts` と同じ fail-closed。`Math.random` フォールバックなし）
- 掃除タイミング: (a) `opfsWorker.ts` `initSqliteInner` 末尾（起動時）、(b) 次回 `archive_create` 実行時の冒頭、(c) dashboard が `archive_cleanup` を明示呼び出し（ダウンロード完了を UI で確認したら）
- 掃除対象パターン: `archive_outgoing_*.db` / `archive_incoming_*.db`（PBI-02/03）/ `yasumaro_archive_tmp_*.db`
- **ダウンロード完了は検知不能**（アンカークリック）。ステージングファイルは (c) が呼ばれるまで、または (a)/(b) の次回起動まで残す → その間は再ダウンロード可能（PBI 落とし穴「削除→ダウンロード失敗のデータロス」対策）

### D. メッセージ経路の subtype 一覧（3 PBI 分、参考）

| subtype | PBI | READ_ONLY / EXEMPT | 用途 |
|---------|-----|-------------------|------|
| `archive_preview` | 01 | ✅ 両方 | 実行前件数プレビュー |
| `archive_create` | 01 | ❌（トークン必須） | アーカイブ生成 + 本体削除 |
| `archive_status` | 01 | ✅ 両方 | 非同期アーカイブの進捗ポーリング（C-6） |
| `archive_cleanup` | 01 | ❌（トークン必須。破壊的ではないが OPFS 状態を変える） | 孤児ステージング削除 |
| `archive_open` | 02 | ❌ | ステージングファイルを第2エンジンで開く |
| `archive_query` | 02 | ✅ 両方 | 開いているアーカイブへの読み取り（LIKE のみ） |
| `archive_update` | 02 | ❌ | アーカイブ内レコード編集 |
| `archive_save` | 02 | ❌ | 編集済みアーカイブを archive_outgoing へ書き出し |
| `archive_close` | 02 | ❌ | 第2エンジン close + 一時ファイル削除 |
| `archive_restore` | 03 | ❌ | アーカイブをメインDBへマージ復元 |

### E. テスト戦略の具体化

- **E2E**（`opfs-fts5-search.spec.ts` パターン、実 `chrome-extension://`）: archive_preview → archive_create → get_count で本体減少確認 → ステージングから再取得。トークンは `create_confirm_token` を先に呼び `chrome.storage.session` から読み出して payload に添付。
- **統合**（`sqliteTestApi.ts` パターン、実 SQLite）: archive_create ハンドラ単体で
  - 生成 archive.db の内容（件数・全列・meta・**FTS テーブルなし・トリガー 0**）
  - 境界値: `created_at == cutoff` 含む / `cutoff + 1` 除外
  - `include_deleted` 0/1 の両方
  - スター付きレコードも含まれる
  - 検証失敗時にステージングファイルが残らず、本体が無傷
  - fail-safe: archive 生成失敗 → 本体 DELETE されない
- **単体**:
  - `cutoffMsFromLocalDate`（C-2 のケース）
  - `ARCHIVE_INSERT_COLUMN_NAMES` / `buildArchiveInsertParams`（C-3）
  - ファイル名採番（C-7、同日再実行の接尾辞）
  - meta 生成（`record_count` と実行件数の一致、`include_deleted` 反映）
  - nonce 生成の衝突回避
- **セキュリティ**: `sqlite-security-integrity.test.ts` の subtype マトリクスに `archive_create` `archive_cleanup` を追加（content script から拒否）。`sqlite-security-integrity` / `dashboardGateway.test.ts` の `exempt ⊆ read-only` 整合。

### F. 実装前に実機で検証すべき項目（スパイク / 調査）

| # | 検証内容 | 不合格時の対応 |
|---|---------|---------------|
| F-1 | **options ページから `navigator.storage.getDirectory()` で OPFS ルートにアクセスし、offscreen/Worker が作ったファイルを読めるか**（同一オリジンだが前例ゼロ、A-1） | 不可なら: archive_create の応答を offscreen が `chrome.storage.local` に一時退避 → dashboard が読む、等の代替。または offscreen 経由の base64 チャンク（deep-dig の第2候補） |
| F-2 | **sqlite-wasm の OPFS VFS で `VACUUM` が動くか**（PBI 落とし穴に明記） | 動かないなら `PRAGMA auto_vacuum=FULL` を archive 生成時ではなく**本体 DB に対して**設定する設計に変更（本体スキーマ変更を伴うため要慎重評価）、または DELETE 後に本体を dump→再作成 |
| F-3 | **5万件・10万件の archive_create（SELECT→INSERT→検証→DELETE→VACUUM）の実測時間**（A-3、C-6） | 10 秒超なら C-6 のポーリング方式 or 件数上限 + 分割案内。実測値を PBI に追記 |
| F-4 | **第2エンジンを開いている間、メインエンジンの CRUD が正常応答するか**（PBI-02 のスパイクと共通。PBI-01 でも archive 生成中に発生） | 不合格なら archive 生成中は明示的に「処理中、他の操作はお待ちください」表示 + キュー直列化（A-13）に委ねる |

F-1〜F-4 のコードと結果は `dev-docs/plans/2026-09-06-archive-spike.md` に記録する。

### G. 未解決・レビューで意見が欲しい点

1. **C-6 の 10 秒タイムアウト対策** — ポーリング方式 vs 件数上限 + 分割案内 vs `offscreenTransport` に archive 専用の長いタイムアウトを追加。どれが妥当か。
2. **F-1** — options ページの OPFS 直アクセスが本当に動くか。動かない場合の代替経路（offscreen 経由 base64 チャンク）は deep-dig が却下したが、staging が使えないなら再考が必要。
3. **VACUUM 依存**（F-2） — 動かない場合の本体 `auto_vacuum` 設定はスキーマ変更を伴う。既存 DB へのマイグレーション影響をどう評価するか。
4. **`archive_cleanup` のトークン要否** — 破壊的ではない（孤児ファイル削除のみ）が OPFS 状態を変える。EXEMPT にすると整合テスト（`exempt ⊆ read-only`）が fail する。read-only 扱いにするのは実態と乖離。トークン必須で UX 上問題ないか（ダウンロード後の掃除ボタンで毎回トークン発行）。
5. **schema.ts への archive 定数追加**（C-3） — 本体スキーマファイルに「archive 専用」の定数を置くのは適切か。別ファイル `src/offscreen/archiveSchema.ts` に分離すべきか。

## 敵対的レビュー反映（2026-09-06・adversarial-code-review / 検証済み指摘に基づく規定。以下が本文と矛盾する場合は本節を優先）

1. **脅威モデルの明文化**: アーカイブ.db は攻撃者が作成・配布できる信頼できない入力である。検証・転送経路はこの前提で設計する（PBI-02/03と共通方針）。
2. **操作モデルの2フェーズ化（必須）**: 「1トランザクション内で退避と削除」の記述は削除する（2エンジン跨ぎのトランザクションは実現不能）。
   - フェーズA `archive_create`: 退避INSERT（新nonceのstagingへ・1トランザクション）→ 検証（テーブル構造・件数一致）→ **本体は未削除**。staging名のみ返却。新stagingを作り直す設計のため transport リトライに対して冪等（旧stagingは孤児掃除で回収）
   - フェーズB `archive_delete_by_staging`（新op・トークン必須）: 指定stagingのmeta（cutoff/include_deleted）を再読みして検証した上で本体DELETE+VACUUM。DELETEはcutoff述語で冪等（二重実行は2回目0件）→ transport リトライでも安全
3. **並行ガード（必須）**: offscreen worker の module-level single-flight フラグ（`ARCHIVE_ALREADY_OPEN` と同型・タブ横断有効）を archive_create / archive_delete / restore に適用。実行中はUI・offscreen両方で拒否。ステージング掃除（パターンマッチ一括削除）はガード内でのみ実行し、実行中セッションのstagingは対象外 — 2タブ競合で「タブAの未DL成果がタブBの掃除で消える」問題を根絶
4. **cutoff検証（必須）**: `validators.ts` に `archive_create` / `archive_delete_by_staging` / `archive_preview` の per-subtype 検証を必須追加（backup/restore系subtypeがper-subtype検証なしで素通しの現状に依存しない）。cutoffDate は `YYYY-MM-DD` 形式＋実在日＋範囲（2000-01-01〜実行日の翌日）で検証し、Date正規化に頼らない（"9999-99-99" での全件削除経路を封じる）
5. **ステージング寿命**: DL完了検知は不可能という前提を維持し、(a) 実行中セッションのstagingは常に保持 (b) 掃除は起動時・次回実行時・ユーザー明示操作のみ（single-flight下で競合なし）。`downloadBlob` の即時 `revokeObjectURL`（既存バグ）は本PBI内で遅延解放に修正
6. **archive_status の削除**: 初版スコープから除去（表Dから削除）。進捗・キャンセルは将来候補。代わりに「実行中は再実行不可」をUI文言で明示
7. **受入基準の検証可能化**: 「VACUUM（または同等の空き領域解放）が実行される」を「実行後に `PRAGMA freelist_count` が前回比で減少、またはOPFS上の本体dbファイルサイズが減少する」に置換（F-2で代替案に切替えた場合も同一条件で判定可能）
8. `archive_preview` の payload はフェーズAと共通の cutoff バリデータを通す（TOKEN_EXEMPT維持・get_count と同コストクラスのため認可水準は現状維持）
