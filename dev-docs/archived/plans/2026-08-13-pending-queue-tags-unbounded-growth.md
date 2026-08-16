# pendingChromeStorageQueue tags肥大化防止 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一URLへのメタデータパッチが繰り返しマージされた際、`content`を間引いても`tags`だけでペイロードが無制限に肥大化しないよう、マージ後のサイズを常に検証して超過分の`tags`を切り詰める。

**Architecture:** `src/background/pendingChromeStorageQueue.ts`の`enqueuePendingWrite`内、既存の`content`間引きロジックの直後に、それでもサイズ超過している場合は`tags`配列の先頭（古い方）から要素を削るループを追加する。`MAX_PATCH_PAYLOAD_BYTES`定数の重複を1箇所に統合する。

**Tech Stack:** TypeScript, Vitest（`environment: 'node'`, `globals: true`）

---

## 事前に必ず読むこと

1. **テストランナーはVitestです。**
2. **`Blob`を使ったサイズ計算がこのファイルの既存パターンです。** `new Blob([JSON.stringify(obj)]).size`でオブジェクトをJSON化したときのバイト数を概算しています。
3. **`tags`は配列の末尾が新しく追加された要素です。** 既存の`mergeTags`ロジック（`Array.from(new Set([...existing, ...new]))`）は`Set`が挿入順を保持する性質を使っており、`existing`（古い方）が先、`new`（新しい方）が後に並びます。切り詰めるときは先頭（古い方）から削ります。

---

## Task 1: 既存コードとテストパターンを確認する

**Files:**
- Read（変更しない）: `src/background/pendingChromeStorageQueue.ts:69-119`
- Read（変更しない）: `src/background/__tests__/pendingChromeStorageQueue.test.ts`

- [ ] **Step 1: 対象関数の現在のコードを確認する**

```bash
sed -n '69,119p' src/background/pendingChromeStorageQueue.ts
```

以下のような内容が表示されます（要点抜粋）:

```typescript
export async function enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
  if ('type' in write && write.type === 'metadataPatch') {
    const existing = await queue.load();
    const sameUrlIndex = existing.findIndex(
      (w) => 'type' in w && (w as PendingMetadataPatchWrite).type === 'metadataPatch' && (w as PendingMetadataPatchWrite).url === write.url,
    );
    if (sameUrlIndex >= 0) {
      const existingPatch = existing[sameUrlIndex] as PendingMetadataPatchWrite;
      const mergedPatch = { ...existingPatch.patch, ...write.patch };
      if (write.mergeTags && existingPatch.mergeTags && existingPatch.patch.tags && write.patch.tags) {
        mergedPatch.tags = Array.from(new Set([...(existingPatch.patch.tags || []), ...(write.patch.tags || [])]));
      }
      const latestTimestamp = Math.max(existingPatch.timestamp || 0, write.timestamp || 0);
      existing[sameUrlIndex] = {
        ...existingPatch,
        patch: mergedPatch,
        timestamp: latestTimestamp,
        createdAt: existingPatch.createdAt,
        retryCount: 0,
      };
      // Omit content if the merged payload exceeds the limit.
      const mergedSize = new Blob([JSON.stringify(mergedPatch)]).size;
      const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;
      if (mergedSize > MAX_PATCH_PAYLOAD_BYTES && mergedPatch.content) {
        existing[sameUrlIndex] = {
          ...existing[sameUrlIndex],
          patch: (({ content, ...rest }: { content?: string }) => rest)(mergedPatch),
          contentOmitted: true,
        };
      }
      await queue.save(existing);
      return;
    }
  }

  // Omit content for new metadata patches that exceed the payload limit.
  let queuedWrite = write;
  if ('type' in write && write.type === 'metadataPatch') {
    const patch = (write as PendingMetadataPatchWrite).patch;
    const payloadSize = new Blob([JSON.stringify(patch)]).size;
    const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;
    if (payloadSize > MAX_PATCH_PAYLOAD_BYTES && patch.content) {
      queuedWrite = {
        ...write,
        patch: (({ content, ...rest }: { content?: string }) => rest)(patch),
        contentOmitted: true,
      } as PendingMetadataPatchWrite;
    }
  }
  await queue.enqueue(queuedWrite);
}
```

