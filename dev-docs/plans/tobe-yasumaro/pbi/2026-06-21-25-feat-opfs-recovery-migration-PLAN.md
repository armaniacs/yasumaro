# PBI-25: OPFS 復旧時の自動マイグレーション 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OPFS が利用可能になった際に、`chrome.storage.local` フォールバックのデータを SQLite に自動移行する

**Architecture:** 既存の `migrationService.ts` を拡張し、OPFS→SQLite パスを追加する。起動時に `OPFS_FALLBACK_MODE` フラグをチェックし、OPFS が利用可能になった場合はフォールバックデータを SQLite に変換する。移行完了後にフラグをクリアする。

**Tech Stack:** TypeScript, Chrome Storage API, @subframe7536/sqlite-wasm, Vitest

---

## ファイル構成

| ファイル | 役割 | 変更種別 |
|---------|------|---------|
| `src/background/migrationService.ts` | OPFS→SQLite 移行パスを追加 | 変更 |
| `src/offscreen/sqlite.ts` | `migrateFromFallback()` 関数追加 | 変更 |
| `src/background/service-worker.ts` | 起動時 OPFS 検出＋移行トリガー | 変更 |
| `src/background/__tests__/migrationService-opfs.test.ts` | OPFS 移行テスト | 新規 |

---

## 現状の問題点

1. `migrationService.ts` は `chrome.storage.local` → SQLite のみ対応（OPFS パスなし）
2. `OPFS_FALLBACK_MODE` フラグは `sqlite.ts` で設定/クリアされるが、復旧時の自動移行が実装されていない
3. `tryMigrateFallbackToSqlite()` は IDB→SQLite パスのみ（OPFS 復旧対応なし）
4. OPFS 復旧時にフォールバックデータが SQLite に移行されないままになる

---

### Task 1: migrationService.ts に OPFS 復旧検出ロジックを追加

**Files:**
- Modify: `src/background/migrationService.ts`

- [ ] **Step 1: テストを書く — OPFS 復旧時の検出**

```typescript
// src/background/__tests__/migrationService-opfs.test.ts を新規作成
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationService } from '../migrationService';

describe('MigrationService - OPFS Recovery', () => {
  let migrationService: MigrationService;
  let mockSqliteClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteClient = {
      getCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
      insertBatch: vi.fn().mockResolvedValue({ success: true, inserted: 0 }),
      getStatus: vi.fn().mockResolvedValue({ success: true, usingOpfs: true }),
    };
    migrationService = new MigrationService(mockSqliteClient);
  });

  it('should detect OPFS recovery scenario', async () => {
    // OPFS フォールバックモード中
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === StorageKeys.YASUMARO_MIGRATION_STATUS) {
        return Promise.resolve({ [StorageKeys.YASUMARO_MIGRATION_STATUS]: 'completed' });
      }
      return Promise.resolve({});
    });

    // OPFS が利用可能に
    mockSqliteClient.getStatus.mockResolvedValue({
      success: true,
      usingOpfs: true,
      initialized: true,
    });

    const shouldMigrate = await migrationService.needsOpfsRecoveryMigration();

    expect(shouldMigrate).toBe(true);
  });

  it('should not trigger when already using OPFS', async () => {
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({}); // フラグなし
      }
      return Promise.resolve({});
    });

    const shouldMigrate = await migrationService.needsOpfsRecoveryMigration();

    expect(shouldMigrate).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/background/__tests__/migrationService-opfs.test.ts`
Expected: FAIL (needsOpfsRecoveryMigration が未定義)

- [ ] **Step 3: needsOpfsRecoveryMigration メソッドを追加**

```typescript
// src/background/migrationService.ts に追加

/**
 * OPFS 復旧時のマイグレーションが必要かチェック
 * - OPFS_FALLBACK_MODE が true
 * - SQLite が OPFS で初期化済み
 * - フォールバックデータが存在する
 */
async needsOpfsRecoveryMigration(): Promise<boolean> {
  try {
    // 1. フォールバックモードかチェック
    const fallbackResult = await chrome.storage.local.get(StorageKeys.OPFS_FALLBACK_MODE);
    const isFallbackMode = fallbackResult[StorageKeys.OPFS_FALLBACK_MODE] === true;

    if (!isFallbackMode) {
      return false;
    }

    // 2. SQLite が OPFS で利用可能かチェック
    const statusResult = await this.sqliteClient.getStatus();
    if (!statusResult.success || !statusResult.usingOpfs) {
      return false;
    }

    // 3. フォールバックデータが存在するかチェック
    const dataResult = await chrome.storage.local.get('yasumaro_fallback_storage_data');
    const fallbackData = dataResult['yasumaro_fallback_storage_data'];

    if (!fallbackData || !Array.isArray(fallbackData) || fallbackData.length === 0) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('OPFS recovery check failed:', error);
    return false;
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/background/__tests__/migrationService-opfs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/migrationService.ts src/background/__tests__/migrationService-opfs.test.ts
git commit -m "feat(migration): add OPFS recovery detection"
```

