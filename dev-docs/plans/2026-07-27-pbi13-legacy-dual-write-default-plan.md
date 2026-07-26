# PBI-13: レガシーデュアルライトの調停メカニズム整理・デフォルト見直し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-26-13-fix-legacy-dual-write-default.md`（フェーズ0再調査済み・2026-07-27）

**Goal:** `chrome.storage.local`書き込み失敗時のリカバリキューを実装し（Task 1）、`savedUrlsWithTimestamps`依存箇所を洗い出してSQLite単独での代替可能性を確認し（Task 2）、確認できれば`LEGACY_DUAL_WRITE_ENABLED`のデフォルトを`true`→`false`に変更する（Task 3）。

**Architecture:** 既存の`src/background/pendingSqliteQueue.ts`（SQLite書き込み失敗時のリカバリキュー、`chrome.storage.local`キー`pending_sqlite_records`＋Service Worker起動時`flushPendingRecords`で再試行）と**全く同じ設計パターン**を、chrome.storage側の失敗ケースに適用する。ゼロから設計せず、既存パターンをコピー・改名して使う。

**Tech Stack:** TypeScript, Vitest, chrome.storage.local API, chrome.alarms API

**重要な訂正（フェーズ0再調査で判明）**: PBI本文・前回の再調査メモでは「`savedUrlsWithTimestamps`が約30箇所から参照されている」としていたが、これは`src/utils/urlMetadata.ts`**1ファイル内での出現回数**（31回）だった。実際に`savedUrlsWithTimestamps`を参照するプロダクションファイルは以下の**9ファイルのみ**であり、想定より調査範囲は狭い:

```
src/background/migrationService.ts
src/background/pipeline/RecordingPipeline.ts
src/background/pipeline/steps/saveMetadataStep.ts
src/dashboard/panels/asyncData/historyPanel.ts
src/utils/optimisticLock.ts
src/utils/storage/savedUrlStore.ts
src/utils/storage/settingsStore.ts
src/utils/urlMetadata.ts
src/utils/urlStorage.ts
```

---

## Task 1: chrome.storage.local書き込み失敗時のリカバリキュー実装（必須）

**Files:**
- Create: `src/background/pendingChromeStorageQueue.ts`
- Create: `src/background/__tests__/pendingChromeStorageQueue.test.ts`
- Modify: `src/background/pipeline/steps/saveMetadataStep.ts`
- Modify: `src/background/service-worker.ts`（アラームハンドラーへの相乗り登録）

- [ ] **Step 1: 既存パターンの参照実装を確認する**

```bash
cat src/background/pendingSqliteQueue.ts
grep -n "flushPendingRecords\|pendingSqliteQueue" src/background/service-worker.ts
grep -n "enqueuePendingRecord" src/background/pipeline/steps/saveSqliteStep.ts
```

`pendingSqliteQueue.ts`の`enqueuePendingRecord()`/`flushPendingRecords()`/`chunkArray()`の実装、
`service-worker.ts:678`付近での`yasumaro-offline-network-retry`アラームへの相乗り方法、
`saveSqliteStep.ts:18`での呼び出し方を確認する。

- [ ] **Step 2: 失敗するテストを書く（`pendingChromeStorageQueue.test.ts`）**

```typescript
// src/background/__tests__/pendingChromeStorageQueue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enqueuePendingWrite, flushPendingWrites, PENDING_CHROME_STORAGE_KEY } from '../pendingChromeStorageQueue.js';

describe('pendingChromeStorageQueue', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: storageData[key] })),
          set: vi.fn((obj: Record<string, unknown>) => {
            Object.assign(storageData, obj);
            return Promise.resolve();
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('queues a failed write and retries it on flush', async () => {
    await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://example.com', title: 't', timestamp: 1 }] });

    const retryFn = vi.fn().mockResolvedValue(true);
    await flushPendingWrites(retryFn);

    expect(retryFn).toHaveBeenCalledWith({ key: 'savedUrlsWithTimestamps', value: [{ url: 'https://example.com', title: 't', timestamp: 1 }] });
  });

  it('keeps a write queued when retry fails', async () => {
    await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [] });

    const retryFn = vi.fn().mockResolvedValue(false);
    await flushPendingWrites(retryFn);

    const remaining = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(remaining).toHaveLength(1);
  });

  it('caps the queue at MAX_PENDING_WRITES entries', async () => {
    for (let i = 0; i < 600; i++) {
      await enqueuePendingWrite({ key: 'savedUrlsWithTimestamps', value: [], id: i });
    }
    const queue = storageData[PENDING_CHROME_STORAGE_KEY] as unknown[];
    expect(queue.length).toBeLessThanOrEqual(500);
  });
});
```

