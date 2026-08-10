# PBI-23: SQLite トランスポート層の段階的削減 実装計画

> **Source PBI:** `pbi/2026-08-09-23-refactor-sqlite-transport-layers.md`（フェーズ0調査済み・2026-08-09）
> **前提PBI:** 2026-08-09-21（変更系 Result 化）を**先に完了させること**

**Goal:** SQLite 操作のトランスポート層（約1,400行・6ファイル）から
機械的な重複を削減する。**全部を機械化するのではなく、機械化してよい部分だけを対象とする。**

**Tech Stack:** TypeScript (nodeNext ESM), Vitest

**所要目安:** 8pt（Epic）= Phase 1: 2pt + Phase 2: 3pt + Phase 3: 3pt

---

## ⚠️ 着手前の必須事項

- [ ] **シニアと設計を相談する**（Epic規模かつセキュリティ経路に触れるため）
- [ ] **PBI-21 が完了していることを確認する**

```bash
grep -n "lastError" src/background/sqliteClient.ts
# → 出力が無ければ PBI-21 完了済み。あれば先に PBI-21 を実施すること
```

- [ ] **Phase 1 だけでも価値がある。** 時間が取れなければ Phase 1 で止めてよい

---

## この計画の最重要原則

### 「同型に見えるが機械化してはいけない」case がある

ハンドラの22 case のうち、**7件は実際の業務ロジックを持っている。**
これらを表に押し込むと**セキュリティ検証や上限チェックが消える。**

| subtype | 機械化 | 中身 |
|---|---|---|
| `query` `search` `get_count` `audit_log_query` | ✅ | 転送のみ |
| `delete` `toggle_star` `clear_all` `status` `opfs_spike` `backup_db` `confirm_token` `migrate` `backfill_metadata` `cleanup_legacy` | ✅ | 転送のみ |
| `update` | ⚠️ | `ALLOWED_UPDATE_FIELDS` 検証 |
| `import` | ❌ | `MAX_IMPORT_ROWS`、バッチ、エラー集約 |
| `restore_db` | ❌ | 150MB 上限、base64 |
| `append_to_obsidian` | ❌ | 3段検証 + APIキー + Obsidian |
| `purge_now` `content_purge_now` | ❌ | 設定読み出しと分岐 |

**「転送のみ」だけを対象にする。残りは手書きのまま残す。**

---

## Phase 1: メッセージ型の二重化を解消（2pt・単独マージ可）

**最も安全で、最も分かりやすい重複。ここだけでも実施する価値がある。**

### Step 1-0: 現状確認

- [ ] `src/messaging/sqliteMessages.ts` を全部読む（64行）
- [ ] 型 union 20件と `SQLITE_MESSAGE_TYPES` 配列20件が**同じ内容**であることを確認

```bash
cat src/messaging/sqliteMessages.ts
```

### Step 1-1: 二重化を検出するテストを書く（Red）

- [ ] `src/messaging/__tests__/sqliteMessages.test.ts` に追記
      （**既存ファイルがある。先に読むこと**）

```typescript
it('SQLITE_MESSAGE_TYPES が SqliteMessage の全 type を網羅する', () => {
  // 型からは実行時に値を取れないため、union 側を配列から導出する方向に変える。
  // このテストは「配列に無い type が union に居ない」ことを型で保証したうえで、
  // 件数が期待どおりであることを固定する。
  expect(SQLITE_MESSAGE_TYPES).toHaveLength(20);
  expect(new Set(SQLITE_MESSAGE_TYPES).size).toBe(SQLITE_MESSAGE_TYPES.length);
});
```

### Step 1-2: 配列を単一ソースにし、型を導出する

- [ ] `sqliteMessages.ts` を書き換える

```typescript
/**
 * The message types, as values.
 *
 * This array is the single source: `SqliteMessageType` is derived from it.
 * The reverse (deriving the array from the union) is impossible — types are
 * erased at runtime — and the array is needed for the sender check in
 * offscreen.ts, so the array has to be the thing that is written by hand.
 */
export const SQLITE_MESSAGE_TYPES = [
  'SQLITE_HEALTH_CHECK',
  'SQLITE_INIT',
  // ...20件（既存の配列をそのまま）...
] as const;

export type SqliteMessageType = typeof SQLITE_MESSAGE_TYPES[number];

// payload の形は type ごとに違うので union は残す。
// ただし type 名は SqliteMessageType から取るため、綴りの二重化は消える。
export type SqliteMessage =
  | { type: 'SQLITE_HEALTH_CHECK'; payload?: never; traceId?: string }
  // ...（payload の形は手書きのまま）...
```