---

### Task 2: migrationService.ts に OPFS→SQLite 移行メソッドを追加

**Files:**
- Modify: `src/background/migrationService.ts`

- [ ] **Step 1: テストを書く — OPFS→SQLite 移行**

```typescript
// src/background/__tests__/migrationService-opfs.test.ts に追加

describe('migrateOpfsRecovery', () => {
  it('should migrate fallback data to SQLite and clear flag', async () => {
    const fallbackRecords = [
      { url: 'https://example.com', created_at: 1234567890, title: 'Test' },
      { url: 'https://test.com', created_at: 1234567891, title: 'Test 2' },
    ];

    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': fallbackRecords });
      }
      return Promise.resolve({});
    });

    mockSqliteClient.insertBatch.mockResolvedValue({
      success: true,
      inserted: 2,
      skipped: 0,
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(true);
    expect(result.migrated).toBe(2);

    // フラグがクリアされること
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        [StorageKeys.OPFS_FALLBACK_MODE]: false,
      })
    );
  });

  it('should handle errors without losing data', async () => {
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': [{ url: 'test' }] });
      }
      return Promise.resolve({});
    });

    mockSqliteClient.insertBatch.mockResolvedValue({
      success: false,
      error: 'Insert failed',
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(false);
    // フラグがクリアされないこと（リトライ可能）
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({
        [StorageKeys.OPFS_FALLBACK_MODE]: false,
      })
    );
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/background/__tests__/migrationService-opfs.test.ts`
Expected: FAIL (migrateOpfsRecovery が未定義)

- [ ] **Step 3: migrateOpfsRecovery メソッドを追加**

```typescript
// src/background/migrationService.ts に追加

interface OpfsRecoveryResult {
  success: boolean;
  migrated: number;
  skipped: number;
  error?: string;
}

/**
 * OPFS 復旧時にフォールバックデータを SQLite に移行
 */
async migrateOpfsRecovery(): Promise<OpfsRecoveryResult> {
  const BATCH_SIZE = 100;
  let totalMigrated = 0;
  let totalSkipped = 0;

  try {
    // フォールバックデータを取得
    const dataResult = await chrome.storage.local.get('yasumaro_fallback_storage_data');
    const fallbackData = dataResult['yasumaro_fallback_storage_data'] as any[];

    if (!fallbackData || !Array.isArray(fallbackData) || fallbackData.length === 0) {
      return { success: true, migrated: 0, skipped: 0 };
    }

    console.log(`[OPFS Recovery] Migrating ${fallbackData.length} records from fallback`);

    // バッチ単位で SQLite にインポート
    for (let i = 0; i < fallbackData.length; i += BATCH_SIZE) {
      const batch = fallbackData.slice(i, i + BATCH_SIZE);

      // レコード形式を変換
      const records = batch.map((item: any) => ({
        url: item.url,
        title: item.title || '',
        summary: item.summary || '',
        tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
        created_at: item.created_at,
        domain: item.domain || null,
        visit_duration: item.visit_duration || null,
        scroll_ratio: item.scroll_ratio || null,
        is_starred: item.is_starred || 0,
        is_deleted: item.is_deleted || 0,
        obsidian_synced: item.obsidian_synced || 0,
      }));

      const insertResult = await this.sqliteClient.insertBatch(records);

      if (!insertResult.success) {
        console.error(`[OPFS Recovery] Batch insert failed at offset ${i}:`, insertResult.error);
        return {
          success: false,
          migrated: totalMigrated,
          skipped: totalSkipped,
          error: insertResult.error as string,
        };
      }

      totalMigrated += (insertResult.inserted as number) || 0;
      totalSkipped += (insertResult.skipped as number) || 0;

      // 進捗を記録
      await chrome.storage.local.set({
        [StorageKeys.YASUMARO_MIGRATION_PROGRESS]: totalMigrated,
      });
    }

    // 移行完了 — フラグをクリア
    await chrome.storage.local.set({
      [StorageKeys.OPFS_FALLBACK_MODE]: false,
    });

    // フォールバックデータを削除
    await chrome.storage.local.remove('yasumaro_fallback_storage_data');

    console.log(`[OPFS Recovery] Migration complete: ${totalMigrated} migrated, ${totalSkipped} skipped`);

    return {
      success: true,
      migrated: totalMigrated,
      skipped: totalSkipped,
    };
  } catch (error) {
    console.error('[OPFS Recovery] Migration failed:', error);
    return {
      success: false,
      migrated: totalMigrated,
      skipped: totalSkipped,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/background/__tests__/migrationService-opfs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/migrationService.ts src/background/__tests__/migrationService-opfs.test.ts
git commit -m "feat(migration): add OPFS recovery migration method"
```

