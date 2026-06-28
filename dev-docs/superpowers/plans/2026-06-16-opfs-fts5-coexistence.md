# OPFS + FTS5 両立化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OPFS Worker パスで FTS5 全文検索（rank ソート付き）を有効化し、OPFS 永続化と FTS5 を両立させる。

**Architecture:** `src/offscreen/opfsWorker.ts` の SQLite エンジンを `@subframe7536/sqlite-wasm`（`OPFSCoopSyncVFS` + `wa-sqlite-fts5` ビルド）へ置換する。offscreen ↔ Worker の postMessage プロトコルと `sqlite.ts` の proxy / 3 段フォールバック構造は維持し、`SEARCH` メッセージ型を追加する。旧 `AccessHandlePoolVFS` DB からの 1 回限りデータ移行を行う。

**Tech Stack:** TypeScript (ESM, `.js` 拡張子 import), WXT (ビルド/manifest 生成), Vitest (ユニット), Playwright (E2E), `@subframe7536/sqlite-wasm@^1.1.1`, 旧 `wa-sqlite@^1.0.0`（移行読み出し用に併存）。

**重要な前提（実装前に必読）:**
- このプロジェクトは **WXT** を使用。`manifest.json` は存在せず `wxt.config.ts` が生成する。`web_accessible_resources` は `wxt.config.ts:109` の `manifest.web_accessible_resources` を編集する（`CLAUDE.local.md` の「manifest.json を編集」という記述は旧構成のもの。WXT では wxt.config.ts が正）。
- Worker は `new Worker(new URL('./opfsWorker.js', import.meta.url), { type: 'module' })`（`sqlite.ts:133`）でロードされる。WXT/Vite が依存をバンドルするため、`@subframe7536/sqlite-wasm` の import はそのまま解決される。
- WASM はネットワーク CDN ではなく**拡張内バンドル資産**を使う（拡張の CSP `connect-src` に jsdelivr が無いため CDN は不可）。`new URL('...wa-sqlite.wasm', import.meta.url)` で Vite にバンドルさせ、`chrome.runtime.getURL` 互換の URL を `useOpfsStorage` に渡す。
- `@subframe7536/sqlite-wasm` の `run(sql, params?)` は **`Array<Record<string, value>>`（名前付きカラム）** を返す。現行 worker の `row[0]` 配列アクセスとは異なるため、各ハンドラを名前付きカラム参照へ書き換える。

---

## File Structure

| ファイル | 責務 | 変更種別 |
|---|---|---|
| `package.json` | `@subframe7536/sqlite-wasm` 依存追加 | Modify |
| `wxt.config.ts` | `web_accessible_resources` に wasm 追加（必要時） | Modify |
| `src/offscreen/opfsSpike.ts` | スパイク: 新ライブラリで OPFS+FTS5 動作検証 | Modify |
| `src/offscreen/sqliteEngine.ts` | 新ライブラリのラッパ（init/run/query/exec を集約） | Create |
| `src/offscreen/opfsWorker.ts` | エンジン置換・FTS5 スキーマ・SEARCH 処理 | Modify |
| `src/offscreen/opfsMigrationV2.ts` | 旧 AccessHandlePoolVFS DB → 新 DB データ移行 | Create |
| `src/offscreen/sqlite.ts` | SEARCH proxy・fts5Available 扱い・移行起動 | Modify |
| `src/utils/storage/types.ts` | `OPFS_MIGRATION_V2_DONE` キー追加 | Modify |
| `src/offscreen/__tests__/sqliteEngine.test.ts` | エンジンラッパのユニットテスト | Create |
| `src/offscreen/__tests__/opfsMigrationV2.test.ts` | 移行ロジックのユニットテスト | Create |
| `src/background/__tests__/sqliteClient.test.ts` | SEARCH proxy 回帰/追加テスト | Modify |
| `testDir/e2e/opfs-fts5-search.spec.ts` | E2E: 記録→検索→リロード後検索 | Create |

各ファイルは単一責務に分離する。`sqliteEngine.ts` は新ライブラリ依存を 1 箇所に閉じ込め、`opfsWorker.ts` から SQLite ベンダ詳細を隠蔽する。`opfsMigrationV2.ts` は旧 `wa-sqlite` 依存をここだけに限定し、将来バンドルから外しやすくする。

> **Task 1 スパイクで判明した API 訂正（後続タスクは以下に従うこと）:**
> - **WASM パス**: v1.1.1 には `wa-sqlite-fts5/` サブディレクトリは存在しない。FTS5 はパッケージ export `"./wasm"`（= `dist/wa-sqlite.wasm`）にコンパイル済み（`ENABLE_FTS5` 確認済み）。よって URL は `new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href`。Task 2/3 の `WASM_URL` はこれを使う。
> - **useOpfsStorage シグネチャ**: 第2引数はオブジェクト `{ url }`。`useOpfsStorage('yasumaro.db', { url: WASM_URL })`。
> - **run() の行型**: `Record<string, SQLiteCompatibleType>`（`SQLiteCompatibleType = number | string | Uint8Array | Array<number> | bigint | null`）。`sqliteEngine.ts` の `SqliteValue` 型はこれに合わせ、`bigint` / `number[]` も含めるか、数値は `Number()` で正規化する。Task 2 のラッパで吸収すること。

---

## Task 1: 依存追加とスパイク準備

**Files:**
- Modify: `package.json`
- Modify: `src/offscreen/opfsSpike.ts`

- [ ] **Step 1: ライブラリをインストール**

Run:
```bash
npm install @subframe7536/sqlite-wasm@^1.1.1
```
Expected: `package.json` の `dependencies` に `"@subframe7536/sqlite-wasm": "^1.1.1"` が追加され、`node_modules` に展開される。

- [ ] **Step 2: WASM 資産をローカルバンドル用にコピー設定を確認**