- [ ] **型レベルで網羅を保証する仕掛けを足す**（綴りミス・追加漏れの検出）

```typescript
// Fails to compile if SqliteMessage misses a type present in the array,
// or names one that is not in it.
type _AllTypesCovered = SqliteMessage['type'] extends SqliteMessageType
  ? SqliteMessageType extends SqliteMessage['type'] ? true : never
  : never;
const _assertAllTypesCovered: _AllTypesCovered = true;
```

- [ ] `npm run type-check`
- [ ] `npx vitest run src/messaging`
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(messaging): SQLiteメッセージ型の一覧を配列から導出する`

### Step 1-3: exhaustiveness check が生きているか確認

- [ ] `src/offscreen/offscreen.ts:337-343` の `const _exhaustive: never = msg;` が残っていること
- [ ] **わざと壊して確認する**（重要）: 配列に架空の型 `'SQLITE_FOO'` を一時的に足し、
      `npm run type-check` が**失敗する**ことを確認 → 確認後に戻す

**ここで Phase 1 完了。単独でマージしてよい。**

---

## Phase 2: dashboard 側の失敗表現を統一（3pt）

**前提: PBI-21 完了済み。**

### Step 2-0: 影響範囲を測る

- [ ] 呼び出し側の数を数える

```bash
grep -rn "deleteLog\|updateLog\|clearAllLogs\|toggleStar\|importLogs\|restoreDb\|migrateLogs\|runOpfsSpike\|cleanupLegacyStorage\|backfillMetadata\|appendToLogs" src --include='*.ts' | grep -v '__tests__' | grep -v "export async function"
```

- [ ] 出力を**リストとして手元に保存する**。これが Step 2-2 の作業リストになる

### Step 2-1: 共通の Result 型を定義

- [ ] `src/dashboard/dashboardSqliteService.ts` に追加

```typescript
/**
 * The uniform failure shape for this module.
 *
 * Before this, the same "it failed" was expressed as `null` (11 functions),
 * `false` (5), `-1` (1) and `{error}` (4) depending on which function you
 * happened to call, so every call site had to remember a different idiom.
 */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

- [ ] **`getLogCount` の `-1` と `getSqliteStatus` は対象外**
      （PBI-19 で判断済み。同じ理由で据え置く）

### Step 2-2: 関数を1つずつ移行する

**一括でやらない。1関数ごとにコミットする。**

- [ ] 移行順（依存の少ない順）:
  1. `clearAllLogs`（呼び出し元が少ない）
  2. `restoreDb`
  3. `deleteLog`
  4. `updateLog`
  5. `toggleStar`
  6. `migrateLogs` / `runOpfsSpike` / `cleanupLegacyStorage` / `backfillMetadata`
  7. `importLogs` / `appendToLogs`

各関数について:
- [ ] 関数本体を `ServiceResult` を返す形に変更
- [ ] Step 2-0 のリストから、その関数の呼び出し元をすべて修正
- [ ] `npm run validate`
- [ ] コミット

```typescript
// 移行後の形（全関数で統一）
export async function clearAllLogs(): Promise<ServiceResult<void>> {
  try {
    const response = await sendDashboardMessage({ subtype: 'clear_all' }, { requireConfirmToken: true });
    if (response.success) return { ok: true, data: undefined };
    return { ok: false, error: String(response.error || 'Clear all failed') };
  } catch (error) {
    console.error('clearAllLogs failed:', errorMessage(error));
    return { ok: false, error: errorMessage(error) };
  }
}
```

- [ ] **落とし穴**: 呼び出し元が `if (await deleteLog(id))` のような
      真偽値前提で書かれている。`ServiceResult` は常に truthy なので
      **修正漏れがあると「常に成功」になる。** 型エラーで気づけるよう、
      戻り値の型を明示すること（`Promise<boolean>` からの変更なので型エラーになるはず）

### Step 2-3: 送信ヘルパの共通化（任意）

17関数の try/catch が同型なので、ヘルパに寄せられる。

```typescript
async function call<T>(
  payload: DashboardSqliteRequest,
  options: { requireConfirmToken?: boolean; map?: (res: never) => T; fallbackError: string },
): Promise<ServiceResult<T>> { /* ... */ }
```

- [ ] **無理に共通化しない。** 各関数の response マッピングが微妙に違うため、
      共通化して可読性が落ちるならやらない方がよい
- [ ] `npm run validate`