**問題点**: `MAX_PATCH_PAYLOAD_BYTES`が2回定義されている（重複）。マージ後のサイズチェックが`mergedPatch.content`の有無だけを条件にしているため、`content`がない場合や既に間引かれた後は、`tags`がどれだけ大きくてもチェックされない。

- [ ] **Step 2: `PendingMetadataPatchWrite`型定義を確認する**

```bash
sed -n '28,47p' src/background/pendingChromeStorageQueue.ts
```

以下が表示されます:

```typescript
export interface PendingMetadataPatchWrite {
  type: 'metadataPatch';
  key: 'savedUrlsWithTimestamps';
  url: string;
  patch: SavedUrlEntryMetadataPatch;
  refreshTimestamp?: boolean;
  timestamp?: number;
  mergeTags?: boolean;
  id?: number;
  createdAt: number;
  retryCount: number;
  contentOmitted?: boolean;
}
```

**確認したこと**: `contentOmitted?: boolean`という既存のオプションフィールドがあります。今回追加する`tagsOmitted?: boolean`もこれと同じパターンで安全に追加できます。

- [ ] **Step 3: 既存のテストファイルを確認する**

```bash
cat src/background/__tests__/pendingChromeStorageQueue.test.ts
```

このファイルの末尾にある`'omits content when the serialized patch exceeds the payload limit'`というテスト（136-153行目付近）が、今回追加するテストの直接のお手本になります。同じ`describe`ブロックの中に新しいテストを追加します。

（このタスクは調査のみです。コミット不要です。）

---

## Task 2: 失敗するテストを書く

**Files:**
- Modify: `src/background/__tests__/pendingChromeStorageQueue.test.ts`

- [ ] **Step 1: tags肥大化を再現するテストケースを追加する**

`src/background/__tests__/pendingChromeStorageQueue.test.ts`の末尾、最後の`it(...)`ブロックの直後（`});`の後、`describe`ブロックを閉じる`});`の前）に以下を追加してください。

```typescript
  it('truncates tags when repeated merges exceed the payload limit even without content', async () => {
    // 1件目のtagsを大量に用意する（1タグあたり短い文字列でも、件数を
    // 十分増やせばMAX_PATCH_PAYLOAD_BYTES(100KB)を超えられる）。
    const manyTags = Array.from({ length: 3000 }, (_, i) => `tag-${i}`);
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: manyTags },
      timestamp: 1000,
      mergeTags: true,
      createdAt: 1000,
      retryCount: 0,
    });

    // 2件目をマージすることで、既存の巨大なtagsとさらにマージされる。
    // content は含めないため、既存の content 間引きロジックだけでは
    // このペイロードを縮小できない。
    await enqueuePendingWrite({
      type: 'metadataPatch',
      key: 'savedUrlsWithTimestamps',
      url: 'https://example.com',
      patch: { tags: ['fresh-tag'] },
      timestamp: 2000,
      mergeTags: true,
      createdAt: 2000,
      retryCount: 0,
    });

    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as Array<{
      patch: { tags?: string[]; content?: string };
      tagsOmitted?: boolean;
    }>;
    expect(queue).toHaveLength(1);
    const merged = queue[0];

    const mergedSize = new Blob([JSON.stringify(merged.patch)]).size;
    expect(mergedSize).toBeLessThanOrEqual(100 * 1024);
    expect(merged.tagsOmitted).toBe(true);
    // 直近に追加したタグ（末尾側）は優先して残るはず。
    expect(merged.patch.tags).toContain('fresh-tag');
  });
```

**なぜ3000件・`tag-${i}`という形式にしたか**: `tag-0`から`tag-2999`という文字列は平均7〜8文字程度なので、JSON化した際の区切り文字（カンマ、引用符）を含めても1タグあたり約12バイト、3000件で約36KB程度になります。2回目のマージでさらにこれに近い量が追加されると、合計が100KBを超える計算になります。もし実際に実行してみて超過しない場合は、`length: 3000`を`length: 6000`のように増やして調整してください。