Run: `npm test -- src/background/__tests__/pendingChromeStorageQueue.test.ts`
Expected: FAIL with "Cannot find module '../pendingChromeStorageQueue.js'"

- [ ] **Step 3: `pendingChromeStorageQueue.ts`を実装する（`pendingSqliteQueue.ts`を忠実にコピー・改名）**

```typescript
// src/background/pendingChromeStorageQueue.ts
/**
 * pendingChromeStorageQueue.ts
 * Holds chrome.storage.local writes that failed (e.g. quota exceeded,
 * transient storage error) so they aren't silently lost. Queued writes are
 * retried on the next flush (Service Worker startup / offline-network-retry
 * alarm) instead of being dropped. Mirrors pendingSqliteQueue.ts's design
 * for the chrome.storage side of the legacy dual-write path (PBI-13).
 */

import { addLog, LogType } from '../utils/logger.js';

export const PENDING_CHROME_STORAGE_KEY = 'pending_chrome_storage_writes';

/** Hard cap so a prolonged storage outage can't grow this list unbounded. */
const MAX_PENDING_WRITES = 500;

export interface PendingChromeStorageWrite {
  key: string;
  value: unknown;
  id?: number;
}

async function loadQueue(): Promise<PendingChromeStorageWrite[]> {
  const result = await chrome.storage.local.get(PENDING_CHROME_STORAGE_KEY);
  const stored = result[PENDING_CHROME_STORAGE_KEY];
  return Array.isArray(stored) ? (stored as PendingChromeStorageWrite[]) : [];
}

async function saveQueue(writes: PendingChromeStorageWrite[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CHROME_STORAGE_KEY]: writes });
}

/**
 * Queue a chrome.storage.local write that failed. Best-effort: a queue
 * write failure is logged but not thrown, so it never masks the original
 * write failure.
 */
export async function enqueuePendingWrite(write: PendingChromeStorageWrite): Promise<void> {
  try {
    const queue = await loadQueue();
    queue.push(write);
    if (queue.length > MAX_PENDING_WRITES) {
      queue.splice(0, queue.length - MAX_PENDING_WRITES);
    }
    await saveQueue(queue);
  } catch (error) {
    addLog(LogType.ERROR, 'pendingChromeStorageQueue: failed to enqueue write', {
      key: write.key,
      error: String(error),
    });
  }
}

/**
 * Retry every queued write. Writes that succeed are removed from the
 * queue; writes that fail stay queued for the next flush.
 * @param retryFn - Performs the actual retry; returns true on success.
 */
export async function flushPendingWrites(
  retryFn: (write: PendingChromeStorageWrite) => Promise<boolean>
): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const stillPending: PendingChromeStorageWrite[] = [];

  for (const write of queue) {
    try {
      const success = await retryFn(write);
      if (!success) {
        stillPending.push(write);
      }
    } catch {
      stillPending.push(write);
    }
  }

  await saveQueue(stillPending);

  if (stillPending.length < queue.length) {
    addLog(LogType.INFO, 'pendingChromeStorageQueue: flushed queued writes', {
      recovered: queue.length - stillPending.length,
      remaining: stillPending.length,
    });
  }
}
```

Run: `npm test -- src/background/__tests__/pendingChromeStorageQueue.test.ts`
Expected: PASS（3テスト全て）

- [ ] **Step 4: `saveMetadataStep.ts`の`savedUrlsWithTimestamps`書き込み失敗時にキューへ退避する**