Run:
```bash
ls node_modules/@subframe7536/sqlite-wasm/wa-sqlite-fts5/wa-sqlite.wasm
```
Expected: ファイルが存在する（FTS5 ビルドの wasm）。存在しない場合は `find node_modules/@subframe7536/sqlite-wasm -name '*.wasm'` で正確なパスを確認し、以降の `new URL()` パスを合わせる。

- [ ] **Step 3: スパイクを書く（実環境検証用）**

`src/offscreen/opfsSpike.ts` の既存 spike 関数の隣に、新ライブラリ用の検証関数を追加する。ファイル冒頭の import に追記:

```ts
import { initSQLite, isOpfsSupported } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';
```

ファイル末尾に追加:

```ts
/**
 * スパイク: @subframe7536/sqlite-wasm で OPFS 永続化 + FTS5 が両立するか検証する。
 * Worker 内で呼び出すこと（createSyncAccessHandle は Worker でのみ許可）。
 */
export async function spikeOpfsFts5(): Promise<{
  opfsSupported: boolean;
  ftsMatchWorked: boolean;
  matchCount: number;
  hasFts5CompileOption: boolean;
}> {
  const opfsSupported = await isOpfsSupported();
  if (!opfsSupported) {
    return { opfsSupported: false, ftsMatchWorked: false, matchCount: 0, hasFts5CompileOption: false };
  }

  const wasmUrl = new URL(
    '@subframe7536/sqlite-wasm/wa-sqlite-fts5/wa-sqlite.wasm',
    import.meta.url
  ).href;

  const { run, close } = await initSQLite(useOpfsStorage('yasumaro-spike.db', wasmUrl));

  let hasFts5CompileOption = false;
  const opts = await run('PRAGMA compile_options');
  for (const row of opts) {
    const v = String(Object.values(row)[0] ?? '');
    if (v.includes('ENABLE_FTS5')) hasFts5CompileOption = true;
  }

  await run('CREATE TABLE IF NOT EXISTS spike_logs (id INTEGER PRIMARY KEY, title TEXT)');
  await run(`CREATE VIRTUAL TABLE IF NOT EXISTS spike_fts USING fts5(title, content='spike_logs', content_rowid='id')`);
  await run('INSERT INTO spike_logs (title) VALUES (?)', ['hello world fts5 spike']);
  await run('INSERT INTO spike_fts(rowid, title) SELECT id, title FROM spike_logs');

  let matchCount = 0;
  const matched = await run('SELECT COUNT(*) AS c FROM spike_fts WHERE spike_fts MATCH ?', ['hello']);
  matchCount = Number((matched[0] as Record<string, unknown>)?.c ?? 0);

  await close();
  return { opfsSupported: true, ftsMatchWorked: matchCount > 0, matchCount, hasFts5CompileOption };
}
```

- [ ] **Step 4: スパイクをビルドして Chrome 拡張で実行する**

Run:
```bash
npm run build
```
Expected: ビルド成功。`dist/` に offscreen と worker チャンクが生成される。

その後、手動で:
1. `chrome://extensions` で `dist` を「パッケージ化されていない拡張機能を読み込む」
2. offscreen の DevTools または一時的に worker から `spikeOpfsFts5()` を呼ぶハーネスで実行
3. 結果が `{ opfsSupported: true, ftsMatchWorked: true, matchCount: 1, hasFts5CompileOption: true }` であることを確認
4. ページをリロードし、再度 `useOpfsStorage('yasumaro-spike.db', ...)` で開いて `SELECT COUNT(*) FROM spike_logs` が 1 以上 = 永続化を確認

Expected: 4 項目すべて成功。**1 つでも失敗したら設計を見直す**（ここが両立可否の確定ゲート）。

- [ ] **Step 5: スパイク結果を記録**

`docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md` の「8. 未確定・後続検討」直前に `## スパイク結果（YYYY-MM-DD）` セクションを追記し、4 項目の実測値と「WAL 変種を使うか」の判断を記録する。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/offscreen/opfsSpike.ts docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md
git commit -m "spike: verify OPFS+FTS5 coexistence with @subframe7536/sqlite-wasm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: SQLite エンジンラッパ (`sqliteEngine.ts`)

新ライブラリ依存を 1 ファイルに閉じ込め、`opfsWorker.ts` が使う最小 API を提供する。

**Files:**
- Create: `src/offscreen/sqliteEngine.ts`
- Test: `src/offscreen/__tests__/sqliteEngine.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/offscreen/__tests__/sqliteEngine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 新ライブラリをモック（jsdom では OPFS sync handle が動かないため）
const mockRun = vi.fn();
const mockClose = vi.fn();
vi.mock('@subframe7536/sqlite-wasm', () => ({
  initSQLite: vi.fn(async () => ({
    run: mockRun,
    changes: vi.fn(() => 0),
    lastInsertRowId: vi.fn(() => 0),
    close: mockClose,
  })),
  isOpfsSupported: vi.fn(async () => true),
}));
vi.mock('@subframe7536/sqlite-wasm/opfs', () => ({
  useOpfsStorage: vi.fn((path: string, url: string) => ({ path, url })),
}));

import { createEngine } from '../sqliteEngine.js';

describe('sqliteEngine', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
  });

  it('exec() で DDL を実行する', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.exec('CREATE TABLE t (id INTEGER)');
    expect(mockRun).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)', undefined);
  });

  it('query() は名前付きカラムの行配列を返す', async () => {
    mockRun.mockResolvedValue([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT id, title FROM t WHERE id > ?', [0]);
    expect(rows).toEqual([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    expect(mockRun).toHaveBeenCalledWith('SELECT id, title FROM t WHERE id > ?', [0]);
  });

  it('queryValue() は最初の行の最初の列を返す', async () => {
    mockRun.mockResolvedValue([{ c: 42 }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBe(42);
  });

  it('queryValue() は行が無ければ null を返す', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- sqliteEngine`