---

### Task 3: service-worker.ts に起動時 OPFS 復旧トリガーを追加

**Files:**
- Modify: `src/background/service-worker.ts:76-95` (init 関数)

- [ ] **Step 1: テストを書く — 起動時トリガー**

```typescript
// src/background/__tests__/service-worker-opfs-recovery.test.ts を新規作成
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Service Worker - OPFS Recovery Trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger OPFS recovery migration on startup when conditions met', async () => {
    const mockMigrationService = {
      needsOpfsRecoveryMigration: vi.fn().mockResolvedValue(true),
      migrateOpfsRecovery: vi.fn().mockResolvedValue({
        success: true,
        migrated: 10,
        skipped: 0,
      }),
    };

    // init 関数をモック
    await init(mockMigrationService);

    expect(mockMigrationService.needsOpfsRecoveryMigration).toHaveBeenCalled();
    expect(mockMigrationService.migrateOpfsRecovery).toHaveBeenCalled();
  });

  it('should not trigger when not in fallback mode', async () => {
    const mockMigrationService = {
      needsOpfsRecoveryMigration: vi.fn().mockResolvedValue(false),
      migrateOpfsRecovery: vi.fn(),
    };

    await init(mockMigrationService);

    expect(mockMigrationService.needsOpfsRecoveryMigration).toHaveBeenCalled();
    expect(mockMigrationService.migrateOpfsRecovery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/background/__tests__/service-worker-opfs-recovery.test.ts`
Expected: FAIL (OPFS 復旧ロジックが未実装)

- [ ] **Step 3: init 関数に OPFS 復旧トリガーを追加**

```typescript
// src/background/service-worker.ts の init 関数を修正

export async function init(
  migrationServiceOverride?: MigrationService
): Promise<void> {
  // 1. 設定移行
  runMigration();

  // 2. データ移行: chrome.storage.local → SQLite
  const migrationServiceInstance = migrationServiceOverride || migrationService;
  await migrationServiceInstance.run().catch((error) => {
    console.error('Migration failed:', error);
  });

  // 3. OPFS 復旧マイグレーション
  try {
    const needsOpfsRecovery = await migrationServiceInstance.needsOpfsRecoveryMigration();
    if (needsOpfsRecovery) {
      console.log('[ServiceWorker] OPFS recovery migration triggered');
      const recoveryResult = await migrationServiceInstance.migrateOpfsRecovery();
      if (recoveryResult.success) {
        console.log(`[ServiceWorker] OPFS recovery complete: ${recoveryResult.migrated} records`);
      } else {
        console.error('[ServiceWorker] OPFS recovery failed:', recoveryResult.error);
      }
    }
  } catch (error) {
    console.error('[ServiceWorker] OPFS recovery check failed:', error);
  }

  // 4. セッションアラーム
  initializeSessionAlarms();

  // 5. 日次パージアラーム
  chrome.alarms.create('yasumaro-daily-purge', { periodInMinutes: 1440 });
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/background/__tests__/service-worker-opfs-recovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/service-worker.ts src/background/__tests__/service-worker-opfs-recovery.test.ts
git commit -m "feat(service-worker): add OPFS recovery trigger on startup"
```

---

### Task 4: sqlite.ts にフォールバックデータ移行関数を追加

**Files:**
- Modify: `src/offscreen/sqlite.ts`

- [ ] **Step 1: テストを書く — フォールバックデータの変換**

```typescript
// src/offscreen/__tests__/sqlite-fallback-migration.test.ts を新規作成
import { describe, it, expect, vi } from 'vitest';
import { convertFallbackRecord } from '../sqlite';

describe('convertFallbackRecord', () => {
  it('should convert legacy format to BrowsingLogRecord', () => {
    const legacy = {
      url: 'https://example.com',
      timestamp: 1234567890,
      tags: ['tag1', 'tag2'],
      aiSummary: 'Test summary',
    };

    const result = convertFallbackRecord(legacy);

    expect(result.url).toBe('https://example.com');
    expect(result.created_at).toBe(1234567890);
    expect(result.tags).toBe('tag1, tag2');
    expect(result.summary).toBe('Test summary');
  });

  it('should handle missing fields gracefully', () => {
    const legacy = {
      url: 'https://example.com',
      created_at: 1234567890,
    };

    const result = convertFallbackRecord(legacy);

    expect(result.url).toBe('https://example.com');
    expect(result.title).toBe('');
    expect(result.summary).toBe('');
    expect(result.tags).toBe('');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/offscreen/__tests__/sqlite-fallback-migration.test.ts`
