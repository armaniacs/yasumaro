# applyMetadataPatch実行時ガード 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `applyMetadataPatch`が`url`/`timestamp`キーを実行時にも無視するようにし、将来型キャスト経由でこれらのフィールドを含むオブジェクトが渡された場合でもエントリの識別子・作成時刻が上書きされないようにする。

**Architecture:** `src/utils/storage/savedUrlStore.ts`の`applyMetadataPatch`関数内、`Object.entries(patch)`ループに`url`/`timestamp`キーの明示的なスキップを追加する。あわせてコードコメントで「なぜこのガードが必要か」を補足する。

**Tech Stack:** TypeScript, Vitest（`environment: 'node'`, `globals: true`）

---

## 事前に必ず読むこと

1. **テストランナーはVitestです。**
2. **`applyMetadataPatch`は現在`export`されていない内部関数です。** テストは`saveSavedUrlEntryMetadata`（`export`されているpublic関数）経由で行います。
3. **TypeScriptの型システムは「コンパイル時のみ」有効です。** `patch as unknown as SavedUrlEntryMetadataPatch`のような二重キャストを使うと、`url`/`timestamp`を含むオブジェクトでも型チェックをすり抜けて渡せてしまいます。今回のテストは、まさにこの「型チェックをすり抜けた場合」を意図的に再現します。

---

## Task 1: 既存コードとテストパターンを確認する

**Files:**
- Read（変更しない）: `src/utils/storage/savedUrlStore.ts:1-410`
- Read（変更しない）: `src/utils/storage/__tests__/savedUrlStore.test.ts`

- [ ] **Step 1: `applyMetadataPatch`の現在の実装を確認する**

```bash
sed -n '371,407p' src/utils/storage/savedUrlStore.ts
```

以下の内容が表示されます:

```typescript
/**
 * Merge a metadata patch into an entry. `undefined` values are skipped
 * (they mean "no update"); explicit empty values follow the storage rules
 * of the type (empty tags are stored as undefined).
 */
function applyMetadataPatch(
    current: SavedUrlEntry,
    patch: SavedUrlEntryMetadataPatch,
    mergeTags: boolean
): SavedUrlEntry {
    const result: SavedUrlEntry = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === 'tags') {
            if (mergeTags) {
                const existing = current.tags || [];
                const seen = new Set(existing);
                const merged = [...existing];
                for (const tag of value as string[]) {
                    if (!seen.has(tag)) {
                        seen.add(tag);
                        merged.push(tag);
                    }
                }
                if (merged.length > 0) result.tags = merged;
                else delete result.tags;
            } else {
                // Empty tag lists are stored as absent (existing convention).
                if ((value as string[]).length > 0) result.tags = value as string[];
                else delete result.tags;
            }
        } else {
            (result as unknown as Record<string, unknown>)[key] = value;
        }
    }
    return result;
}
```

**問題点**: 最後の`else`ブロック（`(result as unknown as Record<string, unknown>)[key] = value;`）は、`key`が何であっても無条件に書き込みます。`SavedUrlEntryMetadataPatch`型は`url`/`timestamp`を`Omit`で除外していますが、これは型チェックの話であり、実行時にはこのガードが効きません。

- [ ] **Step 2: `SavedUrlEntryMetadataPatch`型定義を確認する**

```bash
sed -n '17,27p' src/utils/storage/savedUrlStore.ts
```

以下の内容が表示されます:

```typescript
/**
 * Metadata-only subset of a SavedUrlEntry. `url` and `timestamp` are owned by
 * the module and never appear in a patch. A key present with `undefined` means
 * "do not update"; fields that need an explicit empty value follow the storage
 * rules of the type (e.g. `tags: []` clears tags).
 *
 * Note: the legacy save path used to write a `title` field that was never part
 * of SavedUrlEntry and never read anywhere (see migrationService's
 * mapLegacyEntryToRecord). This contract intentionally excludes it.
 */
export type SavedUrlEntryMetadataPatch = Partial<Omit<SavedUrlEntry, 'url' | 'timestamp'>>;
```