`saveMetadataStep.ts:80-99`の既存のtry-catchブロック（`withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', ...)`）のcatch節に、`enqueuePendingWrite`呼び出しを追加する:

```typescript
// src/background/pipeline/steps/saveMetadataStep.ts の該当箇所を以下に置き換え
import { enqueuePendingWrite } from '../../pendingChromeStorageQueue.js';

// ...

  await (async () => {
    try {
      await withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', (currentEntries) => {
        const current = currentEntries || [];
        const existingIdx = current.findIndex(e => e.url === url);
        if (existingIdx >= 0) {
          return current.map((e, i) =>
            i === existingIdx ? { ...e, timestamp: Date.now() } : e
          );
        }
        return [...current, { url, title: data.title || '', timestamp: Date.now() }];
      });
      results.success.push('savedUrlsWithTimestamps');
    } catch (error: unknown) {
      results.failed.push('savedUrlsWithTimestamps');
      addLog(LogType.WARN, 'Failed to save savedUrlsWithTimestamps entry', {
        error: errorMessage(error), url
      });
      // PBI-13: retry via pendingChromeStorageQueue instead of dropping the write
      await enqueuePendingWrite({
        key: 'savedUrlsWithTimestamps',
        value: { url, title: data.title || '', timestamp: Date.now() },
      });
    }
  })();
```

- [ ] **Step 5: Service Workerのオフラインキューアラームに`flushPendingWrites`を相乗りさせる**

```bash
grep -n "yasumaro-offline-network-retry\|flushPendingRecords" src/background/service-worker.ts
```

該当アラームハンドラー（`processOfflineNetworkQueue`呼び出し箇所付近、`service-worker.ts:676`前後）に以下を追加する。retryFnの中身は、`write.key`が`savedUrlsWithTimestamps`の場合`withOptimisticLock`で再度マージを試みる:

```typescript
import { flushPendingWrites, type PendingChromeStorageWrite } from './pendingChromeStorageQueue.js';
import { withOptimisticLock } from '../utils/optimisticLock.js';
import type { SavedUrlEntry } from '../utils/urlEntry.js';

async function retryPendingChromeStorageWrite(write: PendingChromeStorageWrite): Promise<boolean> {
  if (write.key !== 'savedUrlsWithTimestamps') return false;
  try {
    const entry = write.value as SavedUrlEntry;
    await withOptimisticLock<SavedUrlEntry[]>('savedUrlsWithTimestamps', (current) => {
      const list = current || [];
      const idx = list.findIndex((e) => e.url === entry.url);
      if (idx >= 0) return list.map((e, i) => (i === idx ? { ...e, timestamp: entry.timestamp } : e));
      return [...list, entry];
    });
    return true;
  } catch {
    return false;
  }
}
```

そして`processOfflineNetworkQueue()`/`flushPendingRecords(sqliteClient)`と並べて`void flushPendingWrites(retryPendingChromeStorageWrite);`を呼び出す。

- [ ] **Step 6: 型チェック・テストで検証する**

```bash
npm run type-check
npm test -- src/background/__tests__/pendingChromeStorageQueue.test.ts src/background/__tests__/service-worker.test.ts src/background/pipeline/steps/__tests__/saveMetadataStep.test.ts
```

Expected: 全てパス

---

## Task 2: savedUrlsWithTimestamps依存9ファイルの洗い出しとSQLite代替可能性の確認（必須）

**Files（読み取り調査のみ、変更なし）:**
- `src/background/migrationService.ts`
- `src/background/pipeline/RecordingPipeline.ts`
- `src/background/pipeline/steps/saveMetadataStep.ts`
- `src/dashboard/panels/asyncData/historyPanel.ts`
- `src/utils/optimisticLock.ts`
- `src/utils/storage/savedUrlStore.ts`
- `src/utils/storage/settingsStore.ts`
- `src/utils/urlMetadata.ts`
- `src/utils/urlStorage.ts`

- [ ] **Step 1: 各ファイルでの`savedUrlsWithTimestamps`の用途を分類する**

