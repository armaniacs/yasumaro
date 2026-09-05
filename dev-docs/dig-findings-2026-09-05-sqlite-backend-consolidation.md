# SQLite バックエンド構成 整理 SPIKE 報告

- 日付: 2026-09-05
- 対象 PBI: `pbi/2026-09-05-29-backlog-sqlite-backend-consolidation.md`
- ベースライン: `npm test -- src/offscreen src/background/inMemoryTransport` → 58 files / 854 tests green
- 方針: コード変更なし。現状スナップショットのみを記す

## 現状マップ

### 選択優先順位

`src/offscreen/backendResolver.ts:35` `resolveBackend()` が唯一の優先順位定義。pure 関数。

| 優先度 | BackendType | 条件 | Adapter (`createBackend`) |
|---|---|---|---|
| 1 | `opfs` | `opfsWorker != null` | `OpfsWorkerBackend` (Worker へ委譲) |
| 2 | `idb` | `idbEngine != null` | `IdbVfsBackend` (engine 直 exec) |
| 3 | `fallback` | `usingFallbackStorage && fallbackStorage != null` | `FallbackStorageAdapter` |
| 4 | `none` | 上記いずれも不成立 | `NoopBackend` (全操作 `Database not initialized`) |

初期化順序は `src/offscreen/sqliteEngineHost.ts:235` `_doInit()` が規定: OPFS Worker → `runMigrationBackup` → `initIdbEngine` → `runMigrationRestore` → `tryMigrateFallbackToSqlite` → 失敗時は Fallback へ転落。`ensureBackend()` / `getBackend()` はいずれも `resolveBackend()` に委譲し、優先順位の二重定義はない。

### ファイル × 責務 × 消費者

