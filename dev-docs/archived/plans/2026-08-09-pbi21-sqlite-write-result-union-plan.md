# PBI-21: SQLite 変更系の Result union 化と lastError 廃止 実装計画

> **Source PBI:** `pbi/2026-08-09-21-refactor-sqlite-write-result-union.md`（フェーズ0調査済み・2026-08-09）
> **前提PBI:** 2026-08-09-19（読み取り系の `CallResult` 化）完了済み — **本計画の手本**

**Goal:** SQLite 変更系メソッドを `CallResult` 化し、
共有可変状態 `lastError` を完全に削除する。あわせて変更系失敗時の
「画面が無反応になる」問題を解消する。

**Tech Stack:** TypeScript (nodeNext ESM), Vitest

**所要目安:** 3pt

---

## この計画の位置づけ

**PBI-19 と同じことを、変更系に対して行うだけ。** 新規設計は不要。

```bash
# 手本になるコミットを必ず先に読むこと
git show f692cc9   # sqliteClient に CallResult を導入
git show f592144   # handler を lastError から切り離す
git show 7b9aa0e   # テスト
```

**PBI-19 との違いは1点だけ**: 今回は `lastError` を**削除しきる**のがゴール。
PBI-19 は「読み取り系だけ移して `lastError` は残す」だった。

---

## 対象の全体像（実測値）

### `deps.lastError()` を読む9箇所（`dashboardSqliteHandlers.ts`）

| 行 | subtype | 対応する SqliteClient メソッド |
|---|---|---|
| 131 | `toggle_star` | `toggleStar()` |
| 138 | `delete` | `delete()` |
| 150 | `update` | `update()` |
| 164 | `clear_all` | `clearAll()` |
| 205 | `import` | `insert()`（ループ内） |
| 230 | `status` | `getStatus()` |
| 237 | `opfs_spike` | `runOpfsSpike()` |
| 301 | `purge_now` | `purgeOldRecords()` |
| 329 | `content_purge_now` | `purgeContent()` |

### `sqliteClient.lastError` を直接読む2箇所

- `src/background/reviewSummaryGenerator.ts:191`（週次）
- `src/background/reviewSummaryGenerator.ts:260`（月次）

**この11箇所を全て潰さないと `lastError` は削除できない。**

---

## Step 0: 現状確認（実装ではない・必須）

- [ ] 全読み手を自分の目で確認する

```bash
cd /Users/yaar/Playground/obsidian-smart-history
grep -rn "lastError" src --include='*.ts' | grep -v '__tests__' | grep -v "chrome.runtime.lastError"
```

- [ ] `src/background/sqliteClient.ts:109-160` を通読（`lastErrorDetail` の定義とコメント）
- [ ] `src/background/sqliteClient.ts:258-283` の `call()` を読む
      → **失敗時に `CallResult` を返している**ことを確認。情報は既にある
- [ ] 変更系メソッド（349-402行, 432-485行）が
      `return result.success;` で情報を捨てていることを確認

---

## Step 1: 実害を再現するテストを書く（Red）

**目的:** 「削除失敗時に画面が無反応」を先に固定する。

- [ ] `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-writeError.test.ts` を新規作成

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 既存の sibling テストの流儀に合わせる（下記「落とし穴」参照）
// src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-pagination.test.ts を先に読むこと

describe('変更系の失敗が利用者に伝わる', () => {
  it('削除に失敗したらエラーが表示される', async () => {
    // deleteLog が失敗を返すようモックする
    // handleDelete 相当を実行する
    // state.error に相当する #sqlite-error が表示されることを検証
  });

  it('スター付けに失敗したらエラーが表示される', async () => {
    // 同上
  });
});
```

- [ ] **先に既存テストの書き方を読む**（モックの流儀を合わせるため）

```bash
sed -n '1,60p' src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-pagination.test.ts
```

- [ ] テストを実行 → **失敗することを確認**（現状はエラー表示のコードが無い）

---

## Step 2: `SqliteClient` の変更系を `CallResult` 化

- [ ] `src/background/sqliteClient.ts` に `*Result` メソッドを追加する

**PBI-19 と同じパターン**（既存メソッドは残し、その上に `*Result` を作る）:

```typescript
async deleteResult(id: number): Promise<CallResult<void>> {
    return this.call('SQLITE_DELETE', { id });
}