Expected: FAIL（`createEngine` が存在しない / モジュール解決エラー）。

- [ ] **Step 3: 最小実装を書く**

`src/offscreen/sqliteEngine.ts`:

```ts
/**
 * sqliteEngine.ts
 * @subframe7536/sqlite-wasm の薄いラッパ。新ライブラリ依存をこのファイルに集約し、
 * opfsWorker.ts へ exec / query / queryValue の最小 API を提供する。
 */
import { initSQLite } from '@subframe7536/sqlite-wasm';
import { useOpfsStorage } from '@subframe7536/sqlite-wasm/opfs';

export type SqliteValue = number | string | Uint8Array | null;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteEngine {
  /** DDL / 戻り値不要な文を実行 */
  exec(sql: string, params?: SqliteValue[]): Promise<void>;
  /** SELECT を実行し名前付きカラムの行配列を返す */
  query(sql: string, params?: SqliteValue[]): Promise<SqliteRow[]>;
  /** SELECT の最初の行・最初の列のスカラ値を返す（無ければ null） */
  queryValue(sql: string, params?: SqliteValue[]): Promise<SqliteValue>;
  close(): Promise<void>;
}

export async function createEngine(dbPath: string, wasmUrl: string): Promise<SqliteEngine> {
  const { run, close } = await initSQLite(useOpfsStorage(dbPath, wasmUrl));

  const runTyped = run as (sql: string, params?: SqliteValue[]) => Promise<SqliteRow[]>;

  return {
    async exec(sql, params) {
      await runTyped(sql, params);
    },
    async query(sql, params) {
      return runTyped(sql, params);
    },
    async queryValue(sql, params) {
      const rows = await runTyped(sql, params);
      if (rows.length === 0) return null;
      const first = rows[0];
      const keys = Object.keys(first);
      return keys.length > 0 ? first[keys[0]] : null;
    },
    async close() {
      await close();
    },
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test -- sqliteEngine`
Expected: PASS（4 ケース）。

- [ ] **Step 5: 型チェック**

Run: `npm run type-check`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/offscreen/sqliteEngine.ts src/offscreen/__tests__/sqliteEngine.test.ts
git commit -m "feat(sqlite): add @subframe7536/sqlite-wasm engine wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: opfsWorker をエンジン置換 + FTS5 スキーマ

`opfsWorker.ts` の `initSqlite` / `sqlExec` / `sqlQuery` をエンジン経由に置換し、FTS5 仮想テーブルとトリガーを追加する。CRUD ハンドラを名前付きカラム参照へ書き換える。

**Files:**
- Modify: `src/offscreen/opfsWorker.ts`

> 注: この Worker は jsdom で直接ユニットテストできない（OPFS sync handle 依存）。検証は Task 6 の E2E と、Task 4 の移行/Task 5 の proxy ユニットテスト（worker をモック）で担保する。本タスクは型チェック + ビルドで検証する。

- [ ] **Step 1: import を差し替える**

`src/offscreen/opfsWorker.ts` の冒頭を以下に置換:

```ts
// 旧:
//   import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
//   import * as SQLite from 'wa-sqlite';
//   import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';
// 新:
import { createEngine, type SqliteEngine, type SqliteValue, type SqliteRow } from './sqliteEngine.js';
import { errorMessage } from '../utils/errorUtils.js';
```

- [ ] **Step 2: FTS5 スキーマ定数を追加**

`SCHEMA_SQL` 定数の直後に追加（`src/offscreen/sqlite.ts:55-80` の `FTS5_SQL` と同一内容に揃える）:

```ts
const FTS5_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='unicode61 tokenchars'
  );

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ai AFTER INSERT ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ad AFTER DELETE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_au AFTER UPDATE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;
`;

const WASM_URL = new URL(
  '@subframe7536/sqlite-wasm/wa-sqlite-fts5/wa-sqlite.wasm',
  import.meta.url
).href;

const FTS_QUERY_MAX_LENGTH = 200;

