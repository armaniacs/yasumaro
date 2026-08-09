# PBI-15: settings migrationの非破壊化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-26-15-fix-settings-migration-non-destructive.md`（フェーズ0再調査済み・2026-07-27）

**Goal:** `migrateToSingleSettingsObject()`の即時`chrome.storage.local.remove(keysToRemove)`を、バックアップキーへの退避に変更する。`settings`オブジェクト破損時にバックアップから復元するロジックを`getSettings()`に追加し、既存の`dailyPurgeHandler.ts`に保持期限クリーンアップを統合する。

**Architecture:** 既存の`src/background/dailyPurgeHandler.ts`（`chrome.alarms`ベースの日次クリーンアップ）に新規関数呼び出しを1つ追加する形で統合する。新規アラームは作らない。

**Tech Stack:** TypeScript, Vitest, chrome.storage.local API

**対象コード（現在の正確な行番号、2026-07-27確認）**: `src/utils/storage/settingsStore.ts:169-218`（`migrateToSingleSettingsObject`）, `:280-307`（`getSettings`前半）

---

## Task 1: バックアップキーへの退避ロジック実装

**Files:**
- Modify: `src/utils/storage/settingsStore.ts`
- Modify: `src/utils/__tests__/settingsStore.test.ts`（既存テストファイルがあれば追記。なければ新規作成）

- [ ] **Step 1: 既存の`migrateToSingleSettingsObject()`の全体像とテストを確認する**

```bash
sed -n '160,220p' src/utils/storage/settingsStore.ts
find src/utils -iname "*settingsStore*test*"
```

- [ ] **Step 2: 失敗するテストを追加する（既存テストファイルに追記）**

```typescript
// 既存の settingsStore.test.ts（または新規 src/utils/storage/__tests__/settingsStore-backup.test.ts）に追加
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateToSingleSettingsObject, LEGACY_SETTINGS_BACKUP_KEY } from '../settingsStore.js';

describe('migrateToSingleSettingsObject — non-destructive backup', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {
      obsidian_api_key: 'test-key',
      obsidian_protocol: 'https',
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const k of keys) out[k] = storageData[k];
              return Promise.resolve(out);
            }
            return Promise.resolve({});
          }),
          set: vi.fn((obj: Record<string, unknown>) => { Object.assign(storageData, obj); return Promise.resolve(); }),
          remove: vi.fn((keys: string[]) => { for (const k of keys) delete storageData[k]; return Promise.resolve(); }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('does not immediately remove legacy per-key data — stores it as a backup instead', async () => {
    await migrateToSingleSettingsObject();

    // Legacy keys should be gone from their original location...
    expect(storageData['obsidian_api_key']).toBeUndefined();
    // ...but preserved in a timestamped backup key
    const backupKeys = Object.keys(storageData).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
    expect(backupKeys.length).toBe(1);
    const backup = storageData[backupKeys[0]] as { data: Record<string, unknown>; createdAt: number };
    expect(backup.data['obsidian_api_key']).toBe('test-key');
    expect(typeof backup.createdAt).toBe('number');
  });
});
```

Run: `npm test -- src/utils/storage/__tests__/settingsStore-backup.test.ts` (or wherever the test lives)
Expected: FAIL（`LEGACY_SETTINGS_BACKUP_KEY`が存在しない、または削除ロジックが変わっていないため）

- [ ] **Step 3: `settingsStore.ts`に`LEGACY_SETTINGS_BACKUP_KEY`定数とバックアップ書き込みを実装する**

```typescript
// src/utils/storage/settingsStore.ts の SETTINGS_MIGRATED_KEY 定義付近に追加
export const LEGACY_SETTINGS_BACKUP_KEY = 'legacy_settings_backup';
const BACKUP_RETENTION_DAYS = 30;
```

`migrateToSingleSettingsObject()`内の削除処理（213-215行付近）を以下に置き換える:

```typescript
if (keysToRemove.length > 0) {
    // PBI-15: back up per-key data before removing it, so a corrupted
    // `settings` object can still be recovered. Cleaned up after
    // BACKUP_RETENTION_DAYS by dailyPurgeHandler.ts.
    const backupData: Record<string, unknown> = {};
    for (const key of keysToRemove) {
        backupData[key] = existingKeys[key];
    }
    const backupKey = `${LEGACY_SETTINGS_BACKUP_KEY}_${Date.now()}`;
    await chrome.storage.local.set({
        [backupKey]: { data: backupData, createdAt: Date.now() },
    });
    await chrome.storage.local.remove(keysToRemove);
}
```

- [ ] **Step 4: テストを実行し通過を確認する**

```bash
npm test -- settingsStore
```

Expected: PASS

---

## Task 2: getSettings()での破損検出・バックアップからの復元ロジック

**Files:**
- Modify: `src/utils/storage/settingsStore.ts`

- [ ] **Step 1: 失敗するテストを追加する**

```typescript
describe('getSettings — recovery from backup on corruption', () => {
  // settings オブジェクトが存在するが空 or 必須キー欠落の状態をシミュレート
  it('restores from the most recent backup when settings object is empty/corrupted', async () => {
    const now = Date.now();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            if (keys === null) {
              return Promise.resolve({
                settings: {}, // corrupted: empty object despite migration flag set
                settings_migrated: true,
                [`legacy_settings_backup_${now - 1000}`]: {
                  data: { obsidian_api_key: 'recovered-key' },
                  createdAt: now - 1000,
                },
              });
            }
            return Promise.resolve({});
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as typeof chrome;

    const { getSettings } = await import('../settingsStore.js');
    const settings = await getSettings();
    expect(settings['obsidian_api_key']).toBe('recovered-key');
  });
});
```

Run: `npm test -- settingsStore`
Expected: FAIL（復元ロジックが存在しないため、空の`settings`がそのまま返る）

- [ ] **Step 2: `getSettings()`に破損検出（空オブジェクト判定）とバックアップ復元を追加する**

`settingsStore.ts:296`付近（`if (result.settings && result[SETTINGS_MIGRATED_KEY])`ブロック内）に、`settings`が空オブジェクトの場合の復元パスを追加する:

```typescript
if (result.settings && result[SETTINGS_MIGRATED_KEY]) {
    let settings = result.settings;

    // PBI-15: detect a corrupted/empty settings object and attempt recovery
    // from the most recent legacy_settings_backup_* entry.
    if (Object.keys(settings).length === 0) {
        const recovered = await tryRestoreFromBackup();
        if (recovered) {
            settings = recovered;
        }
    }

    const validStorageKeys: string[] = Object.values(StorageKeys);
    const filteredSettings: Settings = {};
    for (const [key, value] of Object.entries(settings)) {
        if (validStorageKeys.includes(key)) {
            assignSettingValue(filteredSettings, key as StorageKey, value);
        }
    }
    return _applyMigrationsAndDecrypt(filteredSettings);
}
```

`tryRestoreFromBackup()`ヘルパーを新設する:

```typescript
/**
 * Find the most recent legacy_settings_backup_* entry and return its data
 * as a Settings-shaped object. Returns null if no backup exists.
 */
async function tryRestoreFromBackup(): Promise<Settings | null> {
    const all = await chrome.storage.local.get(null);
    const backupKeys = Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
    if (backupKeys.length === 0) return null;

    // Most recent backup wins (keys are suffixed with Date.now())
    backupKeys.sort().reverse();
    const latest = all[backupKeys[0]] as { data: Record<string, unknown>; createdAt: number } | undefined;
    if (!latest?.data) return null;

    const restored: Settings = {};
    for (const [key, value] of Object.entries(latest.data)) {
        if (Object.values(StorageKeys).includes(key as StorageKey)) {
            assignSettingValue(restored, key as StorageKey, value);
        }
    }

    // Persist the recovered settings back so future getSettings() calls
    // don't need to re-scan backups.
    await withOptimisticLock('settings', (current: Settings) => ({ ...current, ...restored }));

    return restored;
}
```

- [ ] **Step 3: テストを実行し通過を確認する**

```bash
npm test -- settingsStore
```

Expected: PASS

---

## Task 3: dailyPurgeHandler.tsへのバックアップ保持期限クリーンアップ統合

**Files:**
- Modify: `src/background/dailyPurgeHandler.ts`
- Modify: `src/background/__tests__/dailyPurgeHandler.test.ts`