| ファイル | 責務 | 消費者 |
|---|---|---|
| `src/offscreen/backendResolver.ts` | 優先順位判定 (`resolveBackend`) と Adapter 生成 (`createBackend`, dynamic import) | `sqliteEngineHost.ts` (`ensureBackend`, `getBackend`) |
| `src/offscreen/StorageBackend.ts` | `StorageBackend` インタフェース (`Queryable` + `Mutable`) と `NoopBackend` | 全 Backend 実装、repos |
| `src/offscreen/OpfsWorkerBackend.ts` | OPFS Worker への RPC 委譲 (`sendToOpfsWorker` / `tryOpfsProxy`)。SQL を持たない薄いプロキシ | `createBackend('opfs')` 経由で repos が間接利用 |
| `src/offscreen/opfsWorker.ts` + `src/offscreen/opfsWorker/` (`handlers`, `crudHandlers`, `searchHandlers`, `auditHandlers`, `backupHandlers`, `purgeHandlers`, `statusHandlers`, `migrationV2`, `types`) | Worker 内の実 SQL 実装。`@subframe7536/sqlite-wasm` + OPFSCoopSyncVFS + FTS5。唯一バイナリ backup/restore 対応 | `OpfsWorkerBackend`, `sqliteEngineContext/opfsWorkerProxy.ts` |
| `src/offscreen/IdbVfsBackend.ts` | IDB VFS 上の直 SQL 実装 (`engine.execWithCache`)。FTS5 対応。backup/restore は `Binary backup requires OPFS storage.` で拒否 | `createBackend('idb')` 経由で repos が間接利用 |
| `src/offscreen/sqliteEngine.ts` | `SqliteEngine` ラッパ (`exec` / `query` / `queryValue` / `close`) と `createEngine` (OPFS) / `createIdbEngine` (IDB)。`@subframe7536/sqlite-wasm` の `useOpfsStorage` / `useIdbStorage` を使用 | `idbEngineLifecycle.ts`, OPFS Worker |
| `src/offscreen/storageFallback.ts` | `FallbackStorage`: `chrome.storage.local` ベース。線形探索 (FTS なし)、Mutex 直列化、5MB クォータ退避 | `FallbackStorageAdapter`, `fallbackMigration.ts` |
| `src/offscreen/FallbackStorageAdapter.ts` | `FallbackStorage` の `StorageBackend` 適合アダプタ。`insertBatch` の `{count}` → `{inserted, skipped}` 変換、audit log / backup の unsupported スタブ | `createBackend('fallback')` |
| `src/offscreen/sqliteEngineHost.ts` (+ 別名 `src/offscreen/sqliteEngineContext.ts`) | `SqliteEngineHost`: `#state` 集約、Mutex 直列化 init、`getBackend()` キャッシュ (`_backend`) | `recordsRepo.ts`, `dbMaintenance.ts`, `auditLogRepo.ts`, `sqliteMessageHandlers.ts` |
| `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts` | Worker 生成・送受信・15s タイムアウト・`initOpfsWorker` | `sqliteEngineHost._doInit` |
| `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts` | IDB engine 初期化 (WAL, schema, `runMigrations`, compile options 取得)、`execWithCache` | `sqliteEngineHost._doInit`, `IdbVfsBackend` |
| `src/offscreen/sqliteEngineContext/fallbackMigration.ts` | Fallback → IDB 一方向移行 (`INSERT OR IGNORE`、成功時 clear + `OPFS_FALLBACK_MODE` 除去) | `sqliteEngineHost._doInit` |
| `src/offscreen/sqliteEngineContext/migrationBackup.ts` + `runMigrationRestore` | 旧 wa-sqlite `idb-batch-atomic` → 新 IDB `yasumaro.db` 移行の backup/restore。サンセット保留 (2026-12-17 再評価、ADR-014) | `sqliteEngineHost._doInit` |
| `src/offscreen/opfsMigrationV2.ts` + `opfsMigrationV2Reader.ts` + `opfsWorker/migrationV2.ts` | 旧 wa-sqlite AccessHandlePoolVFS → 新 OPFSCoopSyncVFS 移行。Reader は Worker 専用・単体テストなし。状態は `OPFS_MIGRATION_V2_*` キーで `sqliteMessageHandlers.ts:228` が STATUS に公開 | OPFS Worker INIT 経路 |
| `src/offscreen/opfsCapabilities.ts` | OPFS 能力検出と `VfsStrategy` 選択 (`opfs-sync-worker` / `opfs-async-main` / `fallback`)。resolver に `detectLiveVfsStrategy` を配線 | `backendResolver.detectOpfsCapabilitiesForResolver`, 診断パネル |
| `src/offscreen/queryPlan.ts` | 全 Backend 共通のクエリ仕様 (`buildQuerySpec`, `QUERY_CAPS`, `matchesExtraWhere`) | `IdbVfsBackend`, `storageFallback`, `InMemoryTransport` |
| `src/offscreen/recordsRepo.ts`, `dbMaintenance.ts`, `auditLogRepo.ts` | `engine.getBackend()` 委譲の薄いファサード | `sqliteMessageHandlers.ts` → offscreen メッセージ → `src/background/sqlite/offscreenGateway.ts` (`OffscreenGateway` / 別名 `SqliteGateway`, `SqliteClient`) |
| `src/background/inMemoryTransport.ts` | テスト専用 `OffscreenTransport` (インメモリ実装)。gateway 経由テストの seam | `src/background/__tests__/inMemoryTransport.test.ts` のみ。製品コードからの参照なし |
| `src/messaging/dashboardGateway.ts` (`DashboardGateway`) | dashboard → service worker ホップ。SQLite 層とは別レイヤー | `dashboardSqliteService.ts`。本 PBI の gateway 分割対象外 |

### 選択条件と移行経路

| 層 | 選択条件 | 移行経路 (入り / 出) |
|---|---|---|
| opfs | `navigator.storage.getDirectory` 存在かつ Worker 生成かつ Worker INIT 成功 | 入り: 新規は直接。旧 AccessHandlePoolVFS から `opfsMigrationV2` で移行。出: なし (最優先で滞留) |
| idb | OPFS 不成立かつ `createIdbEngine` 成功 | 入り: 旧 wa-sqlite IDB から `migrationBackup`/`migrationRestore` で移行。Fallback 蓄積分は `tryMigrateFallbackToSqlite` で吸収。出: なし |
| fallback | OPFS・IDB とも失敗 (`_doInit` catch)。`OPFS_FALLBACK_MODE` フラグ設定 | 入り: 転落時のみ。出: IDB 復活時に `tryMigrateFallbackToSqlite` で West→East 移行 (IDB 初期化成功時のみ発火。OPFS 復活時は IDB 経由せず直接 opfs 選択となるため fallback 残留があり得る) |
| none | fallback 初期化前の一時状態。`getBackend()` 前に `init()` が走るため製品到達は稀 | 移行なし。`NoopBackend` はエラーを返すのみ |

