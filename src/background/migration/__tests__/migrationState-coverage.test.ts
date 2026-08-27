import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChromeMigrationStateAdapter,
  InMemoryMigrationStateAdapter,
  MIGRATION_STATUS_KEY,
  MIGRATION_PROGRESS_KEY,
  MIGRATION_RETRY_COUNT_KEY,
} from '../migrationState.js';

describe('migrationState coverage', () => {
  describe('ChromeMigrationStateAdapter — chrome.storage.local.get 2パターン', () => {
    let adapter: ChromeMigrationStateAdapter;

    beforeEach(() => {
      adapter = new ChromeMigrationStateAdapter();
      // vitest.setup.ts の beforeEach で chrome.storage.local はクリア済み
      vi.clearAllMocks();
    });

    it('getStatus: storage undefined → null (falsy branch)', async () => {
      const result = await adapter.getStatus();
      expect(result).toBeNull();
      expect(chrome.storage.local.get).toHaveBeenCalledWith(MIGRATION_STATUS_KEY);
    });

    it('getStatus: storage has string value → returns string (truthy branch)', async () => {
      await chrome.storage.local.set({ [MIGRATION_STATUS_KEY]: 'completed' });
      vi.clearAllMocks();
      const result = await adapter.getStatus();
      expect(result).toBe('completed');
      expect(chrome.storage.local.get).toHaveBeenCalledWith(MIGRATION_STATUS_KEY);
    });

    it('setStatus: delegates to chrome.storage.local.set with correct key', async () => {
      await adapter.setStatus('pending');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [MIGRATION_STATUS_KEY]: 'pending' });
      // verify round-trip via mock storage
      expect(await adapter.getStatus()).toBe('pending');
    });

    it('setStatus: string variations (fresh_install, failed_permanently)', async () => {
      await adapter.setStatus('fresh_install');
      expect(await adapter.getStatus()).toBe('fresh_install');
      await adapter.setStatus('failed_permanently');
      expect(await adapter.getStatus()).toBe('failed_permanently');
    });

    it('getProgress: storage undefined → 0 (number falsy branch)', async () => {
      const result = await adapter.getProgress();
      expect(result).toBe(0);
      expect(chrome.storage.local.get).toHaveBeenCalledWith(MIGRATION_PROGRESS_KEY);
    });

    it('getProgress: storage has number → returns number (truthy branch)', async () => {
      await chrome.storage.local.set({ [MIGRATION_PROGRESS_KEY]: 42 });
      vi.clearAllMocks();
      const result = await adapter.getProgress();
      expect(result).toBe(42);
      // also verify string-like number handling — ensure 0 vs number distinction
      await chrome.storage.local.set({ [MIGRATION_PROGRESS_KEY]: 0 });
      // 0 is falsy so adapter returns 0 via || 0 — still 0
      expect(await adapter.getProgress()).toBe(0);
    });

    it('setProgress: delegates to chrome.storage.local.set', async () => {
      await adapter.setProgress(7);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [MIGRATION_PROGRESS_KEY]: 7 });
      expect(await adapter.getProgress()).toBe(7);
    });

    it('getRetryCount: storage undefined → 0 (falsy branch)', async () => {
      const result = await adapter.getRetryCount();
      expect(result).toBe(0);
      expect(chrome.storage.local.get).toHaveBeenCalledWith(MIGRATION_RETRY_COUNT_KEY);
    });

    it('getRetryCount: storage has number → returns number (truthy branch)', async () => {
      await chrome.storage.local.set({ [MIGRATION_RETRY_COUNT_KEY]: 3 });
      vi.clearAllMocks();
      const result = await adapter.getRetryCount();
      expect(result).toBe(3);
    });

    it('setRetryCount: delegates to chrome.storage.local.set', async () => {
      await adapter.setRetryCount(5);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [MIGRATION_RETRY_COUNT_KEY]: 5 });
      expect(await adapter.getRetryCount()).toBe(5);
    });

    it('progress/retryCount isolated keys', async () => {
      await adapter.setProgress(10);
      await adapter.setRetryCount(2);
      await adapter.setStatus('completed');
      expect(await adapter.getProgress()).toBe(10);
      expect(await adapter.getRetryCount()).toBe(2);
      expect(await adapter.getStatus()).toBe('completed');
    });
  });

  describe('InMemoryMigrationStateAdapter — 両 adapter でテスト', () => {
    let adapter: InMemoryMigrationStateAdapter;

    beforeEach(() => {
      adapter = new InMemoryMigrationStateAdapter();
    });

    it('initial values: null/0/0', async () => {
      expect(await adapter.getStatus()).toBeNull();
      expect(await adapter.getProgress()).toBe(0);
      expect(await adapter.getRetryCount()).toBe(0);
    });

    it('setStatus/getStatus round-trip for all MigrationStatus string variants', async () => {
      await adapter.setStatus('pending');
      expect(await adapter.getStatus()).toBe('pending');
      await adapter.setStatus('completed');
      expect(await adapter.getStatus()).toBe('completed');
      await adapter.setStatus('fresh_install');
      expect(await adapter.getStatus()).toBe('fresh_install');
      await adapter.setStatus('failed_permanently');
      expect(await adapter.getStatus()).toBe('failed_permanently');
    });

    it('setProgress/getProgress round-trip with number branches including 0 and large', async () => {
      await adapter.setProgress(0);
      expect(await adapter.getProgress()).toBe(0);
      await adapter.setProgress(1);
      expect(await adapter.getProgress()).toBe(1);
      await adapter.setProgress(999);
      expect(await adapter.getProgress()).toBe(999);
    });

    it('setRetryCount/getRetryCount round-trip with number branches', async () => {
      await adapter.setRetryCount(0);
      expect(await adapter.getRetryCount()).toBe(0);
      await adapter.setRetryCount(5);
      expect(await adapter.getRetryCount()).toBe(5);
      // string-like number coercion not applicable — InMemory stores as-is
    });

    it('isolated instances do not share state', async () => {
      const a = new InMemoryMigrationStateAdapter();
      const b = new InMemoryMigrationStateAdapter();
      await a.setStatus('completed');
      await a.setProgress(10);
      expect(await b.getStatus()).toBeNull();
      expect(await b.getProgress()).toBe(0);
    });

    it('implements MigrationStatePort contract (undefined handling)', async () => {
      // Adapter should handle overwriting values
      await adapter.setProgress(3);
      await adapter.setProgress(0);
      expect(await adapter.getProgress()).toBe(0);
      await adapter.setRetryCount(2);
      await adapter.setRetryCount(0);
      expect(await adapter.getRetryCount()).toBe(0);
    });
  });
});