- [ ] **Step 2: テストを実行し、失敗することを確認する**

```bash
npx vitest run src/background/__tests__/pendingChromeStorageQueue.test.ts
```

**期待される結果**: 新しく追加したテスト`truncates tags when repeated merges exceed the payload limit even without content`が失敗する。おそらく`mergedSize`が100KBを超えたままか、`merged.tagsOmitted`が`undefined`（`toBe(true)`と一致しない）のいずれかで失敗します。

もし予期せず**成功してしまう場合**は、`manyTags`の件数が足りず実際にはサイズ超過していない可能性があります。その場合は`console.log(mergedSize)`を一時的に追加してサイズを確認し、`length`を増やしてください（確認後は`console.log`を削除してください）。

- [ ] **Step 3: コミットする**

```bash
git add src/background/__tests__/pendingChromeStorageQueue.test.ts
git commit -m "test(pending-queue): add failing test for unbounded tags growth"
```

---

## Task 3: tags切り詰めロジックを実装する

**Files:**
- Modify: `src/background/pendingChromeStorageQueue.ts`

- [ ] **Step 1: `MAX_PATCH_PAYLOAD_BYTES`定数をモジュールスコープに1つだけ定義する**

`src/background/pendingChromeStorageQueue.ts`の`MAX_PENDING_WRITES`定数が定義されている箇所（16行目付近）を確認してください。

```bash
sed -n '13,17p' src/background/pendingChromeStorageQueue.ts
```

以下のように、その近くに新しい定数を追加してください。

```typescript
export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
const MAX_PENDING_WRITES = 500;

/**
 * Per-entry payload cap for a merged metadata patch. content is omitted
 * first when a merge exceeds this; if the payload is still too large
 * afterwards (e.g. very large accumulated tags), tags are truncated too.
 */
const MAX_PATCH_PAYLOAD_BYTES = 100 * 1024;

/** How many tags to keep (most recent first) when a merge must be truncated. */
const MAX_TAGS_AFTER_TRUNCATION = 50;
```

**なぜモジュールスコープに移すか**: 元のコードでは`enqueuePendingWrite`関数の中に2回、同じ値`100 * 1024`が別々の`const`として定義されていました（91行目・109行目）。これを1箇所にまとめることで、将来この値を変更する際に1箇所だけ直せばよくなります。

- [ ] **Step 2: マージ処理内の重複した`const MAX_PATCH_PAYLOAD_BYTES`を削除し、tags切り詰めロジックを追加する**

`enqueuePendingWrite`関数全体を、以下のように書き換えてください。

