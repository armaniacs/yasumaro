# OPFS + FTS5 両立化 設計書

- **日付**: 2026-06-16
- **対象**: SQLite 永続ストアの OPFS 永続化と FTS5 全文検索の両立
- **採用ライブラリ**: [`@subframe7536/sqlite-wasm`](https://github.com/subframe7536/sqlite-wasm)
- **アプローチ**: 段階置換（既存 Worker の中身のみ差し替え、proxy / fallback 構造は維持）

---

## 1. 背景と問題

現状、OPFS 永続化と FTS5 全文検索は両立できていない。

| パス | 実装 | 永続化 | FTS5 |
|---|---|---|---|
| OPFS Worker (`opfsWorker.ts`) | `wa-sqlite/dist/wa-sqlite.mjs` (sync build) + `AccessHandlePoolVFS` | ✅ OPFS | ❌ なし → LIKE フォールバック |
| IDB (`sqlite.ts`) | `wa-sqlite-async.mjs` + `IDBBatchAtomicVFS` | ❌ IndexedDB | ✅ あり |
| chrome.storage fallback | `storageFallback.ts` | ❌ | ❌ |

`wa-sqlite` の npm 同期ビルドは FTS5 を含まないため、OPFS（要 sync access handle）と FTS5 が排他になっている。

`@subframe7536/sqlite-wasm` は `wa-sqlite-fts5` ビルド + `OPFSCoopSyncVFS` を提供し、**Worker 内で OPFS 永続化と FTS5 を同時に満たす**。これを OPFS パスに導入する。

## 2. ゴールと非ゴール

**ゴール**
- OPFS Worker パスで FTS5 MATCH 検索（rank ソート付き）を有効化する
- 既存ユーザーの DB データをロスなく新フォーマットへ移行する
- 既存の3段フォールバック（OPFS → IDB → chrome.storage）と安全網を維持する

**非ゴール**
- IDB フォールバックの新ライブラリ化（YAGNI）
- chrome.storage fallback の廃止
- postMessage プロトコルの再設計

## 3. アーキテクチャ

```
offscreen (sqlite.ts) ── postMessage ──> opfsWorker.ts
   └ proxy層: tryOpfsProxy で              └ @subframe7536/sqlite-wasm
     INSERT/QUERY/SEARCH/...                  + OPFSCoopSyncVFS
   └ fallback: IDB (wa-sqlite-async, FTS5)    + wa-sqlite-fts5 ビルド (FTS5有効)
   └ fallback: chrome.storage.local           ※ Worker内 OPFS createSyncAccessHandle
```

### 変更点の核心

1. **`opfsWorker.ts`**
   - SQLite エンジンを `@subframe7536/sqlite-wasm`（OPFSCoopSyncVFS + `wa-sqlite-fts5` WASM）へ置換
   - スキーマ作成時に FTS5 仮想テーブル + 同期トリガー（`browsing_logs_ai/ad/au`）を作成
   - `SEARCH` メッセージ型を処理し、本物の FTS5 MATCH を実行
2. **`sqlite.ts`（proxy層）**
   - `SEARCH` メッセージ型を新設し、`search()` を LIKE 経由ではなく FTS5 へ流す
   - OPFS パスで `fts5Available = true` を扱う
   - `STATUS` / `getFtsIndexSize` が Worker の実 FTS5 値を返す
3. **postMessage プロトコル**: 既存の `{id,type,payload}` ⇄ `{id,success,result,error}` を維持。`SEARCH` type を追加するのみ
4. **アセット / manifest**: `wa-sqlite-fts5/wa-sqlite.wasm` を dist へコピー。新 Worker と WASM を `manifest.json` の `web_accessible_resources` に登録（`CLAUDE.local.md` のモジュール分割ルール準拠）

## 4. データフロー

### 検索（変更後）

```
dashboard search入力
  → sqlite.ts search(q)
  → tryOpfsProxy('SEARCH', {q, limit, offset})
  → Worker: sanitizeFtsQuery(q)
            SELECT ... FROM browsing_logs_fts
            JOIN browsing_logs WHERE browsing_logs_fts MATCH ? ORDER BY rank
  → rank付き SearchResult[] を返す
```

従来 OPFS パスでは `search()` が `QUERY`+`searchQuery`(LIKE)に流れ `rank: 0` 固定だった。置換後は IDB パスと同等の FTS5 MATCH + rank ソートになる。`sanitizeFtsQuery`（ホワイトリスト・フレーズ強制）を Worker 側にも複製する。

### 移行（起動時・1回限り・冪等）

```
init()
  1. 旧 AccessHandlePoolVFS DB (/yasumaro-opfs/yasumaro.db) の存在チェック
  2. 存在 & 未移行フラグ → 旧VFS（旧 wa-sqlite）で開いて全レコード SELECT
  3. 新 OPFSCoopSyncVFS DB へ insertBatch（FTS5トリガーが索引を自動構築）
  4. 移行件数を検証ログ → 旧ファイル削除 → 移行済みフラグ set
  5. 失敗時は旧ファイル残置 + 次回再試行（移行フラグは立てない）
```

- 移行は移行済みフラグ（`StorageKeys` に `OPFS_MIGRATION_V2_DONE` 相当を追加）で二重実行を防止
- 旧ファイルは移行成功を確認してから削除
- 旧DBの読み出しに **旧 wa-sqlite (AccessHandlePoolVFS) を移行コード内に限定併存**させる（新ライブラリは旧フォーマットを開けない前提）。移行コードへ閉じ込め、将来バンドルから外せるよう分離する

## 5. エラー処理

| 失敗ケース | 挙動 |
|---|---|
| 新ライブラリ WASM ロード失敗 | OPFS Worker init を `false` → IDB（FTS5あり）→ chrome.storage へ段階フォールバック。保存継続 |
| OPFS Worker 生成不可（古いブラウザ等） | 同上。`isOpfsAvailable()` / `canCreateWorker()` ガードを流用 |
| FTS5 仮想テーブル作成失敗（想定外） | Worker内 catch で `fts5Available=false` 返却 → proxy が LIKE フォールバック（安全網として残置） |
| 移行中の旧DB読み出し失敗 | 旧ファイル残置、移行フラグ立てず、次回再試行。データロスなし |
| 移行中の新DB書き込み失敗 | ROLLBACK、旧ファイル残置、移行フラグ立てない |
| SEARCH の MATCH 構文エラー | `sanitizeFtsQuery` で防止。万一の例外時は空結果 + `logError` |

**原則**: 既存の「OPFS → IDB → chrome.storage」3段フォールバックと `sqliteAlert` を温存。新ライブラリは最上位 OPFS パスを強化するのみで、安全網は外さない。LIKE フォールバックも防御的に残す。

## 6. テスト戦略（スパイク先行 + TDD）

### フェーズ0: スパイク（実環境必須）
最小 Worker を作り、Chrome 拡張（offscreen）で `@subframe7536/sqlite-wasm` + OPFSCoopSyncVFS を起動して以下を検証する。

1. OPFS にファイルが永続化される
2. リロード後もデータが残る
3. `FTS5 MATCH` が動き rank が返る
4. `PRAGMA compile_options` に `ENABLE_FTS5` が含まれる

スパイク結果を dev-docs または本 specs に記録する。

### フェーズ1以降: TDD（Red → Green → Refactor）
- Jest/jsdom では OPFS の `createSyncAccessHandle` を完全再現できないため、**モック境界を Worker proxy（`tryOpfsProxy` / `sendToOpfsWorker`）に置く**
- `sqlite.ts` proxy層: SEARCH 型追加・`fts5Available` 判定・移行トリガーをユニットテスト（Worker をモック）
- 移行ロジック: 旧レコード → 新DB再投入を、ストレージ抽象をモックしてテスト
- 既存テスト群（`sqliteClient.test.ts`, `dashboardSqliteHandlers.test.ts` ほか）が回帰しないこと
- 実 FTS5 検証は Playwright E2E（拡張ロード）で1本: 記録 → 検索ヒット → リロード後も検索ヒット

## 7. 影響ファイル（想定）

| ファイル | 変更内容 |
|---|---|
| `package.json` | `@subframe7536/sqlite-wasm` 追加 |
| `src/offscreen/opfsWorker.ts` | SQLite エンジン置換、FTS5 スキーマ、SEARCH 処理 |
| `src/offscreen/sqlite.ts` | SEARCH proxy、`fts5Available` 扱い、移行起動 |
| `src/offscreen/`（新規移行モジュール） | 旧 VFS → 新 VFS データ移行 |
| `src/utils/storage/types.ts` | `OPFS_MIGRATION_V2_DONE` 相当キー追加 |
| `manifest.json` | 新 Worker / WASM を `web_accessible_resources` に登録 |
| ビルド設定 | `wa-sqlite-fts5` WASM の dist コピー |
| テスト各種 | proxy / 移行のユニットテスト、E2E 1本 |

## スパイク結果（2026-06-16・実機 Chrome 確定ゲート通過）

`@subframe7536/sqlite-wasm@1.1.1` を Chrome 拡張の offscreen → 専用 Worker で起動して検証（`spikeOpfsFts5` / `runOpfsFts5Spike`）。

| 検証項目 | 結果 |
|---|---|
| OPFS supported（Worker 内） | ✅ true |
| FTS5 MATCH が動作 | ✅ true（`ftsMatchWorked: true`） |
| `PRAGMA compile_options` に ENABLE_FTS5 | ✅ true（`hasFts5CompileOption: true`） |
| OPFS 永続化（再実行で件数累積） | ✅ 1回目 `matchCount: 1` → 2回目 `matchCount: 2` |
| エラー/警告 | なし |

**API 訂正（実態）:**
- WASM パスは `wa-sqlite-fts5/` ではなく、パッケージ export `"./wasm"`（= `dist/wa-sqlite.wasm`、FTS5 ビルトイン）。URL は `new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href`。
- `useOpfsStorage(path, { url })` — 第2引数はオブジェクト。
- `run()` 戻り行型は `Record<string, SQLiteCompatibleType>`（`number | string | Uint8Array | number[] | bigint | null`）。
- WXT は `manifest.json` を生成するため、`wxt.config.ts` の `manifest.web_accessible_resources` を編集する（今回ビルドでは追加不要だった）。

**結論:** OPFS 永続化と FTS5 全文検索の両立を実機で確認。本設計の前提が成立。

## 8. 未確定・後続検討
- 旧 wa-sqlite の併存をいつバンドルから外すか（移行完了率が十分に上がった後のリリース）
- `OPFSCoopSyncVFS` の WAL 変種を使うか（ブラウザロック要件次第。デフォルトの OPFSCoopSyncVFS で両立を確認済み。WAL 変種は本実装では不採用とし、必要時に再検討）