async delete(id: number): Promise<boolean> {
    const result = await this.deleteResult(id);
    return result.success;
}
```

- [ ] 以下のメソッドに `*Result` を追加する

| 追加するメソッド | 元 |
|---|---|
| `deleteResult` | `delete` |
| `updateResult` | `update` |
| `toggleStarResult` | `toggleStar` |
| `clearAllResult` | `clearAll` |
| `insertResult` | `insert` |
| `restoreDbResult` | `restoreDb` |
| `purgeOldRecordsResult` | `purgeOldRecords` |
| `purgeContentResult` | `purgeContent` |
| `runOpfsSpikeResult` | `runOpfsSpike` |

- [ ] **`getStatus` は変更しない**（PBI本文「落とし穴」参照）。
      ただし内部で `call()` の `CallResult` を保持し、
      失敗時の `initError` に `result.error.message` を使う形は既にそうなっている（418-429行）

- [ ] `npm run type-check`
- [ ] **コミット**: `refactor(sqlite): 変更系メソッドに CallResult 版を追加する`

---

## Step 3: ハンドラを `lastError` から切り離す（8箇所）

- [ ] `src/background/handlers/dashboardSqliteHandlers.ts` の `DepsResult` を変更系にも使う

```typescript
export interface DashboardSqliteHandlerDeps {
  // 変更前: delete: (id: number) => Promise<boolean>;
  delete: (id: number) => Promise<DepsResult<void>>;
  update: (id: number, changes: Record<string, unknown>) => Promise<DepsResult<void>>;
  toggleStar: (id: number) => Promise<DepsResult<{ is_starred: number }>>;
  clearAll: () => Promise<DepsResult<void>>;
  insert: (record: Record<string, unknown>) => Promise<DepsResult<{ id: number }>>;
  purgeOldRecords: (days?: number, max?: number) => Promise<DepsResult<{ purged: number }>>;
  purgeContent: (...) => Promise<DepsResult<{ purged: number }>>;
  runOpfsSpike: () => Promise<DepsResult<Record<string, unknown>>>;
  // lastError は最後に削除する（Step 5）
}
```

- [ ] 各分岐を書き換える。**パターンは読み取り系と同一**:

```typescript
case 'delete': {
  const result = await deps.delete(payload.id);
  if (!result.success) {
    return { success: false, error: result.error.message, retriable: result.error.retriable };
  }
  return { success: true };
}
```

- [ ] **`import` ケース（168-210行）は特別扱い**。ループ内で局所変数に保持する

```typescript
let lastInsertError: SqliteError | null = null;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  for (const row of batch) {
    try {
      const result = await deps.insert({ /* ...既存のフィールド写像... */ });
      if (result.success) inserted++;
      else { skipped++; lastInsertError = result.error; }
    } catch { skipped++; }
  }
}
// 共有状態を使わずに同じ判定ができる（かつ正確になる）
if (lastInsertError && inserted === 0) {
  return { success: false, error: lastInsertError.message };
}
return { success: true, inserted, skipped, total: rows.length };
```

- [ ] `createSqliteClientDeps()`（391-422行）の配線を `*Result` に差し替える

```typescript
delete: (id) => sqliteClient.deleteResult(id),
update: (id, changes) => sqliteClient.updateResult(id, changes),
toggleStar: (id) => sqliteClient.toggleStarResult(id),
// ...
```

- [ ] `npm run type-check`
- [ ] `npx vitest run src/background/handlers src/background/__tests__/dashboardSqliteHandlers.test.ts`
- [ ] **コミット**: `refactor(background): 変更系ハンドラを共有可変lastErrorから切り離す`

---

## Step 4: 診断ログ2箇所を戻り値経由にする

- [ ] `src/background/reviewSummaryGenerator.ts:191, 260` を修正

```typescript
// Before
const result = await sqliteClient.query({...});
if (!result) {
  addLog(LogType.ERROR, 'Failed to query entries for weekly summary',
         { weekKey, error: sqliteClient.lastError });
}

// After
const result = await sqliteClient.queryResult({...});
if (!result.success) {
  addLog(LogType.ERROR, 'Failed to query entries for weekly summary',
         { weekKey, error: result.error.message });
}
```

- [ ] **注意**: `queryResult` は PBI-19 で既に存在する。新規追加は不要
- [ ] `npm run validate`
- [ ] **コミット**

---

## Step 5: `lastError` を削除する

**ここまでで全読み手が消えているはず。** 消えていなければ型エラーで分かる。

- [ ] `DashboardSqliteHandlerDeps` から `lastError: () => string | null;` を削除
- [ ] `createSqliteClientDeps()` から `lastError: () => sqliteClient.lastError ?? null,` を削除
- [ ] `src/background/sqliteClient.ts` から以下を削除
  - `lastErrorDetail: SqliteError | null = null;`（132行）
  - `get lastError()`（134-137行）
  - `call()` 内の `this.lastErrorDetail = ...` 代入3箇所（270, 274, 280行）

```typescript
// call() の after
private async call<T>(...): Promise<CallResult<T>> {
  try {
    const res = await this.msgOffscreen(type, payload, traceId);
    if (!res?.success) {
      const msg = String(res?.error || `${type} failed`);
      recordSqliteFailure(type, msg);
      logError(...);
      return { success: false, error: categorizeError(msg) };  // 代入をやめる
    }
    recordSqliteSuccess();
    return { success: true, data: transform ? transform(res) : (res as unknown as T) };
  } catch (error) {
    const msg = errorMessage(error);
    recordSqliteFailure(type, msg);
    logError(...);
    return { success: false, error: categorizeError(msg) };
  }
}
```

- [ ] `npm run type-check` → **残った読み手があれば全てここで判明する**
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(sqlite): 共有可変状態 lastError を削除する`