```typescript
export async function enqueuePendingWrite(write: QueuedChromeStorageWrite): Promise<void> {
  if ('type' in write && write.type === 'metadataPatch') {
    const existing = await queue.load();
    const sameUrlIndex = existing.findIndex(
      (w) => 'type' in w && (w as PendingMetadataPatchWrite).type === 'metadataPatch' && (w as PendingMetadataPatchWrite).url === write.url,
    );
    if (sameUrlIndex >= 0) {
      const existingPatch = existing[sameUrlIndex] as PendingMetadataPatchWrite;
      const mergedPatch = { ...existingPatch.patch, ...write.patch };
      if (write.mergeTags && existingPatch.mergeTags && existingPatch.patch.tags && write.patch.tags) {
        mergedPatch.tags = Array.from(new Set([...(existingPatch.patch.tags || []), ...(write.patch.tags || [])]));
      }
      const latestTimestamp = Math.max(existingPatch.timestamp || 0, write.timestamp || 0);
      existing[sameUrlIndex] = {
        ...existingPatch,
        patch: mergedPatch,
        timestamp: latestTimestamp,
        createdAt: existingPatch.createdAt,
        retryCount: 0,
      };

      // Omit content first if the merged payload exceeds the limit.
      let mergedSize = new Blob([JSON.stringify(mergedPatch)]).size;
      if (mergedSize > MAX_PATCH_PAYLOAD_BYTES && mergedPatch.content) {
        existing[sameUrlIndex] = {
          ...existing[sameUrlIndex],
          patch: (({ content, ...rest }: { content?: string }) => rest)(mergedPatch),
          contentOmitted: true,
        };
        mergedSize = new Blob([JSON.stringify((existing[sameUrlIndex] as PendingMetadataPatchWrite).patch)]).size;
      }

      // If still too large (e.g. tags accumulated across many failed
      // retries), truncate tags — keep the most recently added ones
      // (array tail, since mergeTags appends new tags after existing ones)
      // and drop the oldest first.
      if (mergedSize > MAX_PATCH_PAYLOAD_BYTES) {
        const currentPatch = (existing[sameUrlIndex] as PendingMetadataPatchWrite).patch;
        const currentTags = currentPatch.tags;
        if (currentTags && currentTags.length > 0) {
          let truncatedTags = currentTags.slice(-MAX_TAGS_AFTER_TRUNCATION);
          let candidatePatch = { ...currentPatch, tags: truncatedTags };
          let candidateSize = new Blob([JSON.stringify(candidatePatch)]).size;
          // Even MAX_TAGS_AFTER_TRUNCATION tags might still be too large
          // if individual tag strings are unusually long — keep shrinking
          // from the front until it fits or nothing is left.
          while (candidateSize > MAX_PATCH_PAYLOAD_BYTES && truncatedTags.length > 0) {
            truncatedTags = truncatedTags.slice(1);
            candidatePatch = { ...currentPatch, tags: truncatedTags };
            candidateSize = new Blob([JSON.stringify(candidatePatch)]).size;
          }
          existing[sameUrlIndex] = {
            ...existing[sameUrlIndex],
            patch: truncatedTags.length > 0 ? candidatePatch : (({ tags, ...rest }: { tags?: string[] }) => rest)(candidatePatch),
            tagsOmitted: true,
          };
        }
      }

      await queue.save(existing);
      return;
    }
  }

  // Omit content for new metadata patches that exceed the payload limit.
  let queuedWrite = write;
  if ('type' in write && write.type === 'metadataPatch') {
    const patch = (write as PendingMetadataPatchWrite).patch;
    const payloadSize = new Blob([JSON.stringify(patch)]).size;
    if (payloadSize > MAX_PATCH_PAYLOAD_BYTES && patch.content) {
      queuedWrite = {
        ...write,
        patch: (({ content, ...rest }: { content?: string }) => rest)(patch),
        contentOmitted: true,
      } as PendingMetadataPatchWrite;
    }
  }
  await queue.enqueue(queuedWrite);
}
```

**このステップで何をしたか**:
1. `content`間引き後、`mergedSize`を再計算するように変更（間引く前のサイズのままだと、その後のtagsチェックが正しく判定できないため）
2. `content`間引き後もなおサイズ超過している場合、`tags`を配列末尾から`MAX_TAGS_AFTER_TRUNCATION`(50)件だけ残す
3. それでもサイズ超過する場合（1タグが極端に長い等）、先頭から1件ずつ削るループでサイズが収まるまで繰り返す
4. `tags`が完全に空になった場合は、`tags`フィールド自体を除去する（既存の`saveSavedUrlEntryMetadata`側の「空のtagsは`undefined`扱い」という慣習に合わせる）
5. 切り詰めが発生したことを`tagsOmitted: true`で記録する

**なぜ`content`間引き後に`mergedSize`を再計算する変更が必要か**: 元のコードは`content`を間引いた後もその前に計算した`mergedSize`（間引く前のサイズ）を使い続けていました。今回`tags`チェックを追加するにあたり、「`content`を間引いた後の実際のサイズ」で判定しないと、既にcontentを間引いてサイズが十分小さくなっているのに不要に`tags`まで削ってしまう可能性があります。

- [ ] **Step 3: `PendingMetadataPatchWrite`型に`tagsOmitted`フィールドを追加する**