**確認したこと**: 型定義自体には既に「なぜurl/timestampを除外するか」というコメント（"are owned by the module and never appear in a patch"）がありますが、`applyMetadataPatch`の実装側にはこの制約を実行時に強制するコードがありません。

- [ ] **Step 3: 既存テストの`seedEntry`/`readEntry`ヘルパーを確認する**

```bash
sed -n '64,83p' src/utils/storage/__tests__/savedUrlStore.test.ts
```

以下の内容が表示されます:

```typescript
describe('saveSavedUrlEntryMetadata', () => {
    beforeEach(async () => {
        const keys = Object.keys(await chrome.storage.local.get(null));
        if (keys.length > 0) {
            await chrome.storage.local.remove(keys);
        }
        vi.clearAllMocks();
    });

    async function seedEntry(entry: { url: string; timestamp: number; tags?: string[] }) {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [entry] });
    }

    async function readEntry(url: string) {
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        return (stored.savedUrlsWithTimestamps as Array<{ url: string; timestamp: number; [key: string]: unknown }>).find(
            (e) => e.url === url
        );
    }
```

**このヘルパーを使う理由**: `seedEntry`で既存エントリを用意し、`saveSavedUrlEntryMetadata`を呼んだ後`readEntry`で結果を確認する、という既存のテストパターンをそのまま使います。今回追加するテストもこのファイルの同じ`describe`ブロック内に追加します。

（このタスクは調査のみです。コミット不要です。）

---

## Task 2: 失敗するテストを書く

**Files:**
- Modify: `src/utils/storage/__tests__/savedUrlStore.test.ts`

- [ ] **Step 1: 型キャストでurl/timestampを渡すテストケースを追加する**

`src/utils/storage/__tests__/savedUrlStore.test.ts`の`describe('saveSavedUrlEntryMetadata', ...)`ブロック内、既存の最後のテスト（`'keeps the existing timestamp when refreshTimestamp is false'`、147-155行目）の直後、ブロックを閉じる`});`の前に以下を追加してください。

```typescript
    it('ignores a url key smuggled into the patch via a type cast', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000 });

        // 型システムをすり抜けて url を含む patch を渡す状況をわざと再現する。
        // 通常のTypeScriptコードではこのような patch は型エラーになるが、
        // 将来 as キャストを経由する呼び出し元が追加された場合の防御を
        // 検証するためのテスト。
        const maliciousPatch = { url: 'https://attacker.example.com', recordType: 'auto' } as unknown as Parameters<typeof saveSavedUrlEntryMetadata>[1];

        await saveSavedUrlEntryMetadata('https://example.com', maliciousPatch);

        const entry = await readEntry('https://example.com');
        expect(entry?.url).toBe('https://example.com');
        expect(entry?.recordType).toBe('auto');
    });

    it('ignores a timestamp key smuggled into the patch via a type cast', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000 });

        const maliciousPatch = { timestamp: 9999999, recordType: 'auto' } as unknown as Parameters<typeof saveSavedUrlEntryMetadata>[1];

        await saveSavedUrlEntryMetadata('https://example.com', maliciousPatch, { refreshTimestamp: false });

        const entry = await readEntry('https://example.com');
        // refreshTimestamp: false のため、通常のタイムスタンプ更新も発生しない。
        // patch経由のtimestamp（9999999）も無視されるべきなので、元の1000のまま。
        expect(entry?.timestamp).toBe(1000);
        expect(entry?.recordType).toBe('auto');
    });
```

**なぜ`Parameters<typeof saveSavedUrlEntryMetadata>[1]`という型を使うか**: `saveSavedUrlEntryMetadata`の2番目の引数の型（`SavedUrlEntryMetadataPatch`）を直接importして使うこともできますが、ここでは意図的に「本来許可されていない形のオブジェクトを、関数のシグネチャに強制的に合わせてキャストする」状況を再現しています。`as unknown as X`という二重キャストは、TypeScriptの型チェックを完全に無視する書き方です。

