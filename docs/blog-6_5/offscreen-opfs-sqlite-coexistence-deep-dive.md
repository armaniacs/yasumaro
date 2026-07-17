# Yasumaro のローカル SQLite はどう「共存」しているか — Offscreen・OPFS Worker・3層フォールバックの実装を追った

[日本語](#日本語) | [English](#english)

---

## 日本語

### はじめに

Yasumaro は閲覧履歴をローカルに保存する二次ストアとして SQLite を使っています。ブラウザ上で SQLite を動かすのは一筋縄ではいきません。同期アクセスが必要な OPFS 永続化と、全文検索（FTS5）は、従来のライブラリでは**排他**だったからです。

この記事では、知識グラフ解析と実コードの読み込みを通じて、「Yasumaro の SQLite はいかにして永続化と全文検索を両立し、かつ環境ごとの制約を吸収しているか」を追いました。結論から言うと、**「3 段フォールバック × 2 つの非同期チャネル」という二重の多重化**になっています。

---

### 発見 1: SQLite は Service Worker から離れた場所で動く

ブラウザ拡張機能では、SQLite（WASM）のような重い同期処理は Service Worker ではなく **Offscreen Document** で動かします。Yasumaro の構成はこうです。

```
Service Worker (sqliteClient.ts, c7)
   │  chrome.runtime.sendMessage({ type: 'SQLITE_*' })
   ▼
Offscreen Document (sqliteEngineContext.ts, c14)
   │  Worker.postMessage
   ▼
OPFS Worker (opfsWorker.ts, c11)  ── @subframe7536/sqlite-wasm / OPFSCoopSyncVFS + FTS5
   │
   └─ 旧パス併存: wa-sqlite (IndexedDB VFS)
```

`sqliteClient.ts` は SW 側の「共有クライアント」で、以下の工夫を入れています。

- `Mutex`（maxQueue 200）でリクエストを直列化 — offscreen は1操作ずつ処理するため、複数タブからの並行アクセスを防ぐ（M7）
- `ensureOffscreenDocument()` で文書の生存をキャッシュし、不要な IPC を避ける
- メッセージ失敗時に `offscreenAlive=false` として文書を再作成し、1回だけリトライ（M12）

知識グラフ上、`sqliteClient.ts`(c7) と `sqliteEngineContext.ts`(c14) の間には **AST エッジがありません**。SW↔offscreen は `chrome.runtime.sendMessage` 経由のランタイム結合だからです。実装上は `SQLITE_*` というメッセージ型で厳密にプロトコル化されていますが、静的解析では「切れたまま」になります。

---

### 発見 2: 3 段フォールバックの優先順位

offscreen 側の `SqliteEngineContext.getBackend()` は、環境に応じてバックエンドを動的に選びます。

```
OPFS Worker  >  IndexedDB VFS (wa-sqlite async, FTS5あり)  >  chrome.storage.local  >  NoopBackend
```

- `OpfsWorkerBackend` (c53/c94): OPFS 上に永続化し、FTS5 全文検索も使える本番パス
- `IdbVfsBackend` (c53): OPFS が使えない環境向けの IndexedDB フォールバック（ただし `sqliteEngineContext.ts` はまだ `wa-sqlite` のまま）
- `FallbackStorageAdapter` (c53): `chrome.storage.local` への最終フォールバック
- `NoopBackend`: Null Object — 初期化失敗時も例外を投げず「失敗」を返す

すべてのバックエンドは `StorageBackend` インターフェース（`insert/query/search/...` の 18 メソッド）で統一されています。これは ADR 2026-07-13「Storage Backend Adapter」の成果です。

さらに興味深いのは、**フォールバック間のデータ移行**です。`_doInit()` は IDB 初期化後に `tryMigrateFallbackToSqlite()` を呼び、`chrome.storage.local` に溜まったレコードを SQLite へ再投入します。つまり「フォールバックしていた期間のデータ」も後から本流に統合されます。

---

### 発見 3: FTS5 と LIKE の「検索の共存」

ADR-014（2026-06-17）の核心は「OPFS 永続化と FTS5 全文検索の両立」です。従来の `wa-sqlite` では、OPFS に必要な同期ビルドには FTS5 がなく、FTS5 のある非同期ビルドは IndexedDB 止まりでした。

Yasumaro の解決策は、**OPFS Worker パスを `@subframe7536/sqlite-wasm`（`OPFSCoopSyncVFS` + FTS5 内蔵）に置換**し、日本語向けに `trigram` トークナイザを採用することでした。実装（`opfsWorker.ts`）を確認すると：

```ts
// opfsWorker.ts:607
if (fts5Available && charLen >= 3) {
  // browsing_logs_fts MATCH ?  (FTS5 trigram ランク付き検索)
} else {
  // url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?  (LIKE フォールバック)
}
```

- **3 文字以上のクエリ**: FTS5 `trigram` MATCH（日本語部分一致もヒット、ランク付き）
- **2 文字以下**: `trigram` がマッチできないため LIKE にフォールバック（全行スキャンだが、保存件数が数百〜千件規模なので実害なし）
- `fts5Available` が false（IDB 旧パス等）なら検索は `count: 0` を返す

「永続化」「全文検索」「CJK 対応」の3つを、ライブラリ置換＋トークナイザ選定＋クエリ長での分岐という3層の工夫で両立させています。

---

### 発見 4: ドキュメントと実装の乖離（知識グラフが見つけた課題）

知識グラフで浮かんだ最大の課題は、**ADR/PBI と実コードの参照が古くなっている**ことです。

- ADR-014 は `src/offscreen/sqlite.ts` / `src/offscreen/sqliteEngine.ts` を主変更ファイルとしていますが、実際の `sqlite.ts` は **re_exports に退化**し、責務は `sqliteEngineContext.ts`（4モジュール分割）へ移っています
- `sqliteEngine.ts`（`@subframe7536` の薄いラッパ）は **別ファイルとして存在**し、`sqliteEngineContext.ts` とは責務が分かれています
- 結果として、ADR のファイル表から実装を探してもたどり着けず、「設計意図 → 実装」のトレーサビリティが切れています

これは抽出の死角というより、**ADR がリファクタリング後に更新されていない**実務上の課題です。

---

### 開発者の方向け: すぐに効く改善案

1. **ADR-014 のファイル参照を現状に合わせる**: `sqlite.ts`（re_exports）と `sqliteEngineContext.ts` / `sqliteEngine.ts` の関係を追記し、将来の読者が実装にたどり着けるようにする。
2. **IDB フォールバックパスの `@subframe7536` 移行を完了する**: OPFS Worker パスは置換済みだが、`sqliteEngineContext.ts` の IDB VFS 初期化（L9/L233）は未だ `wa-sqlite` のまま。ADR の「旧依存を移行完了まで併存」の期限を決める。
3. **SW↔offscreen のメッセージ型を単一ソース化する**: `SQLITE_*` 文字列が `sqliteClient.ts` と `opfsWorker.ts` の両方に散る。型または定数で共有し、typo による実行時エラーを防ぐ。
4. **Offscreen/OPFS 層の注入経路を可視化する**: この層は AST 上で孤立しやすい。メッセージング契約を docs に図示する。

---

## English

### Introduction

Yasumaro uses SQLite locally as a secondary store for browsing history. Running SQLite in a browser is non-trivial: OPFS persistence (which needs synchronous access) and full-text search (FTS5) were **mutually exclusive** in traditional libraries.

This article traces — via knowledge-graph analysis and reading the actual code — *how Yasumaro reconciles persistence with full-text search while absorbing per-environment constraints*. The short version: it is a **double multiplexing of "3-stage fallback × 2 async channels"**.

---

### Finding 1: SQLite runs away from the Service Worker

In a browser extension, heavy synchronous work like SQLite (WASM) runs not in the Service Worker but in an **Offscreen Document**. Yasumaro's layering:

```
Service Worker (sqliteClient.ts, c7)
   │  chrome.runtime.sendMessage({ type: 'SQLITE_*' })
   ▼
Offscreen Document (sqliteEngineContext.ts, c14)
   │  Worker.postMessage
   ▼
OPFS Worker (opfsWorker.ts, c11)  ── @subframe7536/sqlite-wasm / OPFSCoopSyncVFS + FTS5
   │
   └─ legacy path coexists: wa-sqlite (IndexedDB VFS)
```

`sqliteClient.ts` is the SW-side shared client, with these safeguards:

- A `Mutex` (maxQueue 200) serializes requests — the offscreen processes one op at a time, preventing races from multiple tabs (M7)
- `ensureOffscreenDocument()` caches document liveness to avoid redundant IPC
- On message failure it sets `offscreenAlive=false`, recreates the document, and retries once (M12)

On the knowledge graph, `sqliteClient.ts` (c7) and `sqliteEngineContext.ts` (c14) have **no AST edge** — SW↔offscreen are runtime-bound via `chrome.runtime.sendMessage`. They are strictly protocolized by `SQLITE_*` message types, but static analysis shows them as "disconnected."

---

### Finding 2: The 3-stage fallback priority

Offscreen-side `SqliteEngineContext.getBackend()` dynamically picks a backend per environment:

```
OPFS Worker  >  IndexedDB VFS (wa-sqlite async, FTS5)  >  chrome.storage.local  >  NoopBackend
```

- `OpfsWorkerBackend` (c53/c94): production path — persists on OPFS, full FTS5 search
- `IdbVfsBackend` (c53): IndexedDB fallback when OPFS is unavailable (but `sqliteEngineContext.ts` still uses `wa-sqlite`)
- `FallbackStorageAdapter` (c53): final fallback to `chrome.storage.local`
- `NoopBackend`: Null Object — returns "failure" instead of throwing when init fails

All backends implement the unified `StorageBackend` interface (18 methods: insert/query/search/...). This is the outcome of ADR 2026-07-13 "Storage Backend Adapter."

Notably, **data migrates between fallbacks**. `_doInit()` calls `tryMigrateFallbackToSqlite()` after IDB init, re-inserting records buffered in `chrome.storage.local` into SQLite. So even data accumulated during a fallback period is later merged into the main store.

---

### Finding 3: FTS5 vs LIKE — "search coexistence"

ADR-014 (2026-06-17) centers on reconciling OPFS persistence with FTS5. The old `wa-sqlite` couldn't do both: the sync build needed for OPFS lacked FTS5, and the async FTS5 build was stuck at IndexedDB.

Yasumaro's fix: **replace the OPFS Worker path with `@subframe7536/sqlite-wasm` (`OPFSCoopSyncVFS` + built-in FTS5)**, and adopt the `trigram` tokenizer for Japanese. The implementation (`opfsWorker.ts`):

```ts
// opfsWorker.ts:607
if (fts5Available && charLen >= 3) {
  // browsing_logs_fts MATCH ?  (FTS5 trigram ranked search)
} else {
  // url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?  (LIKE fallback)
}
```

- **Queries ≥ 3 chars**: FTS5 `trigram` MATCH (hits Japanese substring, ranked)
- **< 3 chars**: `trigram` can't match, so LIKE fallback (full scan, but negligible at hundreds–thousands of records)
- If `fts5Available` is false (legacy IDB path), search returns `count: 0`

Persistence, full-text search, and CJK support are reconciled through 3 layers: library swap + tokenizer choice + query-length branching.

---

### Finding 4: Doc↔code drift (what the graph exposed)

The biggest issue the graph surfaced: **ADR/PBI file references are stale**.

- ADR-014 lists `src/offscreen/sqlite.ts` / `src/offscreen/sqliteEngine.ts` as primary files, but `sqlite.ts` has **degraded to re_exports**, and its responsibility moved to `sqliteEngineContext.ts` (4-module split).
- `sqliteEngine.ts` (the `@subframe7536` thin wrapper) **exists as a separate file**, with a different responsibility from `sqliteEngineContext.ts`.
- Consequently, you cannot navigate from the ADR's file table to the implementation — design-intent → code traceability is broken.

This is less an extraction blind spot and more a **practical issue: the ADR was not updated after the refactor**.

---

### For developers: quick wins

1. **Update ADR-014's file references** to match reality: document the `sqlite.ts` (re_exports) ↔ `sqliteEngineContext.ts` / `sqliteEngine.ts` relationship so future readers can reach the code.
2. **Finish migrating the IDB fallback path to `@subframe7536`**: the OPFS Worker path is swapped, but `sqliteEngineContext.ts`'s IDB VFS init (L9/L233) still uses `wa-sqlite`. Set a deadline for the ADR's "coexist until migration completes" clause.
3. **Single-source the SW↔offscreen message types**: `SQLITE_*` strings are scattered across `sqliteClient.ts` and `opfsWorker.ts`. Share via a type/constant to prevent runtime typos.
4. **Visualize the Offscreen/OPFS injection path**: this layer is AST-isolated; document the messaging contract in docs.