Expected: FAIL (convertFallbackRecord が未定義)

- [ ] **Step 3: convertFallbackRecord 関数を追加**

```typescript
// src/offscreen/sqlite.ts に追加

/**
 * フォールバックデータを BrowsingLogRecord 形式に変換
 */
export function convertFallbackRecord(item: any): {
  url: string;
  title: string;
  summary: string;
  tags: string;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
  is_deleted: number;
  obsidian_synced: number;
} {
  return {
    url: item.url || '',
    title: item.title || '',
    summary: item.summary || item.aiSummary || '',
    tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
    created_at: item.created_at || item.timestamp || Date.now(),
    domain: item.domain || null,
    visit_duration: item.visit_duration || null,
    scroll_ratio: item.scroll_ratio || null,
    is_starred: item.is_starred || 0,
    is_deleted: item.is_deleted || 0,
    obsidian_synced: item.obsidian_synced || 0,
  };
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/offscreen/__tests__/sqlite-fallback-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/sqlite.ts src/offscreen/__tests__/sqlite-fallback-migration.test.ts
git commit -m "feat(sqlite): add fallback record conversion function"
```

---

### Task 5: 統合テストとエッジケース

**Files:**
- Modify: `src/background/__tests__/migrationService-opfs.test.ts`

- [ ] **Step 1: エッジケーステストを追加**

```typescript
// src/background/__tests__/migrationService-opfs.test.ts に追加

describe('OPFS Recovery - Edge Cases', () => {
  it('should handle empty fallback data array', async () => {
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': [] });
      }
      return Promise.resolve({});
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(true);
    expect(result.migrated).toBe(0);
  });

  it('should handle corrupted fallback data', async () => {
    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': 'invalid' });
      }
      return Promise.resolve({});
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(true);
    expect(result.migrated).toBe(0);
  });

  it('should handle partial batch failure', async () => {
    const largeData = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example.com/${i}`,
      created_at: 1234567890 + i,
    }));

    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': largeData });
      }
      return Promise.resolve({});
    });

    // 2 バッチ目で失敗
    let callCount = 0;
    mockSqliteClient.insertBatch.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({ success: false, error: 'Batch 2 failed' });
      }
      return Promise.resolve({ success: true, inserted: 100, skipped: 0 });
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(false);
    expect(result.migrated).toBe(100); // 1 バッチ目のみ
    expect(result.error).toContain('Batch 2 failed');
  });

  it('should preserve data integrity during migration', async () => {
    const records = [
      {
        url: 'https://example.com',
        title: 'Test Title',
        summary: 'Test Summary',
        tags: ['tag1', 'tag2'],
        created_at: 1234567890,
        is_starred: 1,
      },
    ];

    chrome.storage.local.get.mockImplementation((key) => {
      if (key === StorageKeys.OPFS_FALLBACK_MODE) {
        return Promise.resolve({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
      }
      if (key === 'yasumaro_fallback_storage_data') {
        return Promise.resolve({ 'yasumaro_fallback_storage_data': records });
      }
      return Promise.resolve({});
    });

    mockSqliteClient.insertBatch.mockImplementation((batch) => {
      // インポートされたレコードを検証
      expect(batch[0].url).toBe('https://example.com');
      expect(batch[0].tags).toBe('tag1, tag2');
      expect(batch[0].is_starred).toBe(1);
      return Promise.resolve({ success: true, inserted: 1, skipped: 0 });
    });

    const result = await migrationService.migrateOpfsRecovery();

    expect(result.success).toBe(true);
    expect(result.migrated).toBe(1);
  });
});
```

- [ ] **Step 2: テストを実行してパスを確認**

Run: `npx vitest run src/background/__tests__/migrationService-opfs.test.ts`
Expected: PASS

- [ ] **Step 3: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/__tests__/migrationService-opfs.test.ts
git commit -m "test(migration): add OPFS recovery edge case tests"
```

---

## Definition of Done

- [ ] `needsOpfsRecoveryMigration()` が OPFS 復旧状態を正しく検出する
- [ ] `migrateOpfsRecovery()` がフォールバックデータを SQLite に移行する
- [ ] 移行完了後に `OPFS_FALLBACK_MODE` フラグがクリアされる
- [ ] エラー発生時もデータが失われない（フラグが維持される）
- [ ] 起動時に自動的に OPFS 復旧トリガーが実行される
- [ ] 大きなデータでもバッチ処理で動作する
- [ ] 既存のマイグレーション動作が壊れない
- [ ] 全テストがパスする
