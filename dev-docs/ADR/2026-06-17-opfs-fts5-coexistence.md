# ADR-014: OPFS 永続化と FTS5 全文検索の両立（@subframe7536/sqlite-wasm + trigram）

## Status

**Implemented** (2026-06-17)

## Context

ローカル SQLite を二次ストア（検索・閲覧用）として運用するにあたり、ブラウザ上の SQLite WASM で **OPFS 永続化** と **FTS5 全文検索** を同時に満たす必要があった。しかし従来採用していた `wa-sqlite`（npm 版）では両者が排他だった。

- OPFS 永続化は `createSyncAccessHandle` を使う **同期ビルド**（`wa-sqlite/dist/wa-sqlite.mjs`）でのみ実現できるが、この同期ビルドには **FTS5 が含まれない**。
- FTS5 を含むのは **非同期ビルド**（`wa-sqlite-async.mjs`）だが、こちらは OPFS の同期アクセスハンドルを使えず、IndexedDB VFS（`IDBBatchAtomicVFS`）止まりだった。

結果として、OPFS Worker パスでは検索が LIKE フォールバックに退化し、FTS5 のランク付き全文検索は IndexedDB パスでしか使えていなかった。

## Decision

**OPFS Worker パスの SQLite エンジンを [`@subframe7536/sqlite-wasm`](https://github.com/subframe7536/sqlite-wasm)（導入時v1.1.1、現在v1.3.1）へ置換し、`OPFSCoopSyncVFS` + FTS5 内蔵 WASM により OPFS 永続化と FTS5 を両立させる。**

加えて、**FTS5 のトークナイザに `trigram` を採用**し、日本語など空白で区切られない言語（CJK）の部分一致検索を有効化する。3 文字未満のクエリは `trigram` がマッチできないため、**LIKE 検索にフォールバック**する。

3 段フォールバック（OPFS Worker → IndexedDB(`@subframe7536/sqlite-wasm` IDB VFS、FTS5 あり) → chrome.storage.local）は維持する。既存ユーザーの旧 OPFS DB（`AccessHandlePoolVFS`）は、新 DB へ全レコードを再投入する 1 回限り・冪等な移行を行う。

**追記（PBI: 2026-07-16-06）**: IndexedDB フォールバックパスも `wa-sqlite`（`IDBBatchAtomicVFS`）から `@subframe7536/sqlite-wasm` の IDB VFS（`useIdbStorage`）へ移行済み。既存ユーザーの旧 IndexedDB データベース（`idb-batch-atomic`）は検出時に自動でバックアップ（`chrome.storage.local`）を取ってから、`useIdbStorage` 組み込みの `onupgradeneeded` マイグレーション（IndexedDB スキーマ version 5→6、`blocks` ストアはそのまま、`metadata` ストアを新設）でレコードを引き継ぐ。移行後にレコード件数を検証し、不一致時はバックアップから `INSERT OR IGNORE` で復元する。詳細は [`src/offscreen/sqliteEngineContext.ts`](../../src/offscreen/sqliteEngineContext.ts) の `migrateIdbIfNeeded()` / `restoreFromMigrationBackupIfPresent()` を参照。

## 検証（実機・確定ゲート）

ライブラリの実現性は推測でなく実機 Chrome 拡張のスパイクで確定した。

- バンドル WASM は **SQLite 3.53.0**、`trigram`/`unicode61`/`porter`/`ascii` を内蔵。ICU・形態素解析は非搭載。
- Worker 内で `OPFSCoopSyncVFS` による OPFS 永続化と `FTS5 MATCH` の両立を確認（リロード後もデータ保持、`PRAGMA compile_options` に `ENABLE_FTS5`）。
- **`unicode61` は日本語検索が機能しない**（「機械学習」→ 0 件、実機確証）。空白区切りでない CJK を 1 トークンに丸めるため。
- **`trigram` は external content table（`content=`）でも動作**し、3 文字以上の日本語検索がヒット。2 文字「機械」は 0 件 → LIKE フォールバックでヒットすることを E2E で実証。

詳細仕様: `dev-docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md`（当時作成、現存しない）

## Consequences

### Positive

- OPFS 永続化と FTS5 ランク付き全文検索が同一 DB で両立。OPFS パスでも本物の FTS5 検索が使える。
- 日本語（CJK）部分一致検索が機能する（`trigram` + 短クエリ LIKE フォールバック）。
- 旧ライブラリ依存（`wa-sqlite`）は IndexedDB フォールバックの通常経路からは除去済み（PBI: 2026-07-16-06）。残るのは旧 IDB データベースの一回限りバックアップ処理（`sqliteEngineContext.ts` の動的 import、旧データ検出時のみロード）と移行リーダ（`opfsMigrationV2Reader.ts`、OPFS 側の別移行）に限定され、将来の除去が容易。

### Negative

- `trigram` インデックスは `unicode61` より大きくなる（全 3-gram をトークン化するため）。
- `trigram` MATCH は 3 文字未満で 0 件。短クエリは LIKE で全行スキャンになる（保存件数の上限が数百〜千件規模のため性能影響は実質なし）。
- 旧 `wa-sqlite` 依存は IDB フォールバックの通常経路からは除去済みだが、一回限りのバックアップ処理と OPFS 側の移行リーダに限定して併存する。**除去可否判断（2026-07-17）**: 経過期間 1 ヶ月では未移行ユーザーのリスクを否定できず、かつ集計テレメトリが存在しないため「計測基盤を先に作る」と判断。ダッシュボード診断パネルへの移行状態表示を実装し、6 ヶ月経過後（2026-12-17 以降）に除去を再判断する。詳細: [[2026-07-16-07-decide-opfs-migration-v2-removal]]。

## Implementation

### アーキテクチャ

```
SW (sqliteClient.ts) ── sendMessage(SQLITE_*) ──> offscreen (sqliteEngineContext.ts) ── postMessage ──> opfsWorker.ts
                                                     ├ proxy層: tryOpfsProxy(INSERT/QUERY/SEARCH/...)            └ sqliteEngine.ts (@subframe7536/sqlite-wasm)
                                                     ├ fallback: IndexedDB (wa-sqlite async, FTS5あり)               OPFSCoopSyncVFS + FTS5内蔵wasm
                                                     └ fallback: chrome.storage.local                              ※ Worker内 createSyncAccessHandle
```

この経路は独立した型定義を持つ2つの通信チャネルから成る。

| チャネル | プロトコル | 型定義 | 備考 |
|---|---|---|---|
| SW ↔ offscreen | `chrome.runtime.sendMessage`（`target: 'offscreen'`） | `src/messaging/sqliteMessages.ts`（`SqliteMessage` discriminated union） | `sqliteClient.ts`（送信）と `offscreen.ts`（受信、`handleSqliteMessage` の `switch`）が共通の型ソースを import。存在しない type はコンパイルエラーになる |
| offscreen ↔ Worker | `Worker.postMessage` | `opfsWorker.ts` 内のローカルな type 名（`SQLITE_` プレフィックスなし、例: `INIT`/`INSERT`） | offscreen.ts に閉じた実装詳細で SW 側は関知しない。意図的に `SqliteMessage` の対象外（PBI: 2026-07-16-05） |

未知の SQLite メッセージ type（`SQLITE_` プレフィックスの有無に関わらず `SqliteMessage` に含まれない type）を受信した場合、`offscreen.ts` は `isSqliteMessageType()` の判定結果に応じて既存の「Unknown message type」応答にフォールスルーし、クラッシュしない。

### 主な変更ファイル

`src/offscreen/sqlite.ts` は後方互換のための再エクスポート層に退化しており、実体は以下の4モジュールに分割されている（詳細は `sqlite.ts` 冒頭のリファクタリング履歴コメントを参照）。

| ファイル | 役割 |
|---|---|
| `src/offscreen/sqliteEngineContext.ts` | 共有エンジン状態と低レベル配管（OPFS Worker プロキシ、IDB/wa-sqlite 初期化、prepared-statement キャッシュ、フォールバックストレージ）。`recordsRepo.ts`/`dbMaintenance.ts`/`auditLogRepo.ts` が共通で参照する基盤 |
| `src/offscreen/recordsRepo.ts` | `browsing_logs` レコードの CRUD・FTS5 検索・JSON export |
| `src/offscreen/dbMaintenance.ts` | 保持期間パージ・FTS 索引監視・バイナリ backup/restore・healthCheck |
| `src/offscreen/auditLogRepo.ts` | `audit_log`（AI プロバイダ送信イベント記録）テーブル操作 |
| `src/offscreen/sqliteEngine.ts` | `@subframe7536/sqlite-wasm` の薄いラッパ（`createEngine`/`exec`/`query`/`queryValue`）。`opfsWorker.ts`（Worker側・OPFS パス専用）が使用し、`sqliteEngineContext.ts`（offscreen document側・IDB/フォールバック管理）とは別レイヤー |
| `src/offscreen/opfsWorker.ts` | `sqliteEngine.ts` 経由で新エンジンを利用、FTS5（trigram）スキーマ + トリガー、SEARCH ハンドラ、3 文字未満 LIKE フォールバック |
| `src/offscreen/opfsMigrationV2.ts` / `opfsMigrationV2Reader.ts` | 旧 DB → 新 DB の冪等移行（旧 wa-sqlite 依存をリーダに限定） |
| `src/messaging/sqliteMessages.ts` | SW↔offscreen 間 `SQLITE_*` メッセージ型の単一ソース（`SqliteMessage` discriminated union）。`sqliteClient.ts`/`offscreen.ts` が共有 |
| `src/utils/storage/types.ts` / `defaults.ts` | `OPFS_MIGRATION_V2_DONE` キー追加 |

### トークナイザ選定（検討した代替案）

| 案 | 日本語3文字+ | 日本語1〜2文字 | コスト | 現バンドルで可 |
|---|---|---|---|---|
| unicode61 | ❌ | ❌ | 低 | ✅ |
| **trigram + 短クエリ LIKE（採用）** | ✅ | ✅(LIKE) | 中 | ✅ |
| ICU / 形態素解析 | ✅(語分割) | ✅ | 高 | ❌(別 wasm/自前ビルド) |

ICU・形態素解析は現バンドル WASM に非搭載で、採用にはライブラリ変更・スパイクのやり直しが必要なため見送った。

## Implements

- `src/offscreen/sqlite.ts`
- `src/offscreen/sqliteEngineContext.ts`
- `src/offscreen/recordsRepo.ts`
- `src/offscreen/dbMaintenance.ts`
- `src/offscreen/auditLogRepo.ts`
- `src/offscreen/sqliteEngine.ts`
- `src/offscreen/opfsWorker.ts`
- `src/offscreen/opfsMigrationV2.ts`
- `src/offscreen/opfsMigrationV2Reader.ts`
- `src/messaging/sqliteMessages.ts`
- `src/utils/storage/types.ts`
- `src/utils/storage/defaults.ts`

## Related

- [ADR-013: WXT への移行](./2026-04-19-wxt-migration.md)（manifest / web_accessible_resources は `wxt.config.ts` が生成）
- 設計書・実装計画（`dev-docs/superpowers/specs/`, `dev-docs/superpowers/plans/`配下）は当時作成されたが現存しない