**なぜ2つ目のテストで`refreshTimestamp: false`を指定するか**: `refreshTimestamp`のデフォルトは`true`で、その場合`saveSavedUrlEntryMetadata`自体が`timestamp: timestamp ?? Date.now()`で現在時刻に更新します（`savedUrlStore.ts:364-366`）。これだと「patchのtimestampが無視されたのか、それとも単にrefreshTimestampの通常の動作で上書きされただけなのか」が区別できません。`refreshTimestamp: false`にすることで、「patch経由のtimestampが本当に無視されているか」だけを正確に検証できます。

- [ ] **Step 2: テストを実行し、失敗することを確認する**

```bash
npx vitest run src/utils/storage/__tests__/savedUrlStore.test.ts
```

**期待される結果**: 新しく追加した2つのテストが失敗する。1つ目は`entry?.url`が`'https://attacker.example.com'`になってしまっている（`toBe('https://example.com')`と一致しない）。2つ目は`entry?.timestamp`が`9999999`になってしまっている（`toBe(1000)`と一致しない）。

- [ ] **Step 3: コミットする**

```bash
git add src/utils/storage/__tests__/savedUrlStore.test.ts
git commit -m "test(saved-url-store): add failing test for url/timestamp smuggled via type cast"
```

---

## Task 3: 実行時ガードを実装する

**Files:**
- Modify: `src/utils/storage/savedUrlStore.ts`

- [ ] **Step 1: `applyMetadataPatch`にガードを追加する**

`src/utils/storage/savedUrlStore.ts`の`applyMetadataPatch`関数を以下のように書き換えてください。

変更前:

```typescript
/**
 * Merge a metadata patch into an entry. `undefined` values are skipped
 * (they mean "no update"); explicit empty values follow the storage rules
 * of the type (empty tags are stored as undefined).
 */
function applyMetadataPatch(
    current: SavedUrlEntry,
    patch: SavedUrlEntryMetadataPatch,
    mergeTags: boolean
): SavedUrlEntry {
    const result: SavedUrlEntry = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === 'tags') {
```

変更後:

```typescript
/**
 * Merge a metadata patch into an entry. `undefined` values are skipped
 * (they mean "no update"); explicit empty values follow the storage rules
 * of the type (empty tags are stored as undefined).
 *
 * `url`/`timestamp` are skipped even though SavedUrlEntryMetadataPatch's
 * Omit<...> type already excludes them: the Omit is a compile-time-only
 * contract. A future caller that passes external data through an `as`
 * cast (e.g. an import/restore feature) could bypass it, so this function
 * — the last line of defense before storage — enforces it at runtime too.
 */
function applyMetadataPatch(
    current: SavedUrlEntry,
    patch: SavedUrlEntryMetadataPatch,
    mergeTags: boolean
): SavedUrlEntry {
    const result: SavedUrlEntry = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === 'url' || key === 'timestamp') continue;
        if (key === 'tags') {
```

**このステップで何をしたか**: `Object.entries(patch)`ループの中、`undefined`チェックの直後に`key === 'url' || key === 'timestamp'`のスキップを追加しました。これにより、`patch`にどうやって`url`/`timestamp`キーが紛れ込んでも、結果には反映されなくなります。あわせて関数のコメントに「なぜこのガードが必要か」を追記しました。

- [ ] **Step 2: `saveSavedUrlEntryMetadata`の新規作成パスにもコメントを追加する**

`src/utils/storage/savedUrlStore.ts`の`saveSavedUrlEntryMetadata`関数を確認してください。

```bash
sed -n '348,369p' src/utils/storage/savedUrlStore.ts
```

以下のような内容です:

```typescript
export async function saveSavedUrlEntryMetadata(
    url: string,
    patch: SavedUrlEntryMetadataPatch,
    options: SaveSavedUrlEntryMetadataOptions = {}
): Promise<void> {
    const { refreshTimestamp = true, mergeTags = false, createIfMissing = true, timestamp } = options;

    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx < 0) {
            if (!createIfMissing) return entries;
            return [...entries, applyMetadataPatch({ url, timestamp: timestamp ?? Date.now() }, patch, mergeTags)];
        }
        const updatedEntries = [...entries];
        const merged = applyMetadataPatch(updatedEntries[idx], patch, mergeTags);
        updatedEntries[idx] = refreshTimestamp
            ? { ...merged, timestamp: timestamp ?? Date.now() }
            : merged;
        return updatedEntries;
    });
}
```