/** FTS5 クエリのサニタイズ（sqlite.ts と同一ロジック）。 */
function sanitizeFtsQuery(query: string): string {
  if (!query) return '';
  const truncated = query.slice(0, FTS_QUERY_MAX_LENGTH);
  const sanitized = truncated
    .replace(/[^A-Za-z0-9぀-ゟ゠-ヿ一-鿿㐀-䶿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return '';
  return `"${sanitized}"`;
}
```

- [ ] **Step 3: モジュール状態とエンジン初期化を置換**

`let sqlite3 ...` / `let dbHandle ...` のブロックと `wrapModule` / `initSqlite` / `getSqlite` を以下に置換:

```ts
let engine: SqliteEngine | null = null;
let cachedCompileOptions: string[] | null = null;
let fts5Available = false;

async function initSqlite(): Promise<void> {
  if (engine !== null) return;

  engine = await createEngine(DB_FILENAME, WASM_URL);

  await engine.exec(SCHEMA_SQL);

  // obsidian_synced 列の後方互換マイグレーション
  try {
    await engine.exec('ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
  } catch {
    // 既に存在
  }

  // FTS5 仮想テーブル + トリガー
  fts5Available = false;
  try {
    await engine.exec(FTS5_SQL);
    fts5Available = true;
  } catch (err) {
    console.warn('OPFS Worker: FTS5 unavailable, falling back to LIKE', errorMessage(err));
  }

  // compile_options をキャッシュ
  const opts = await engine.query('PRAGMA compile_options');
  cachedCompileOptions = opts.map((r) => String(Object.values(r)[0] ?? ''));
}

function getEngine(): SqliteEngine {
  if (!engine) throw new Error('OPFS SQLite not initialized');
  return engine;
}
```

> 注: `DB_FILENAME` は引き続き `'yasumaro.db'`。`POOL_DIR` は旧 VFS 用なので削除する。`OPFSCoopSyncVFS` はファイル名のみで管理する。

- [ ] **Step 4: sqlExec / sqlQuery をエンジン委譲に置換**

```ts
async function sqlExec(sql: string, params: SqliteValue[] = []): Promise<void> {
  await getEngine().exec(sql, params);
}

async function sqlQuery(
  sql: string, params: SqliteValue[], callback: (row: SqliteRow) => void
): Promise<void> {
  const rows = await getEngine().query(sql, params);
  for (const row of rows) callback(row);
}
```

> 重要: `sqlQuery` のコールバック引数が **配列 `SqliteValue[]` → 名前付き `SqliteRow`** に変わる。以降の全ハンドラで `row[0]` を列名参照へ書き換える（Step 5〜10）。

- [ ] **Step 5: handleInsert を書き換え**

```ts
async function handleInsert(record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);
  await sqlExec(
    `INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
      record.created_at, domain, record.visit_duration ?? null, record.scroll_ratio ?? null,
      record.is_starred ?? 0, record.is_deleted ?? 0,
    ]
  );
  let id = 0;
  await sqlQuery('SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}
```

- [ ] **Step 6: handleQuery の行マッピングを列名参照へ書き換え**

`handleQuery` 内の SELECT 結果コールバックを置換（カラム別名で参照）:

```ts
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced
     FROM browsing_logs ${where}
     ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id), url: String(row.url), title: row.title as string | null,
        summary: row.summary as string | null, tags: row.tags as string | null,
        created_at: Number(row.created_at), domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null, scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred), is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
      });
    }
  );
```

`handleQuery` 内の COUNT も `row.c` 参照へ:

```ts
  let total = 0;
  await sqlQuery(`SELECT COUNT(*) AS c FROM browsing_logs ${where}`, params, (row) => { total = Number(row.c); });
```

- [ ] **Step 7: handleQuery から LIKE フォールバック分岐を削除し、SEARCH ハンドラを新設**

`handleQuery` の `if (searchQuery) { ... }` ブロックは **削除**（検索は専用ハンドラへ）。`QueryPayload` の `searchQuery` フィールドも削除。`handleQuery` の直後に追加:

```ts
interface SearchPayload { searchQuery: string; limit?: number; offset?: number; }

async function handleSearch(payload: SearchPayload): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const { searchQuery, limit = 50, offset = 0 } = payload;

  if (!fts5Available) {
    // 安全網: FTS5 が万一無効なら LIKE 検索にフォールバック
    return handleSearchLike(searchQuery, limit, offset);
  }

  const ftsQuery = sanitizeFtsQuery(searchQuery);
  if (!ftsQuery) return { rows: [], total: 0 };

  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
    [ftsQuery], (row) => { total = Number(row.c); }
  );

  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain,
            b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank
     FROM browsing_logs_fts
     JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
     WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
     ORDER BY rank LIMIT ? OFFSET ?`,
    [ftsQuery, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id), url: String(row.url), title: row.title as string | null,
        summary: row.summary as string | null, tags: row.tags as string | null,
        created_at: Number(row.created_at), domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null, scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred), rank: Number(row.rank),
      });
    }
  );
  return { rows, total };
}

async function handleSearchLike(searchQuery: string, limit: number, offset: number): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const like = `%${searchQuery}%`;
  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)`,
    [like, like, like, like], (row) => { total = Number(row.c); }
  );
  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
     FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [like, like, like, like, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id), url: String(row.url), title: row.title as string | null,
        summary: row.summary as string | null, tags: row.tags as string | null,
        created_at: Number(row.created_at), domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null, scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred), rank: 0,
      });
    }
  );
  return { rows, total };
}
```

`BrowsingLogRecord` interface の近くに `SearchResultRecord` 型を追加:

```ts
interface SearchResultRecord extends Omit<BrowsingLogRecord, 'is_deleted' | 'obsidian_synced'> {
  rank: number;
}
```

- [ ] **Step 8: 残りのハンドラ（update/delete/toggleStar/count/purge/clearAll/serialize/ftsIndexSize）の行参照を列名へ書き換え**

各ハンドラ内の `row[0]` を対応する別名へ置換する。具体的には:
- `handleToggleStar`: `SELECT is_starred AS is_starred ...` → `row.is_starred`
- `handleGetCount`: `SELECT COUNT(*) AS c ...` → `row.c`
- `handlePurgeOldRecords`: `SELECT changes() AS c` → `row.c`、`SELECT COUNT(*) AS c` → `row.c`
- `handleFtsIndexSize`: `fts5Available ? 'SELECT COUNT(*) AS c FROM browsing_logs_fts' : 0` → `row.c`（下記 Step 9）
- `handleSerialize`: 全行 SELECT のコールバックを列名参照へ
- `handleClearAll`: FTS5 ありなら `DELETE FROM browsing_logs_fts;` も実行

> 各箇所で `SELECT changes()` や `SELECT COUNT(*)` には必ず `AS c` の別名を付け、`row.c` で読む（名前付きカラム必須のため）。

- [ ] **Step 9: handleGetStatus / handleFtsIndexSize を FTS5 実値に**

```ts
async function handleGetStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }> {
  if (!engine) {
    return { initialized: false, path: DB_FILENAME, fallback: false, fts5: false, count: 0 };
  }
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs', [], (row) => { count = Number(row.c); });
  return {
    initialized: true, path: DB_FILENAME, fallback: false,
    fts5: fts5Available, count, compileOptions: cachedCompileOptions ?? undefined,
  };
}

async function handleFtsIndexSize(): Promise<{ count: number }> {
  if (!engine || !fts5Available) return { count: 0 };
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs_fts', [], (row) => { count = Number(row.c); });
  return { count };
}
```

- [ ] **Step 10: handleRequest に SEARCH ケースを追加**