---

## Step 6: UI にエラー表示を追加（Step 1 を Green に）

- [ ] `src/dashboard/dashboardSqliteService.ts` の変更系を Result 化

```typescript
export async function deleteLog(id: number): Promise<{ ok: true } | { error: string }> {
  try {
    const response = await sendDashboardMessage({ subtype: 'delete', id }, { requireConfirmToken: true });
    if (response.success) return { ok: true };
    return { error: String(response.error || 'Delete failed') };
  } catch (error) {
    console.error('deleteLog failed:', error);
    return { error: errorMessage(error) };
  }
}
```

- [ ] `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` の
      `handleDelete` / `handleToggleStar` に失敗分岐を足す

```typescript
async function handleDelete(id: number): Promise<void> {
  const confirmed = await showConfirmDialog({...});
  if (!confirmed) return;

  const result = await deleteLog(id);
  if ('error' in result) {
    state.error = result.error;   // 610行/928行で描画される既存の仕組みに乗る
    refresh();
    return;
  }
  state.entries = state.entries.filter(e => e.id !== id);
  state.total = Math.max(0, state.total - 1);
  state.selectedIds.delete(id);
  state.error = null;
  refresh();
}
```

- [ ] **`state.error` の描画は既存の仕組みがある**（確認済み）
  - `sqliteHistoryPanel.ts:610-611` — `errorEl.textContent` / `display` 制御
  - `sqliteHistoryPanel.ts:928-929` — `#sqlite-error` 要素の初期描画

- [ ] Step 1 のテストを実行 → **通ること**を確認（Green）
- [ ] `npm run validate`
- [ ] **コミット**: `fix(dashboard): 削除・スター操作の失敗が無反応になる問題を修正`

---

## Step 7: 並行性テストの追加と仕上げ

- [ ] 「別操作のエラーを読まない」ことを固定するテストを追加

```typescript
it('並行実行しても各呼び出しが自分のエラーを受け取る', async () => {
  // op A は quota エラー、op B は timeout エラーを返すようモック
  // 両者を Promise.all で走らせる
  // A の結果が quota、B の結果が timeout であることを検証
  // （lastError 方式では両方が「最後に書かれた方」になっていた）
});
```

- [ ] テストハーネスの追随

```bash
# PBI-19 で追加したアダプタに変更系を足す必要があるか確認
grep -n "RESULT_METHOD_SOURCES" src/background/handlers/__tests__/dashboardSqliteTestHarness.ts
```

`RESULT_METHOD_SOURCES` に `['deleteResult', 'delete', 'Delete failed']` 等の行を追加する。
**PBI-19 の実装コメント（呼び出し時解決・その場で拡張）を必ず読むこと。**

- [ ] `npm run validate`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] CHANGELOG.md に記載

---

## 完了確認チェックリスト

- [ ] `grep -rn "lastError" src --include='*.ts' | grep -v '__tests__' | grep -v "chrome.runtime.lastError"` が
      SqliteClient 関連で**0件**（`offlineNetworkQueue` / `persistentRetryQueue` / `retryHelper` /
      `fetch.ts` / `trustDb` / `optimisticLock` / `retry.ts` の `lastError` は**別物**なので残ってよい）
- [ ] 削除失敗時に `#sqlite-error` が表示される
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` すべて成功

---

## 困ったときの判断基準

| 状況 | 判断 |
|---|---|
| `getStatus` も Result 化すべきか | **しない。** 失敗時の `initError` 表示が消える（PBI-19 で判断済み） |
| `getLogCount` はどうか | **触らない。** 唯一の呼び出し元が `-1` を正しく扱っている（PBI-19 で判断済み） |
| 大量のテストが落ちた | **テストハーネスのアダプタ**を先に直す。個別テスト修正は最後の手段（PBI-19 で23件落ちた前例） |
| 変更系の UI 表示先が無いパネルがある | `state.error` 相当が無ければ、まず既存のエラー表示方法を調べる。無ければシニアに相談 |
| `lastError` を消したら型エラーが大量に出た | **正常。** それが全読み手のリスト。1つずつ潰す |