`if (idx < 0) {`の行の直前に、以下のコメントを追加してください。

```typescript
        const idx = entries.findIndex(e => e.url === url);
        // New entries always get Date.now() (or the explicit `timestamp`
        // option) here — there is no prior timestamp to "not refresh", so
        // `refreshTimestamp` is intentionally not consulted on this branch.
        if (idx < 0) {
            if (!createIfMissing) return entries;
            return [...entries, applyMetadataPatch({ url, timestamp: timestamp ?? Date.now() }, patch, mergeTags)];
        }
```

**なぜこのコメントを追加するか**: PBIのなぜなぜ分析で明らかになった通り、`refreshTimestamp`オプションは新規作成パスでは一切参照されません。これは実装者にとって「新規作成なのだから当然」という自明な判断でしたが、呼び出し元の開発者には非対称な挙動として伝わりにくいため、コードにその理由を明記します。

- [ ] **Step 3: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。

- [ ] **Step 4: テストを実行し、グリーンになることを確認する**

```bash
npx vitest run src/utils/storage/__tests__/savedUrlStore.test.ts
```

**期待される結果**: 全テストが成功すること（既存9テスト＋Task 2で追加した2テスト）。

- [ ] **Step 5: コミットする**

```bash
git add src/utils/storage/savedUrlStore.ts
git commit -m "fix(saved-url-store): guard applyMetadataPatch against url/timestamp overwrite at runtime"
```

---

## Task 4: 既存テスト・関連ファイルへの影響を確認する

**Files:**
- Read/Run（変更しない）: `src/utils/storage/__tests__/savedUrlStore-cas.test.ts`

- [ ] **Step 1: 関連する既存テストを実行する**

```bash
npx vitest run src/utils/storage/__tests__/savedUrlStore-cas.test.ts
```

**期待される結果**: 全て成功すること。このファイルは`savedUrlStore.ts`の別の側面（CAS＝Compare-And-Swap、楽観的ロック）をテストしていますが、`applyMetadataPatch`を間接的に使っている可能性があるため確認します。

- [ ] **Step 2: `applyMetadataPatch`を呼んでいる他の箇所を確認する**

```bash
grep -n "applyMetadataPatch" src/utils/storage/savedUrlStore.ts
```

**期待される結果**: `saveSavedUrlEntryMetadata`関数内の2箇所（新規作成パスと更新パス）のみで使われていることを確認してください。これ以外の箇所から呼ばれていないことを確認できれば、影響範囲がこのファイル内に閉じていると分かります。

- [ ] **Step 3: プロジェクト全体のテストと型チェックを実行する**

```bash
npm run validate
```

**期待される結果**: 全て成功すること。

---

## Task 5: PBIをDONEとしてアーカイブする

**Files:**
- Modify: `pbi/00-INDEX.md`
- Move: `pbi/2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md` → `dev-docs/archived/pbi/`

- [ ] **Step 1: PBIファイルをアーカイブディレクトリへ移動する**

```bash
mkdir -p dev-docs/archived/pbi
git mv pbi/2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md dev-docs/archived/pbi/
```

- [ ] **Step 2: `pbi/00-INDEX.md`を更新する**

```markdown
- 2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md (applyMetadataPatchにurl/timestamp実行時ガードを追加、型キャスト経由の改ざんを防止)
```

- [ ] **Step 3: コミットする**

```bash
git add pbi/00-INDEX.md dev-docs/archived/pbi/2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md
git commit -m "docs(pbi): archive completed apply-metadata-patch-runtime-guard PBI"
```

---

## 完了チェックリスト

- [ ] `npx vitest run src/utils/storage/__tests__/savedUrlStore.test.ts` がグリーン（11テスト）
- [ ] `npm run validate`（型チェック＋全テスト）がグリーン
- [ ] `pbi/00-INDEX.md`が更新され、PBIがアーカイブされている
