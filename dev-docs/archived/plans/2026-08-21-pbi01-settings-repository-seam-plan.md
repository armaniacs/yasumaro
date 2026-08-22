# SettingsRepository Seam — Minimal Changes Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** SettingsRepository の `set()` / `setAll()` を adapter を経由する形に修正し、storage seam を完了させる。

**Architecture:** `set()` / `setAll()` が直接 `chrome.storage.local.set()` を呼ぶ代わりに `saveSettings()` に委譲する。これにより暗号化・楽観的ロック・キャッシュ無効化が自動適用され、adapter の迂回が解消される。新規ファイル・大規模な呼出元移行は不要。

**Tech Stack:** TypeScript, Vitest, Chrome Storage API

---

## 変更の概要

| 項目 | 値 |
|------|-----|
| 変更対象ファイル | 1 (`SettingsRepository.ts`) |
| 変更行数 | ~8 行 (差分) |
| 新規ファイル | 0 |
| 呼出元の変更 | 0 (API シグネチャ変更なし) |
| Effort | 0.5pt (1-2 時間) |

---

## 現状の問題

`SettingsRepository.ts:109-118` の `set()` / `setAll()` が `chrome.storage.local.set()` を直接呼び出し、`StorageAdapter` を迂回している。

```typescript
// 現状 (bypass)
async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = (await getSettings()) as Record<string, unknown>;
    current[key as string] = value;
    await chrome.storage.local.set({ settings: current });  // ← adapter bypass
}
```

これにより:
1. API キーの暗号化がスキップされる
2. 楽観的ロック (`withOptimisticLock`) が適用されない
3. キャッシュ無効化 (`cachedSettings = null`) がされない
4. `adapter.set()` が呼ばれないため、InMemory adapter でのテストが不可能

---

## Task 1: `set()` / `setAll()` を `saveSettings()` に委譲

**Files:**
- Modify: `src/utils/storage/SettingsRepository.ts:109-119`

- [x] **Step 1: `saveSettings` の import を追加**

```typescript
// 変更前 (line 23)
import { getSettings } from './settingsStore.js';

// 変更後
import { getSettings, saveSettings } from './settingsStore.js';
```

- [x] **Step 2: `set()` メソッドを修正**

```typescript
// 変更前 (lines 109-113)
async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = (await getSettings()) as Record<string, unknown>;
    current[key as string] = value;
    await chrome.storage.local.set({ settings: current });
}

// 変更後
async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = await getSettings();
    await saveSettings({ ...current, [key]: value } as SettingsType);
}
```

- [x] **Step 3: `setAll()` メソッドを修正**

```typescript
// 変更前 (lines 115-119)
async setAll(settings: Partial<SettingsType>): Promise<void> {
    const current = (await getSettings()) as Record<string, unknown>;
    Object.assign(current, settings);
    await chrome.storage.local.set({ settings: current });
}

// 変更後
async setAll(settings: Partial<SettingsType>): Promise<void> {
    const current = await getSettings();
    await saveSettings({ ...current, ...settings } as SettingsType);
}
```

- [x] **Step 4: テストを実行して既存テストがパスすることを確認**

Run: `npx vitest run src/utils/storage/__tests__/`
Expected: All pass

- [x] **Step 5: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: コミット**（コミット済み: `SettingsRepository.ts` は既に `saveSettings` を使用する状態で committed）

---

## Task 2: SettingsRepository のユニットテストを追加

**Files:**
- Create: `src/utils/storage/__tests__/SettingsRepository.test.ts`

- [x] **Step 1: テストファイルを作成**（`src/utils/storage/__tests__/SettingsRepository.test.ts` が既に存在、10 テスト全 pass）

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';
import { StorageKeys } from '../types.js';

vi.mock('../../logger.js', () => ({
    logInfo: vi.fn(() => Promise.resolve()),
    logWarn: vi.fn(() => Promise.resolve()),
    logError: vi.fn(() => Promise.resolve()),
    logDebug: vi.fn(() => Promise.resolve()),
    logSanitize: vi.fn(() => Promise.resolve()),
    ErrorCode: {
        INTERNAL_ERROR: 'INT_001',
        API_REQUEST_FAILURE: 'API_REQ_001',
        CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
        CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
        CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
        STORAGE_QUOTA_EXCEEDED: 'STO_001',
        STORAGE_WRITE_FAILURE: 'STO_003',
    },
}));