`switch (type)` の `'QUERY'` ケースの直後に追加:

```ts
      case 'SEARCH': {
        if (!engine) await initSqlite();
        result = await handleSearch(payload as SearchPayload);
        break;
      }
```

- [ ] **Step 11: 型チェック**

Run: `npm run type-check`
Expected: エラーなし。`wa-sqlite` import が消え、`sqliteEngine` 経由になっていること。

- [ ] **Step 12: ビルド**

Run: `npm run build`
Expected: ビルド成功。worker チャンクに新ライブラリがバンドルされる。失敗時は `wxt.config.ts:111` の `web_accessible_resources` に `'chunks/*.js'` と wasm が含まれるか確認（既に `chunks/*.js` と `assets/*.js` あり。wasm が別拡張子で出る場合は `'*.wasm'` を resources に追加）。

- [ ] **Step 13: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "feat(sqlite): enable FTS5 in OPFS worker via new engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 旧 DB からのデータ移行 (`opfsMigrationV2.ts`)

旧 `AccessHandlePoolVFS` の DB が OPFS に残っていれば、全レコードを読み出して新 DB へ再投入する。旧 `wa-sqlite` 依存をこのファイルに限定する。

**Files:**
- Create: `src/offscreen/opfsMigrationV2.ts`
- Modify: `src/utils/storage/types.ts`
- Test: `src/offscreen/__tests__/opfsMigrationV2.test.ts`

- [ ] **Step 1: StorageKeys にキー追加**

`src/utils/storage/types.ts:177`（`OPFS_FALLBACK_MODE` の行）の直後に追加:

```ts
    OPFS_MIGRATION_V2_DONE: 'opfs_migration_v2_done', // true when AccessHandlePoolVFS→OPFSCoopSyncVFS migration completed
```

`src/utils/storage/types.ts:314`（`[StorageKeys.OPFS_FALLBACK_MODE]: boolean;`）の直後に型を追加:

```ts
    [StorageKeys.OPFS_MIGRATION_V2_DONE]: boolean;
```

- [ ] **Step 2: 失敗するテストを書く**

`src/offscreen/__tests__/opfsMigrationV2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadOldRecords = vi.fn();
const mockDeleteOldDb = vi.fn();

// 旧 DB 読み出しと削除をモック（jsdom で OPFS は動かない）
vi.mock('../opfsMigrationV2Reader.js', () => ({
  readOldDbRecords: (...args: unknown[]) => mockReadOldRecords(...args),
  deleteOldDbFile: (...args: unknown[]) => mockDeleteOldDb(...args),
}));

import { migrateOldOpfsDb, type MigrationDeps } from '../opfsMigrationV2.js';

function makeDeps(over: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    isMigrationDone: vi.fn(async () => false),
    setMigrationDone: vi.fn(async () => {}),
    insertBatch: vi.fn(async (recs: unknown[]) => ({ count: (recs as unknown[]).length })),
    ...over,
  };
}

describe('migrateOldOpfsDb', () => {
  beforeEach(() => {
    mockReadOldRecords.mockReset();
    mockDeleteOldDb.mockReset();
  });

  it('移行済みなら何もしない', async () => {
    const deps = makeDeps({ isMigrationDone: vi.fn(async () => true) });
    const r = await migrateOldOpfsDb(deps);
    expect(r).toEqual({ migrated: 0, skipped: true });
    expect(deps.insertBatch).not.toHaveBeenCalled();
  });

  it('旧レコードを新 DB へ再投入し、旧ファイルを削除してフラグを立てる', async () => {
    mockReadOldRecords.mockResolvedValue([
      { url: 'https://a.com', created_at: 1 },
      { url: 'https://b.com', created_at: 2 },
    ]);
    mockDeleteOldDb.mockResolvedValue(undefined);
    const deps = makeDeps();
    const r = await migrateOldOpfsDb(deps);
    expect(deps.insertBatch).toHaveBeenCalledWith([
      { url: 'https://a.com', created_at: 1 },
      { url: 'https://b.com', created_at: 2 },
    ]);
    expect(mockDeleteOldDb).toHaveBeenCalled();
    expect(deps.setMigrationDone).toHaveBeenCalled();
    expect(r).toEqual({ migrated: 2, skipped: false });
  });

  it('旧 DB が存在しない（0件）ならフラグだけ立てて削除しない', async () => {
    mockReadOldRecords.mockResolvedValue([]);
    const deps = makeDeps();
    const r = await migrateOldOpfsDb(deps);
    expect(deps.insertBatch).not.toHaveBeenCalled();
    expect(mockDeleteOldDb).not.toHaveBeenCalled();
    expect(deps.setMigrationDone).toHaveBeenCalled();
    expect(r).toEqual({ migrated: 0, skipped: false });
  });

  it('再投入失敗時はフラグを立てず旧ファイルも残す', async () => {
    mockReadOldRecords.mockResolvedValue([{ url: 'https://a.com', created_at: 1 }]);
    const deps = makeDeps({ insertBatch: vi.fn(async () => { throw new Error('write fail'); }) });
    const r = await migrateOldOpfsDb(deps);
    expect(deps.setMigrationDone).not.toHaveBeenCalled();
    expect(mockDeleteOldDb).not.toHaveBeenCalled();
    expect(r).toEqual({ migrated: 0, skipped: false, error: 'write fail' });
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npm test -- opfsMigrationV2`
Expected: FAIL（`migrateOldOpfsDb` 未定義）。

- [ ] **Step 4: 移行オーケストレータを実装**

`src/offscreen/opfsMigrationV2.ts`:

```ts
/**
 * opfsMigrationV2.ts
 * 旧 AccessHandlePoolVFS DB → 新 OPFSCoopSyncVFS DB へのデータ移行（1回限り・冪等）。
 * 旧 wa-sqlite 依存は opfsMigrationV2Reader.ts に閉じ込める。
 */
import { errorMessage } from '../utils/errorUtils.js';
import { readOldDbRecords, deleteOldDbFile } from './opfsMigrationV2Reader.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

export interface MigrationDeps {
  isMigrationDone(): Promise<boolean>;
  setMigrationDone(): Promise<void>;
  insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number }>;
}

export interface MigrationResult {
  migrated: number;
  skipped: boolean;
  error?: string;
}

export async function migrateOldOpfsDb(deps: MigrationDeps): Promise<MigrationResult> {
  if (await deps.isMigrationDone()) {
    return { migrated: 0, skipped: true };
  }

  try {
    const records = await readOldDbRecords();

    if (records.length === 0) {
      // 旧 DB なし or 空 → 移行不要。フラグを立てて二度と試さない
      await deps.setMigrationDone();
      return { migrated: 0, skipped: false };
    }

    const { count } = await deps.insertBatch(records);

    // 再投入成功を確認してから旧ファイル削除 → フラグ
    await deleteOldDbFile();
    await deps.setMigrationDone();
    return { migrated: count, skipped: false };
  } catch (err) {
    // 失敗時はフラグを立てず旧ファイルも残す（次回再試行）
    return { migrated: 0, skipped: false, error: errorMessage(err) };
  }
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test -- opfsMigrationV2`
Expected: PASS（4 ケース）。

- [ ] **Step 6: 旧 DB リーダを実装（旧 wa-sqlite 限定併存）**

`src/offscreen/opfsMigrationV2Reader.ts`:

```ts
/**
 * opfsMigrationV2Reader.ts
 * 旧 AccessHandlePoolVFS DB を旧 wa-sqlite で開いて全レコードを読み出す。
 * 旧ライブラリ依存はこのファイルにのみ存在する（移行完了後に削除可能）。
 * Worker 内でのみ動作する（createSyncAccessHandle 依存）。
 */
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { AccessHandlePoolVFS } from 'wa-sqlite/src/examples/AccessHandlePoolVFS.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

const OLD_POOL_DIR = '/yasumaro-opfs';
const OLD_DB_FILENAME = 'yasumaro.db';

/** 旧 DB から全レコードを読み出す。旧 DB が無ければ空配列。 */
export async function readOldDbRecords(): Promise<BrowsingLogRecord[]> {
  // 旧 DB ファイルの存在確認（OPFS ディレクトリを直接覗く）
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OLD_POOL_DIR.replace(/^\//, ''), { create: false }).catch(() => null);
    if (!dir) return [];
  } catch {
    return [];
  }

  const factory = await SQLiteESMFactory();
  if (!(factory as { registerVFS?: unknown }).registerVFS && typeof (factory as { vfs_register?: unknown }).vfs_register === 'function') {
    (factory as { registerVFS: unknown }).registerVFS = (factory as { vfs_register: unknown }).vfs_register;
  }
  const sqlite3 = SQLite.Factory(factory);
  const vfs = new AccessHandlePoolVFS(OLD_POOL_DIR);
  if (typeof (vfs as { hasAsyncMethod?: unknown }).hasAsyncMethod !== 'function') {
    (vfs as unknown as { hasAsyncMethod: () => boolean }).hasAsyncMethod = () => false;
  }
  await (vfs as unknown as { isReady: Promise<void> }).isReady;
  sqlite3.vfs_register(vfs as unknown as Parameters<typeof sqlite3.vfs_register>[0], true);

  const db = await sqlite3.open_v2(
    OLD_DB_FILENAME,
    SQLite.SQLITE_OPEN_READWRITE,
    (vfs as unknown as { name: string }).name
  );

  const records: BrowsingLogRecord[] = [];
  try {
    await sqlite3.exec(
      db,
      `SELECT url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted
       FROM browsing_logs`,
      (row: unknown[]) => {
        records.push({
          url: String(row[0]), title: row[1] as string | null, summary: row[2] as string | null,
          tags: row[3] as string | null, created_at: Number(row[4]), domain: row[5] as string | null,
          visit_duration: row[6] as number | null, scroll_ratio: row[7] as number | null,
          is_starred: Number(row[8]), is_deleted: Number(row[9]),
        });
      }
    );
  } catch {
    // 旧テーブルが無い等 → 空で返す
  } finally {
    await sqlite3.close(db);
  }
  return records;
}

/** 旧 DB ファイル（旧 VFS のディレクトリごと）を OPFS から削除する。 */
export async function deleteOldDbFile(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OLD_POOL_DIR.replace(/^\//, ''), { recursive: true });
  } catch {
    // 既に無ければ無視
  }
}
```

> 注: `exec` のコールバック行引数の型は旧 wa-sqlite では配列。新エンジンとは別物なのでここでは `row[0]` でよい。

- [ ] **Step 7: 型チェック**

Run: `npm run type-check`
Expected: エラーなし。

- [ ] **Step 8: Commit**