### 機能差分

| 機能 | opfs | idb | fallback | none |
|---|---|---|---|---|
| FTS5 検索 | あり | あり (`fts5Available`) | なし (LIKE 線形探索、`rank` 常時 0) | — |
| バイナリ backup/restore | あり | なし (明示拒否) | なし (明示拒否) | — |
| audit log | あり | あり | なし (明示拒否) | — |
| 永続先 | OPFS (`yasumaro.db`) | IndexedDB (`yasumaro.db`) | `chrome.storage.local` (5MB 警告閾値・10% 自動 purge) | — |

## 重複と整理候補

1. **SQL 実装の二重化 (最大の重複)**: `IdbVfsBackend.ts` (434 行、直 exec) と `opfsWorker/*` (CRUD + search + audit + purge + backup のハンドラ群) が同一操作を別実装。検索ソート・purge 条件の drift リスクあり。テストも対応ごとに分離 (`IdbVfsBackend-search-sort` / `opfsWorker-search-sort` / `storageFallback-search-sort`)。
2. **Fallback 二層の薄さ**: `FallbackStorage` (492 行の実体) に対し `FallbackStorageAdapter` (90 行) は形状変換と unsupported スタブのみ。統合余地はあるが、実体と適合層の分離自体は健全であり削除効果は小さい。
3. **レガシー移行系の並存**: `migrationBackup.ts` (wa-sqlite IDB) と `opfsMigrationV2.ts` + `opfsMigrationV2Reader.ts` (wa-sqlite OPFS) が別ゲートで存続。いずれも `wa-sqlite@~1.0.0` の唯一の現役参照であり、サンセットで依存ごと削除可能 (PBI 03/04 の計画済み範囲)。
4. **`VfsStrategy` と `BackendType` の不整合**: `opfsCapabilities` の `opfs-async-main` (メインスレッド async OPFS) に対応する Backend が `backendResolver` に存在しない。現行 resolver は Worker OPFS 失敗時に直接 IDB へ転落するため、`opfs-async-main` は実質デッドパス。診断表示と実選択の乖離候補。
5. **`sqliteEngineHost` / `sqliteEngineContext` の別名二重化**: 後者は前者の再輸出のみ (15 行)。輸入元の移行が終われば削除可能。
6. **`opfsSpike.ts` の残留**: PBI-10 の実現可能性ハーネス。`runOpfsSpikeA` は `SQLITE_OPFS_SPIKE` 経由で製品メッセージ経路に残存し、`InMemoryTransport` は明示拒否。診断用途として残すか削除するかの決定がない。
7. **テスト専用第三実装**: `InMemoryTransport` は `matchesExtraWhere` を共有するもののフィルタ・ソート・`text` トークン化を独自実装。さらに `SQLITE_DELETE` をソフトデリート (`is_deleted = 1`) で処理するのに対し、製品の `FallbackStorageAdapter.delete` はハードデリート (`hardDelete`) であり、セマンティクス乖離がある。テスト専用のため製品整理対象外だが、検証基盤としての drift に注意。

### ロックイン評価

- `@subframe7536/sqlite-wasm@~1.3.1` (MIT): ホットパス (`sqliteEngine.ts`、`opfsWorker`、`idbEngineLifecycle.ts`) が依存。`SqliteEngine` インタフェース (`exec`/`query`/`queryValue`/`close`) でラップされており、差し替え点は集約されている。
- `wa-sqlite@~1.0.0`: 現役参照は `migrationBackup.ts` の動的 import と `opfsMigrationV2Reader.ts` のみ。サンセット後は `package.json` から削除可能。詳細は PBI 31 参照。

## 整理案

### Option A: レガシー・サンセットのみ (推奨)