describe('SettingsRepository', () => {
    let storageData: Record<string, unknown>;

    beforeEach(() => {
        vi.clearAllMocks();
        storageData = {
            settings: {
                [StorageKeys.AI_PROVIDER]: 'gemini',
                [StorageKeys.OBSIDIAN_API_KEY]: '',
                [StorageKeys.MIN_VISIT_DURATION]: 30,
            },
            settings_migrated: true,
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
                    set: vi.fn((obj: Record<string, unknown>) => {
                        Object.assign(storageData, obj);
                        return Promise.resolve();
                    }),
                },
                onChanged: {
                    addListener: vi.fn(),
                },
            },
        } as unknown as typeof chrome;
    });

    it('get() returns settings from settingsStore', async () => {
        const repo = new SettingsRepository();
        const provider = await repo.get(StorageKeys.AI_PROVIDER);
        expect(provider).toBe('gemini');
    });

    it('getAll() returns full settings object', async () => {
        const repo = new SettingsRepository();
        const all = await repo.getAll();
        expect(all[StorageKeys.AI_PROVIDER]).toBe('gemini');
    });

    it('set() persists via saveSettings (not direct chrome.storage.local.set)', async () => {
        const repo = new SettingsRepository();
        await repo.set(StorageKeys.MIN_VISIT_DURATION, 60);

        // saveSettings uses withOptimisticLock which calls chrome.storage.local.set
        // Verify the value was persisted
        const updated = await repo.get(StorageKeys.MIN_VISIT_DURATION);
        expect(updated).toBe(60);
    });

    it('setAll() merges and persists settings', async () => {
        const repo = new SettingsRepository();
        await repo.setAll({ [StorageKeys.MIN_VISIT_DURATION]: 120 });

        const all = await repo.getAll();
        expect(all[StorageKeys.MIN_VISIT_DURATION]).toBe(120);
        expect(all[StorageKeys.AI_PROVIDER]).toBe('gemini');
    });
});
```

- [x] **Step 2: テストを実行**（全 10 テスト pass 確認済み）

Run: `npx vitest run src/utils/storage/__tests__/SettingsRepository.test.ts`
Expected: All pass

- [x] **Step 3: コミット**（テストファイルは既に committed）

```bash
git add src/utils/storage/__tests__/SettingsRepository.test.ts
git commit -m "test: add SettingsRepository unit tests"
```

---

## 変更後の SettingsRepository.ts (完全版)

```typescript
/**
 * SettingsRepository — deep module hiding the 30 scattered StorageKeys accesses
 * ... (既存コメントはそのまま) ...
 */

import type { StorageKey, Settings as SettingsType } from './types.js';
import { getSettings, saveSettings } from './settingsStore.js';

export interface StorageAdapter {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
}

class ChromeStorageAdapter implements StorageAdapter {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  }
  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const local: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) local[k] = (v as { newValue: unknown }).newValue;
      callback(local);
    });
  }
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>();
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = v;
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) if (this.store.has(k)) result[k] = this.store.get(k);
      return result;
    }
    if (typeof keys === 'string') {
      return this.store.has(keys) ? { [keys]: this.store.get(keys) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
    for (const cb of this.listeners) cb(items);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.listeners.push(callback);
  }

  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
  }
}

/**
 * Deep repository: one seam, typed keys, defaults + validation inside.
 * chrome.storage is an internal adapter, not part of the public interface.
 */
export class SettingsRepository {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter = new ChromeStorageAdapter()) {
    this.adapter = adapter;
  }

  async get<K extends StorageKey>(key: K): Promise<SettingsType[K]> {
    const settings = (await getSettings()) as SettingsType;
    return settings[key];
  }

  async getAll(): Promise<SettingsType> {
    return (await getSettings()) as SettingsType;
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = await getSettings();
    await saveSettings({ ...current, [key]: value } as SettingsType);
  }

  async setAll(settings: Partial<SettingsType>): Promise<void> {
    const current = await getSettings();
    await saveSettings({ ...current, ...settings } as SettingsType);
  }

  onChange(callback: (changes: Partial<SettingsType>) => void): void {
    this.adapter.onChanged?.((changes) => {
      if ('settings' in changes) {
        callback(changes['settings'] as Partial<SettingsType>);
      }
    });
  }
}

export const settingsRepository = new SettingsRepository();
```

---

## トレードオフ

| トレードオフ | 説明 |
|-------------|------|
| **adapter は set 経路では実質未使用** | `set()` / `setAll()` は `saveSettings()` → `chrome.storage.local.set()` と続く。adapter は `get()` / `onChange()` でのみ使われる。将来的に `saveSettings` 側も adapter 化する必要があるが、2pt では収まらない |
| **暗号化が自動適用される** | 利点だが、既存の呼び出しが暗号化なしを意図していた場合に副作用の可能性。現在の呼び出元を確認した範囲では問題なし |
| **`saveSettings()` がキャッシュをクリアする** | `saveSettings()` 内で `cachedSettings = null` が呼ばれる。連続的な set 操作で read-after-write のキャッシュヒットが減るが、1秒 TTL なので実質影響なし |
| **27 ファイルの barrel 移行は未実施** | バルは `@deprecated` のまま残置。今回のスコープ外（2pt に収めるため） |

---

## リスク

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| `saveSettings` が `ensureStorageQuota` を呼ぶ | quota 超過時にエラーが投げられる | 既存の `saveSettings` 呼び出しと同じ挙動。 callers は try-catch で処理済み |
| `saveSettings` が `withOptimisticLock` を使う | ロック競合時にリトライ | 既存の settingsStore 呼び出しと同じ。問題なし |
| `set()` の引数が `Partial<SettingsType>` になる | 現状は `SettingsType[K]` (単一値) | `{ ...current, [key]: value }` で full object を渡すため型安全。拡張の余地あり |
| settingsRepository が現在どこからも呼ばれていない | seam が完成しても呼び出元がない | PBI 05 (DOM side) で段階的に移行。今回のスコープは seam の完成のみ |