```bash
git add src/offscreen/opfsMigrationV2.ts src/offscreen/opfsMigrationV2Reader.ts src/offscreen/__tests__/opfsMigrationV2.test.ts src/utils/storage/types.ts
git commit -m "feat(sqlite): migrate old AccessHandlePoolVFS DB to new OPFS DB

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: sqlite.ts proxy に SEARCH と移行起動を統合

offscreen 側 proxy を更新: OPFS パスで `search()` を新 `SEARCH` メッセージへ流し、`fts5Available` を OPFS パスで `true` 扱いにし、Worker INIT 後に移行を起動する。

**Files:**
- Modify: `src/offscreen/sqlite.ts`
- Test: `src/background/__tests__/sqliteClient.test.ts`

- [ ] **Step 1: 失敗するテストを書く（SEARCH proxy）**

`src/background/__tests__/sqliteClient.test.ts` に、OPFS Worker をモックする既存パターンに合わせてケースを追加。既存のモックヘルパが無い場合は以下を `describe` 内に追加:

```ts
  it('OPFS パスで search() は SEARCH メッセージを送り rank 付き結果を返す', async () => {
    // sqlite モジュールの worker proxy をモック化する既存の仕組みを利用。
    // sendToOpfsWorker('SEARCH', ...) が呼ばれ、戻り値がそのまま rows として返ること。
    const { search, _setOpfsProxyForTesting } = await import('../../offscreen/sqlite.js');
    _setOpfsProxyForTesting(async (type: string, payload: unknown) => {
      expect(type).toBe('SEARCH');
      expect((payload as { searchQuery: string }).searchQuery).toBe('hello');
      return { rows: [{ id: 1, url: 'https://a.com', created_at: 1, rank: -2.5 }], total: 1 };
    });
    const r = await search('hello', 50, 0);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.rows[0].rank).toBe(-2.5);
      expect(r.total).toBe(1);
    }
    _setOpfsProxyForTesting(null);
  });
```

> 注: `_setOpfsProxyForTesting` は次の Step で `sqlite.ts` に追加するテスト用フック。既存のモック手法（`vi.mock` 等）がテストファイルに既にある場合はそれに合わせ、本フックは追加しない判断でもよい。その場合は「SEARCH を送ること」を検証する形にする。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- sqliteClient`
Expected: FAIL（`_setOpfsProxyForTesting` 未定義 または SEARCH が送られない）。

- [ ] **Step 3: sqlite.ts に SEARCH proxy を実装**

`src/offscreen/sqlite.ts` の `search()` 関数（`:732` 付近）の OPFS 分岐を以下に置換:

```ts
    // OPFS Worker: 本物の FTS5 検索（SEARCH メッセージ）
    const opfsResult = await tryOpfsProxy<{ rows: SearchResult[]; total: number }>('SEARCH', {
      searchQuery, limit, offset,
    });
    if (opfsResult !== null) {
      return { success: true, rows: opfsResult.rows, total: opfsResult.total };
    }
```

（従来の `QUERY`+`searchQuery`+`rank:0` マッピングは削除。）

- [ ] **Step 4: テスト用フックを追加（必要な場合）**

`src/offscreen/sqlite.ts` の `tryOpfsProxy` 付近に、Step 1 で使うフックを追加（既存のテスト手法を使う場合は不要）:

```ts
let _testProxyOverride: (<T>(type: string, payload?: unknown) => Promise<T | null>) | null = null;

/** テスト専用: OPFS proxy を差し替える。 */
export function _setOpfsProxyForTesting(fn: typeof _testProxyOverride): void {
  _testProxyOverride = fn;
}
```

そして `tryOpfsProxy` の冒頭に:

```ts
async function tryOpfsProxy<T>(type: string, payload?: unknown): Promise<T | null> {
  if (_testProxyOverride) return _testProxyOverride<T>(type, payload);
  if (!opfsWorker) return null;
  // ...既存処理...
}
```

- [ ] **Step 5: OPFS init 後に移行を起動**

`_doInit()`（`:256`）の OPFS Worker init 成功分岐を更新:

```ts
    const opfsOk = await initOpfsWorker();
    if (opfsOk) {
      console.log('SQLite: using OPFS Worker (OPFSCoopSyncVFS + FTS5)');
      fts5Available = true; // 新エンジンは FTS5 を含む
      await runOpfsMigrationV2();
      return true;
    }
```

ファイル下部に移行起動ヘルパを追加:

```ts
import { migrateOldOpfsDb } from './opfsMigrationV2.js';

async function runOpfsMigrationV2(): Promise<void> {
  try {
    const result = await migrateOldOpfsDb({
      isMigrationDone: async () => {
        const v = await chrome.storage.local.get(StorageKeys.OPFS_MIGRATION_V2_DONE);
        return v[StorageKeys.OPFS_MIGRATION_V2_DONE] === true;
      },
      setMigrationDone: async () => {
        await chrome.storage.local.set({ [StorageKeys.OPFS_MIGRATION_V2_DONE]: true });
      },
      insertBatch: async (records) => {
        const r = await tryOpfsProxy<{ count: number }>('INSERT_BATCH', records);
        if (r === null) throw new Error('OPFS insertBatch failed during migration');
        return r;
      },
    });
    if (result.migrated > 0) {
      logInfo(`OPFS migration v2: migrated ${result.migrated} records`, { migrated: result.migrated }, 'sqlite');
    }
    if (result.error) {
      logWarn('OPFS migration v2 failed; will retry next init', { error: result.error }, undefined, 'sqlite');
    }
  } catch (err) {
    logWarn('OPFS migration v2 unexpected error', { error: errorMessage(err) }, undefined, 'sqlite');
  }
}
```

> 注: `readOldDbRecords` / `deleteOldDbFile` は Worker 内でのみ動く。`migrateOldOpfsDb` が offscreen から呼ぶと OPFS 直アクセスが offscreen で失敗する可能性がある。**スパイク（Task 1）で「offscreen から `navigator.storage.getDirectory` の read/removeEntry が可能か」も併せて確認すること。** 不可なら移行を Worker 側 `INIT` ハンドラ内へ移す（その場合は `opfsMigrationV2` を worker から呼び、`insertBatch` を worker 内 `handleInsertBatch` に差し替える）。この分岐判断はスパイク結果に従う。

- [ ] **Step 6: テストを実行して成功を確認**

Run: `npm test -- sqliteClient`
Expected: PASS。

- [ ] **Step 7: 全ユニットテストで回帰確認**

Run: `npm test`
Expected: 既存テストが全て PASS（OPFS パスの search が SEARCH に変わったことで壊れるテストがあれば、期待値を rank 付き FTS5 結果へ更新）。

- [ ] **Step 8: 型チェック**