**ここで Phase 2 完了。**

---

## Phase 3: 操作の宣言表（3pt・要シニア相談）

**最もリスクが高い。confirmToken のセキュリティ経路に触れる。**

### Step 3-0: セキュリティテストを先に固める

- [ ] 既存のセキュリティテストを確認する

```bash
grep -rln "confirmToken" src --include='*.test.ts'
# → 4ファイル。これらは絶対に壊さない
```

- [ ] **全 destructive 操作について「token 無しで拒否される」テストが存在するか確認する。**
      不足していれば**先に追加する**（リファクタリング前に守りを固める）

```typescript
it.each([
  'toggle_star', 'update', 'delete', 'migrate', 'backfill_metadata',
  'cleanup_legacy', 'clear_all', 'import', 'restore_db', 'backup_db',
])('%s は confirmToken 無しで拒否される', async (subtype) => {
  const result = await handler({ subtype } as never);
  expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
});
```

- [ ] このテストが**現状で通る**ことを確認してから次へ

### Step 3-1: 宣言表を作る（トークン要否を必須プロパティに）

- [ ] `src/background/handlers/dashboardSqliteOperations.ts` を新規作成

```typescript
/**
 * Per-operation declarations.
 *
 * `requiresToken` is REQUIRED, not optional: a forgotten entry must not
 * silently mean "no token needed" for a destructive operation.
 */
export interface SqliteOperationSpec {
    subtype: DashboardSqliteSubtype;
    requiresToken: boolean;   // ← optional にしないこと
    modalRequired: boolean;
}

export const SQLITE_OPERATIONS: readonly SqliteOperationSpec[] = [
    { subtype: 'query',            requiresToken: false, modalRequired: false },
    { subtype: 'delete',           requiresToken: true,  modalRequired: true  },
    // ...22件すべて...
];
```

- [ ] `TOKEN_REQUIRED_SUBTYPES` / `MODAL_REQUIRED_SUBTYPES` を導出に置き換える

```typescript
export const TOKEN_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> =
    new Set(SQLITE_OPERATIONS.filter(o => o.requiresToken).map(o => o.subtype));
```

- [ ] **網羅性を型で保証する**

```typescript
// Fails to compile if an operation is missing from the table.
type _AllOperationsDeclared =
  DashboardSqliteSubtype extends typeof SQLITE_OPERATIONS[number]['subtype'] ? true : never;
```

- [ ] Step 3-0 のセキュリティテストを実行 → **全て通ること**
- [ ] `npm run validate`
- [ ] **コミット**

### Step 3-2: 「転送のみ」の case を表から生成（慎重に）

- [ ] **機械化してよい case だけ**を対象にする（本計画冒頭の表を参照）
- [ ] 業務ロジックを持つ7件（`import` / `restore_db` / `append_to_obsidian` /
      `purge_now` / `content_purge_now` / `update`）は**手書きのまま残す**

- [ ] **1グループずつ移行し、その都度 `npm run validate`**
- [ ] `npm run test:e2e`

---

## 完了確認チェックリスト

### Phase 1
- [ ] `SQLITE_MESSAGE_TYPES` が `as const` で、型がそこから導出されている
- [ ] `offscreen.ts` の exhaustiveness check が生きている（わざと壊して確認済み）

### Phase 2
- [ ] `dashboardSqliteService.ts` の失敗表現が `ServiceResult` に統一（`getLogCount`/`getSqliteStatus` を除く）
- [ ] 呼び出し元すべてが追随している

### Phase 3
- [ ] `requiresToken` が必須プロパティである
- [ ] destructive 操作10件のトークン拒否テストが通る
- [ ] 業務ロジックを持つ7 case が手書きのまま残っている

### 共通
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` すべて成功

---

## 困ったときの判断基準

| 状況 | 判断 |
|---|---|
| 全部の case を表に入れたくなった | **入れない。** 業務ロジックを持つ7件は手書きが正しい |
| `requiresToken` を optional にしたくなった | **絶対にしない。** 書き忘れがセキュリティホールになる |
| 39テストが大量に落ちた | 一括変更している証拠。Phase / グループ単位に戻す |
| Phase 3 が終わらない | **Phase 1・2 だけでマージしてよい。** Phase 3 は別PBIに切り出す |
| 共通化してコードが読みにくくなった | **戻す。** 本PBIの目的は可読性であり、行数削減ではない |
| セキュリティテストが落ちた | **即座に手を止めてシニアに相談する。** 自己判断で通さない |
