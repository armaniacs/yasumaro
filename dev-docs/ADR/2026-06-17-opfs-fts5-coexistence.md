# ADR-014: OPFS 永続化と FTS5 全文検索の両立（@subframe7536/sqlite-wasm + trigram）

## Status

**Implemented** (2026-06-17)

## Context

ローカル SQLite を二次ストア（検索・閲覧用）として運用するにあたり、ブラウザ上の SQLite WASM で **OPFS 永続化** と **FTS5 全文検索** を同時に満たす必要があった。しかし従来採用していた `wa-sqlite`（npm 版）では両者が排他だった。

- OPFS 永続化は `createSyncAccessHandle` を使う **同期ビルド**（`wa-sqlite/dist/wa-sqlite.mjs`）でのみ実現できるが、この同期ビルドには **FTS5 が含まれない**。
- FTS5 を含むのは **非同期ビルド**（`wa-sqlite-async.mjs`）だが、こちらは OPFS の同期アクセスハンドルを使えず、IndexedDB VFS（`IDBBatchAtomicVFS`）止まりだった。

結果として、OPFS Worker パスでは検索が LIKE フォールバックに退化し、FTS5 のランク付き全文検索は IndexedDB パスでしか使えていなかった。

## Decision

**OPFS Worker パスの SQLite エンジンを [`@subframe7536/sqlite-wasm`](https://github.com/subframe7536/sqlite-wasm)（v1.1.1）へ置換し、`OPFSCoopSyncVFS` + FTS5 内蔵 WASM により OPFS 永続化と FTS5 を両立させる。**

加えて、**FTS5 のトークナイザに `trigram` を採用**し、日本語など空白で区切られない言語（CJK）の部分一致検索を有効化する。3 文字未満のクエリは `trigram` がマッチできないため、**LIKE 検索にフォールバック**する。

3 段フォールバック（OPFS Worker → IndexedDB(wa-sqlite async, FTS5 あり) → chrome.storage.local）は維持する。既存ユーザーの旧 OPFS DB（`AccessHandlePoolVFS`）は、新 DB へ全レコードを再投入する 1 回限り・冪等な移行を行う。

## 検証（実機・確定ゲート）

ライブラリの実現性は推測でなく実機 Chrome 拡張のスパイクで確定した。

- バンドル WASM は **SQLite 3.53.0**、`trigram`/`unicode61`/`porter`/`ascii` を内蔵。ICU・形態素解析は非搭載。
- Worker 内で `OPFSCoopSyncVFS` による OPFS 永続化と `FTS5 MATCH` の両立を確認（リロード後もデータ保持、`PRAGMA compile_options` に `ENABLE_FTS5`）。
- **`unicode61` は日本語検索が機能しない**（「機械学習」→ 0 件、実機確証）。空白区切りでない CJK を 1 トークンに丸めるため。
- **`trigram` は external content table（`content=`）でも動作**し、3 文字以上の日本語検索がヒット。2 文字「機械」は 0 件 → LIKE フォールバックでヒットすることを E2E で実証。

詳細仕様: [`docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md`](../../docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md)

## Consequences

### Positive

- OPFS 永続化と FTS5 ランク付き全文検索が同一 DB で両立。OPFS パスでも本物の FTS5 検索が使える。
- 日本語（CJK）部分一致検索が機能する（`trigram` + 短クエリ LIKE フォールバック）。
- 旧ライブラリ依存（`wa-sqlite`）は IndexedDB フォールバックと移行リーダ（`opfsMigrationV2Reader.ts`）に限定され、将来の除去が容易。

### Negative

- `trigram` インデックスは `unicode61` より大きくなる（全 3-gram をトークン化するため）。
- `trigram` MATCH は 3 文字未満で 0 件。短クエリは LIKE で全行スキャンになる（保存件数の上限が数百〜千件規模のため性能影響は実質なし）。
- 旧 `wa-sqlite` 依存が移行完了まで併存する（移行コードに限定）。

## Implementation

### アーキテクチャ

```
offscreen (src/offscreen/sqlite.ts) ── postMessage ──> opfsWorker.ts
   ├ proxy層: tryOpfsProxy(INSERT/QUERY/SEARCH/...)        └ @subframe7536/sqlite-wasm
   ├ fallback: IndexedDB (wa-sqlite async, FTS5あり)          OPFSCoopSyncVFS + FTS5内蔵wasm
   └ fallback: chrome.storage.local                          ※ Worker内 createSyncAccessHandle
```

### 主な変更ファイル

| ファイル | 役割 |
|---|---|
| `src/offscreen/sqliteEngine.ts` | 新ライブラリの薄いラッパ（exec/query/queryValue）。ベンダ依存を集約 |
| `src/offscreen/opfsWorker.ts` | 新エンジンへ置換、FTS5（trigram）スキーマ + トリガー、SEARCH ハンドラ、3 文字未満 LIKE フォールバック |
| `src/offscreen/opfsMigrationV2.ts` / `opfsMigrationV2Reader.ts` | 旧 DB → 新 DB の冪等移行（旧 wa-sqlite 依存をリーダに限定） |
| `src/offscreen/sqlite.ts` | search() を本物の FTS5 SEARCH へ、OPFS パスで fts5Available=true |
| `src/utils/storage/types.ts` / `defaults.ts` | `OPFS_MIGRATION_V2_DONE` キー追加 |

### トークナイザ選定（検討した代替案）

| 案 | 日本語3文字+ | 日本語1〜2文字 | コスト | 現バンドルで可 |
|---|---|---|---|---|
| unicode61 | ❌ | ❌ | 低 | ✅ |
| **trigram + 短クエリ LIKE（採用）** | ✅ | ✅(LIKE) | 中 | ✅ |
| ICU / 形態素解析 | ✅(語分割) | ✅ | 高 | ❌(別 wasm/自前ビルド) |

ICU・形態素解析は現バンドル WASM に非搭載で、採用にはライブラリ変更・スパイクのやり直しが必要なため見送った。

## Related

- [ADR-013: WXT への移行](./2026-04-19-wxt-migration.md)（manifest / web_accessible_resources は `wxt.config.ts` が生成）
- 設計書: `docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md`
- 実装計画: `docs/superpowers/plans/2026-06-16-opfs-fts5-coexistence.md`