Run: `npm run type-check`
Expected: エラーなし。

- [ ] **Step 9: Commit**

```bash
git add src/offscreen/sqlite.ts src/background/__tests__/sqliteClient.test.ts
git commit -m "feat(sqlite): route OPFS search to FTS5 and trigger v2 migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: E2E 検証（実 FTS5 + 永続化）

**Files:**
- Create: `testDir/e2e/opfs-fts5-search.spec.ts`

- [ ] **Step 1: E2E テストを書く**

`testDir/e2e/opfs-fts5-search.spec.ts`（既存 E2E の拡張ロードパターン・`@extension` タグに合わせる。既存 spec を 1 つ参照して fixture/ヘルパを流用すること）:

```ts
import { test, expect } from './fixtures'; // 既存の拡張ロード fixture に合わせて調整

test('@extension OPFS+FTS5: 記録→検索ヒット→リロード後も検索ヒット', async ({ context, extensionId }) => {
  // 1. dashboard を開く
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);

  // 2. テストレコードを投入（dashboard の既存テスト用 API か、offscreen 経由メッセージで insert）
  //    既存 E2E に record 投入ヘルパがあればそれを使う。無ければ chrome.runtime.sendMessage で
  //    SQLite insert を呼ぶ評価関数を page.evaluate で実行する。
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'SQLITE_INSERT',
      record: { url: 'https://example.com/fts-e2e', title: 'unique_fts_token_xyz', created_at: Date.now() },
    });
  });

  // 3. SQLite status が fts5: true であることを確認
  const status = await page.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: 'SQLITE_STATUS' });
  });
  expect(status.fts5).toBe(true);

  // 4. 検索でヒットすること
  const result = await page.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: 'SQLITE_SEARCH', query: 'unique_fts_token_xyz' });
  });
  expect(result.total).toBeGreaterThanOrEqual(1);

  // 5. リロード後も検索ヒット（OPFS 永続化の確認）
  await page.reload();
  const afterReload = await page.evaluate(async () => {
    return chrome.runtime.sendMessage({ type: 'SQLITE_SEARCH', query: 'unique_fts_token_xyz' });
  });
  expect(afterReload.total).toBeGreaterThanOrEqual(1);
});
```

> 注: `SQLITE_INSERT` / `SQLITE_STATUS` / `SQLITE_SEARCH` の正確なメッセージ型は `src/background/handlers/dashboardSqliteHandlers.ts` を参照して実在のものに合わせること。存在しなければ既存の dashboard 検索 UI を Playwright で操作する方式に切り替える（メモリの Playwright tips 参照: `data-panel` で SQLite history パネルを開く）。

- [ ] **Step 2: E2E を実行**

Run: `npm run test:e2e -- --grep "OPFS\+FTS5"`
Expected: PASS。失敗時は Step 1 のメッセージ型/セレクタを実コードに合わせて修正。

- [ ] **Step 3: Commit**

```bash
git add testDir/e2e/opfs-fts5-search.spec.ts
git commit -m "test(e2e): verify OPFS+FTS5 search persists across reload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 仕上げ（検証ゲート + ドキュメント）

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md`（スパイク結果が未記入なら）

- [ ] **Step 1: 全検証を通す**

Run:
```bash
npm run validate
```
Expected: type-check と全ユニットテストが PASS。

- [ ] **Step 2: E2E を通す**

Run: `npm run test:e2e -- --grep @extension`
Expected: 既存 + 新規 E2E が PASS。

- [ ] **Step 3: ビルドして手動スモーク**

Run: `npm run build`
Expected: 成功。`dist` を Chrome で読み込み、ダッシュボードで「ページ記録 → 検索ヒット → リロード後も検索ヒット」「SQLite status が OPFS / fts5: true」を目視確認。

- [ ] **Step 4: CHANGELOG 更新（バイリンガル）**

`CHANGELOG.md` の最新 unreleased セクションに追記:

```markdown
### Added
- SQLite OPFS 永続化と FTS5 全文検索の両立（`@subframe7536/sqlite-wasm` 導入）/ OPFS persistence and FTS5 full-text search now coexist (via `@subframe7536/sqlite-wasm`)
- 旧 OPFS DB からの自動データ移行 / Automatic data migration from the previous OPFS database
```

> `CLAUDE.local.md` の規約により、`.gitignore` 対象ファイルは CHANGELOG に書かない。

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-06-16-opfs-fts5-coexistence-design.md
git commit -m "docs: record OPFS+FTS5 coexistence in changelog and spec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review チェック結果

- **Spec coverage:** ① エンジン置換=Task 3 / ② FTS5 スキーマ+SEARCH=Task 3 / ③ データ移行=Task 4 / ④ proxy・fts5Available・移行起動=Task 5 / ⑤ 3段フォールバック維持=Task 3(LIKE安全網)+Task 5(IDB/chrome.storage 温存) / ⑥ スパイク先行=Task 1 / ⑦ TDD=Task 2,4,5 / ⑧ E2E=Task 6。spec の全要件にタスクが対応。
- **Placeholder scan:** 「実コードに合わせる」指示は E2E のメッセージ型確認のみで、これは実在コード参照を促す具体指示（プレースホルダではない）。
- **Type consistency:** `createEngine`/`SqliteEngine`/`exec`/`query`/`queryValue`(Task 2) は Task 3 の利用と一致。`migrateOldOpfsDb`/`MigrationDeps`/`readOldDbRecords`/`deleteOldDbFile`(Task 4) は Task 5 の利用と一致。`SearchResultRecord.rank`(Task 3) は Task 5/6 の `rank` 参照と一致。`OPFS_MIGRATION_V2_DONE`(Task 4) は Task 5 で使用。
- **重要リスク:** offscreen から OPFS 直アクセスの可否が移行配置を左右する（Task 5 Step 5 注記）。Task 1 スパイクで確定する設計とした。