```bash
grep -n "savedUrlsWithTimestamps" src/background/migrationService.ts src/background/pipeline/RecordingPipeline.ts src/dashboard/panels/asyncData/historyPanel.ts src/utils/optimisticLock.ts src/utils/storage/savedUrlStore.ts src/utils/storage/settingsStore.ts src/utils/urlMetadata.ts src/utils/urlStorage.ts
```

それぞれについて「読み取り専用」「書き込み専用」「両方」を分類する表を作成すること。特に`src/dashboard/panels/asyncData/historyPanel.ts`（ダッシュボードの履歴パネル）が本当にこのキーに依存しているか、それとも既にSQLite（`dashboardSqliteService.ts`経由）を使っているかを確認する。

- [ ] **Step 2: `historyPanel.ts`がSQLite単独で機能するかを確認する**

```bash
grep -n "dashboardSqliteService\|queryLogs\|savedUrlsWithTimestamps" src/dashboard/panels/asyncData/historyPanel.ts
```

もし`historyPanel.ts`が既にSQLite（`queryLogs`等）を主体的に使っており、`savedUrlsWithTimestamps`は付随的な参照（例: 移行期の互換性コードのみ）であれば、「SQLite単独で機能充足」の受け入れ基準は満たしやすい。逆に本当に`savedUrlsWithTimestamps`からデータを読んで表示している場合、デフォルト変更前にこの経路をSQLite読み取りに置き換える追加作業が必要になる。

- [ ] **Step 3: 調査結果をADRとしてまとめる**

```bash
mkdir -p dev-docs/ADR
```

`dev-docs/ADR/2026-07-27-legacy-dual-write-savedurls-dependency-audit.md`として、9ファイルの依存分類・SQLite代替可能性の結論を記録する。SQLite単独で代替できないファイルがあれば、その対応（別PBI化するか、本PBIのスコープに含めるか）を明記する。

---

## Task 3: LEGACY_DUAL_WRITE_ENABLEDのデフォルト変更（Task 1, 2完了後のみ実施）

**Files:**
- Modify: `src/utils/storage/defaults.ts`
- Modify: `CHANGELOG.md`

**前提条件**: Task 2のADRで「SQLite単独で全依存箇所が機能充足する」という結論が出た場合のみ実施する。1つでも代替不可能な依存箇所が見つかった場合、このTaskは実施せず、代替不可能な箇所への対応を別PBIとして起票してから改めて検討する。

- [ ] **Step 1: デフォルト値を変更する**

```bash
grep -n "LEGACY_DUAL_WRITE_ENABLED" src/utils/storage/defaults.ts
```

`[StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: true` を `false` に変更する。

- [ ] **Step 2: 既存ユーザーのデータ保護を確認する**

デフォルト値の変更は**新規ユーザーおよび設定未保存の既存ユーザー**にのみ影響する。既に`LEGACY_DUAL_WRITE_ENABLED: true`を明示的に保存済みのユーザーには影響しないことを、`getSettings()`のマージロジック（保存値がdefaultsを上書きする）で確認する。

```bash
grep -n "function getSettings\|DEFAULT_SETTINGS" src/utils/storage.ts | head -5
```

- [ ] **Step 3: CHANGELOG.mdにデフォルト変更を記載する**

「Chores」または「Changed」セクションに、デフォルト変更の内容と影響（新規インストールユーザーはchrome.storage.localへの二重書き込みが行われなくなる）を記載する。

- [ ] **Step 4: 型チェック・全テストで検証する**

```bash
npm run type-check && npm test
```

---

## 全体検証

- [ ] `npm run type-check` が成功する
- [ ] `npm test` で全テストがパスする
- [ ] `npm run build` が成功する
- [ ] `pbi/00-INDEX.md` の該当行を更新する（Task 1, 2完了、Task 3は条件次第で完了 or 見送り理由を記録）

## コミット方針

Task単位で個別コミットする:
1. `feat(background): chrome.storage書き込み失敗時のリカバリキューを追加`（Task 1）
2. `docs(adr): savedUrlsWithTimestamps依存箇所の調査結果を記録`（Task 2）
3. `fix(storage): LEGACY_DUAL_WRITE_ENABLEDのデフォルトをfalseに変更`（Task 3、実施する場合のみ）