- 内容: サンセットゲート (2026-12-17、ADR-014) 到達後に `migrationBackup.ts`、`opfsMigrationV2.ts`、`opfsMigrationV2Reader.ts`、`wa-sqlite` 依存、`opfsWorker/migrationV2.ts` の旧経路を削除。ランタイム 3 層 (opfs / idb / fallback) + none は維持。
- 工数: S (2〜3 日。削除 + テスト更新。ゲート条件の確認を含む)
- リスク: 低。現役データパスに触れない。唯一の前提はゲート条件 (診断パネルで未完了報告ゼロ) の成立。
- 効果: `wa-sqlite` 依存削除 (~2.7MB 削減は PBI 04 見込み)、移行系ファイルの消滅、IDB 初期化経路の単純化。

### Option B: IDB 中間層の廃止 (OPFS + fallback の 2 層化)

- 内容: `IdbVfsBackend`、`idbEngineLifecycle`、`createIdbEngine` を削除。OPFS 不可環境は直接 fallback へ転落。
- 工数: M (1〜2 週間。`fallbackMigration` の移行先変更、FTS 依存 UI の縮退対応、テスト大量更新)
- リスク: 高。OPFS 非対応かつ Worker 不可の環境で FTS5・audit log・backup を喪失し、検索品質が LIKE に縮退する。現行 fallback と IDB のセマンティクス差 (audit 未対応、ソート差異) を全利用者に転嫁する。後戻りが困難。
- 効果: SQL 実装が 1 系統 (Worker) + fallback のみとなり重複は最大解消。維持コストは最小。

### Option C: クエリ実装の共通化 (層を残し drift を止める)

- 内容: 層構成は維持し、`IdbVfsBackend` と `opfsWorker/*Handlers` の SQL 組み立てを共通ビルダーに寄せる (`queryPlan.ts` の拡張、CRUD の `schema.js` 共有は既存)。`VfsStrategy` / `BackendType` の不整合 (`opfs-async-main` デッドパス) の解消と `sqliteEngineContext` 別名の削除を同梱。
- 工数: M (1 週間前後。共通化 + 3 系統の search-sort テスト統合)
- リスク: 中。共通化中の振る舞い差 (FTS evoke 条件、LIKE フォールバック境界) の取り違えが検索結果を変える可能性。段階移行可能。
- 効果: 製品振る舞いを変えずに最大の重複 (項目 1) を縮小。B の前提条件としても有効。

## 推奨と次の一手

- 推奨: **Option A**。PBI 03/04 の計画済みサンセットと整合し、リスクなく依存と移行系を消せる。B は検索品質の縮退を伴うため、fallback-only ユーザー規模の測定なしに決定すべきでない。C は A 完了後の独立 PBI として有効。
- 実装 PBI への切り出し案 (いずれも未起票):
  1. `PBI-A: wa-sqlite レガシー・サンセット実行` — 対象: `src/offscreen/sqliteEngineContext/migrationBackup.ts`、`src/offscreen/opfsMigrationV2.ts`、`src/offscreen/opfsMigrationV2Reader.ts`、`src/offscreen/opfsWorker/migrationV2.ts`、`package.json` (`wa-sqlite`)、`sqliteMessageHandlers.ts` の `OPFS_MIGRATION_V2_*` 公開部。S。
  2. `PBI-C1: VfsStrategy/BackendType 不整合の解消 + sqliteEngineContext 別名削除` — 対象: `src/offscreen/opfsCapabilities.ts`、`src/offscreen/backendResolver.ts`、`src/offscreen/sqliteEngineContext.ts` と輸入元。S。
  3. `PBI-C2: IdbVfsBackend/opfsWorker ハンドラのクエリ共通化` — 対象: `src/offscreen/IdbVfsBackend.ts`、`src/offscreen/opfsWorker/searchHandlers.ts` + `crudHandlers.ts`、`src/offscreen/queryPlan.ts`、3 系統の search-sort テスト。M。
  4. `PBI-B (判断保留): IDB 層廃止の可否判断` — 前提: fallback-only 到達率の測定 (診断 STATUS の `compileOptionsSource` 集計はプライバシー制約下で要設計)。測定後に go/no-go。