`src/background/pendingChromeStorageQueue.ts`の型定義（28-45行目付近）を確認してください。

```bash
sed -n '33,45p' src/background/pendingChromeStorageQueue.ts
```

`contentOmitted?: boolean;`という行の直後に以下を追加してください。

```typescript
export interface PendingMetadataPatchWrite {
  type: 'metadataPatch';
  key: 'savedUrlsWithTimestamps';
  url: string;
  patch: SavedUrlEntryMetadataPatch;
  refreshTimestamp?: boolean;
  timestamp?: number;
  mergeTags?: boolean;
  id?: number;
  createdAt: number;
  retryCount: number;
  contentOmitted?: boolean;
  tagsOmitted?: boolean;
}
```

- [ ] **Step 4: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。

- [ ] **Step 5: テストを実行し、グリーンになることを確認する**

```bash
npx vitest run src/background/__tests__/pendingChromeStorageQueue.test.ts
```

**期待される結果**: 全テストが成功すること（既存7テスト＋Task 2で追加した1テスト）。

もし失敗する場合、よくある原因:
- `manyTags`の件数を調整してもサイズ超過しない → `console.log`でサイズを一時的に確認し、`length`を大きくする
- `merged.patch.tags`に`fresh-tag`が含まれない → 切り詰めロジックが末尾（新しい方）ではなく先頭（古い方）を残してしまっている可能性があるので、`slice(-MAX_TAGS_AFTER_TRUNCATION)`の符号（マイナスがついているか）を確認する

- [ ] **Step 6: コミットする**

```bash
git add src/background/pendingChromeStorageQueue.ts
git commit -m "fix(pending-queue): truncate tags when merged payload still exceeds size limit"
```

---

## Task 4: 既存テストへの影響を確認する

**Files:**
- Read/Run（変更しない）: `src/background/__tests__/pendingChromeStorageQueue.test.ts`（全体）

- [ ] **Step 1: プロジェクト全体のテストと型チェックを実行する**

```bash
npm run validate
```

**期待される結果**: 全てのテストと型チェックが成功すること。

- [ ] **Step 2: 既存の`'coalesces metadata patches for the same URL'`テストと`'omits content when the serialized patch exceeds the payload limit'`テストが引き続き成功していることを個別に確認する**

```bash
npx vitest run src/background/__tests__/pendingChromeStorageQueue.test.ts -t "coalesces metadata patches"
npx vitest run src/background/__tests__/pendingChromeStorageQueue.test.ts -t "omits content when"
```

**期待される結果**: 両方とも成功すること。これらのテストは通常サイズのtags/contentを扱っており、Task 3で追加した切り詰めロジックが発動しない（サイズが十分小さい）ため、影響を受けないはずです。

---

## Task 5: PBIをDONEとしてアーカイブする

**Files:**
- Modify: `pbi/00-INDEX.md`
- Move: `pbi/2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md` → `dev-docs/archived/pbi/`

- [ ] **Step 1: PBIファイルをアーカイブディレクトリへ移動する**

```bash
mkdir -p dev-docs/archived/pbi
git mv pbi/2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md dev-docs/archived/pbi/
```

- [ ] **Step 2: `pbi/00-INDEX.md`を更新する**

「進行中」テーブルから該当行を削除し、「アーカイブ履歴」セクションに追記してください。

```markdown
- 2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md (pendingChromeStorageQueueのマージ後サイズ検証を拡張、content間引き後もtags肥大化する場合は末尾優先で切り詰め)
```

- [ ] **Step 3: コミットする**

```bash
git add pbi/00-INDEX.md dev-docs/archived/pbi/2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md
git commit -m "docs(pbi): archive completed pending-queue-tags-unbounded-growth PBI"
```

---

## 完了チェックリスト

- [ ] `npx vitest run src/background/__tests__/pendingChromeStorageQueue.test.ts` がグリーン（8テスト）
- [ ] `npm run validate`（型チェック＋全テスト）がグリーン
- [ ] `pbi/00-INDEX.md`が更新され、PBIがアーカイブされている