- [ ] **Step 1: 既存の`handleDailyPurgeAlarm`のテストを確認する**

```bash
cat src/background/__tests__/dailyPurgeHandler.test.ts
```

- [ ] **Step 2: 失敗するテストを追加する**

```typescript
it('removes legacy_settings_backup_* entries older than 30 days', async () => {
  const now = Date.now();
  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys: unknown) => {
          if (keys === null) {
            return Promise.resolve({
              [`legacy_settings_backup_${now - THIRTY_ONE_DAYS_MS}`]: { data: {}, createdAt: now - THIRTY_ONE_DAYS_MS },
              [`legacy_settings_backup_${now - 1000}`]: { data: {}, createdAt: now - 1000 },
            });
          }
          return Promise.resolve({});
        }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as typeof chrome;

  const { cleanupExpiredSettingsBackups } = await import('../../utils/storage/settingsStore.js');
  await cleanupExpiredSettingsBackups();

  expect(chrome.storage.local.remove).toHaveBeenCalledWith([`legacy_settings_backup_${now - THIRTY_ONE_DAYS_MS}`]);
});
```

Run: `npm test -- dailyPurgeHandler`
Expected: FAIL（`cleanupExpiredSettingsBackups`が存在しない）

- [ ] **Step 3: `settingsStore.ts`に`cleanupExpiredSettingsBackups()`を実装する**

```typescript
// src/utils/storage/settingsStore.ts
/**
 * Remove legacy_settings_backup_* entries older than BACKUP_RETENTION_DAYS.
 * Called from dailyPurgeHandler.ts's existing chrome.alarms-based cycle.
 */
export async function cleanupExpiredSettingsBackups(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expiredKeys = Object.keys(all).filter((k) => {
        if (!k.startsWith(LEGACY_SETTINGS_BACKUP_KEY)) return false;
        const entry = all[k] as { createdAt?: number } | undefined;
        return typeof entry?.createdAt === 'number' && entry.createdAt < cutoff;
    });
    if (expiredKeys.length > 0) {
        await chrome.storage.local.remove(expiredKeys);
    }
}
```

- [ ] **Step 4: `dailyPurgeHandler.ts`の`handleDailyPurgeAlarm`から呼び出す**

```typescript
// src/background/dailyPurgeHandler.ts
import { cleanupExpiredSettingsBackups } from '../utils/storage/settingsStore.js';

export async function handleDailyPurgeAlarm(
  purgeOldRecords: PurgeFn,
  purgeContent?: ContentPurgeFn,
): Promise<void> {
    try {
        // ... 既存のレコード/コンテンツpurge処理 ...

        // PBI-15: clean up expired settings migration backups
        await cleanupExpiredSettingsBackups();
    } catch (error) {
        logError('daily-purge failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'dailyPurgeHandler');
    }
}
```

- [ ] **Step 5: テストを実行し通過を確認する**

```bash
npm test -- dailyPurgeHandler settingsStore
```

Expected: PASS

---

## 全体検証

- [ ] `npm run type-check` が成功する
- [ ] `npm test` で全テストがパスする（マイグレーション・復元・クリーンアップの一連のフローを通しで確認）
- [ ] `npm run build` が成功する
- [ ] `pbi/00-INDEX.md` の該当行を更新する

## コミット方針

Task単位で個別コミットする:
1. `fix(storage): settings移行時の即時削除をバックアップ退避に変更`（Task 1）
2. `fix(storage): getSettingsにバックアップからの復元ロジックを追加`（Task 2）
3. `feat(background): 設定バックアップの保持期限クリーンアップをdailyPurgeHandlerに統合`（Task 3）

## PBI-13との関係（着手時の注意）

対象storageキーが異なる（本PBIは`settings`、PBI-13は`savedUrlsWithTimestamps`）ため直接の競合はないが、両者とも`withOptimisticLock`ユーティリティに触れる。並行実装する場合、`withOptimisticLock`自体への変更は行わないため大きな問題にはならないが、マージ時に両PBIの差分が同じファイル（`optimisticLock.ts`のテスト等）に近い箇所で発生する可能性がある点に留意する。
