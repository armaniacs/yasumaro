/**
 * savedCollectionsRepository.test.ts
 *
 * Roundtrip tests for the saved-collections repository seam
 * (PBI 2026-10-23-02). The contract: save-then-read returns the same shape
 * that was written, and a corrupted store degrades to the valid subset
 * instead of throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { logError } from '../../logger/api.js';
import { ErrorCode } from '../../logger/types.js';
import type { InMemoryStoragePort } from '../storagePort.js';
import { settingsRepository } from '../SettingsRepository.js';

vi.mock('../../logger/api.js', () => ({ logError: vi.fn(() => Promise.resolve()) }));

const backing = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  failNextGetWith: null as Error | null,
}));

vi.mock('../SettingsRepository.js', () => ({
  settingsRepository: {
    get: async (key: string): Promise<unknown> => {
      if (backing.failNextGetWith !== null) {
        const error = backing.failNextGetWith;
        backing.failNextGetWith = null;
        throw error;
      }
      return backing.store.get(key);
    },
    set: async (key: string, value: unknown): Promise<void> => {
      backing.store.set(key, value);
    },
  },
}));

import {
  getSavedCollections,
  saveSavedCollections,
  upsertSavedCollectionById,
  removeSavedCollectionById,
  type SavedCollectionsStore,
} from '../savedCollectionsRepository.js';
import { StorageKeys } from '../types.js';

describe('savedCollectionsRepository', () => {
  beforeEach(() => {
    backing.store.clear();
    backing.failNextGetWith = null;
  });

  describe('saveSavedCollections', () => {
    it('persists the written map so a later read returns it unchanged', async () => {
      const map = {
        c1: { id: 'c1', name: 'ML papers', query: { q: 'transformers' }, createdAt: 100, updatedAt: 200 },
      };

      await saveSavedCollections(map);

      expect(backing.store.get(StorageKeys.SAVED_COLLECTIONS)).toEqual(map);
      await expect(getSavedCollections()).resolves.toEqual(map);
    });

    it('keeps the serialized save shape byte-identical to the input', async () => {
      const map = {
        c1: { id: 'c1', name: 'ML papers', query: { q: 'x', starred: true }, createdAt: 100, updatedAt: 200 },
      };

      await saveSavedCollections(map);

      const stored = backing.store.get(StorageKeys.SAVED_COLLECTIONS);
      expect(JSON.stringify(stored)).toBe(JSON.stringify(map));
    });
  });

  describe('upsertSavedCollectionById', () => {
    it('inserts then renames through the repository seam', async () => {
      await upsertSavedCollectionById('c1', 'first', { q: 'x' }, 100);
      await upsertSavedCollectionById('c1', 'renamed', { q: 'x' }, 200);

      const result = await getSavedCollections();
      expect(result['c1']).toEqual({ id: 'c1', name: 'renamed', query: { q: 'x' }, createdAt: 100, updatedAt: 200 });
    });
  });

  describe('removeSavedCollectionById', () => {
    it('drops only the named collection', async () => {
      await upsertSavedCollectionById('c1', 'a', {}, 100);
      await upsertSavedCollectionById('c2', 'b', {}, 100);

      await removeSavedCollectionById('c1');

      const result = await getSavedCollections();
      expect(Object.keys(result)).toEqual(['c2']);
    });
  });

  describe('getSavedCollections', () => {
    it('degrades a non-map store to an empty map', async () => {
      backing.store.set(StorageKeys.SAVED_COLLECTIONS, ['not', 'a', 'map']);
      await expect(getSavedCollections()).resolves.toEqual({});
    });

    it('drops corrupted entries and keeps the valid ones', async () => {
      backing.store.set(StorageKeys.SAVED_COLLECTIONS, {
        ok: { name: 'kept', query: {}, createdAt: 1 },
        junk: 'not-an-object',
      });

      const result = await getSavedCollections();
      expect(Object.keys(result)).toEqual(['ok']);
    });

    it('falls back to an empty map when the reader throws', async () => {
      backing.failNextGetWith = new Error('storage boom');
      await expect(getSavedCollections()).resolves.toEqual({});
    });
  });
});

describe('savedCollectionsRepository (injected store seam)', () => {
  let repo: SavedCollectionsStore;
  let adapter: InMemoryStoragePort;

  beforeEach(async () => {
    await installTestSecretKek();
    const real = await vi.importActual<typeof import('../SettingsRepository.js')>('../SettingsRepository.js');
    const fresh = new real.InMemoryStorageAdapter();
    adapter = fresh;
    repo = new real.SettingsRepository(fresh);
    vi.mocked(logError).mockClear();
  });

  describe('saveSavedCollections', () => {
    it('roundtrips a saved map through the injected repository', async () => {
      const map = {
        c1: { id: 'c1', name: 'ML papers', query: { q: 'transformers' }, createdAt: 100, updatedAt: 200 },
      };

      await saveSavedCollections(map, repo);

      await expect(getSavedCollections(repo)).resolves.toEqual(map);
    });
  });

  describe('upsertSavedCollectionById', () => {
    it('inserts then renames through the injected repository', async () => {
      await upsertSavedCollectionById('c1', 'first', { q: 'x' }, 100, repo);
      await upsertSavedCollectionById('c1', 'renamed', { q: 'x' }, 200, repo);

      const result = await getSavedCollections(repo);
      expect(result['c1']).toEqual({ id: 'c1', name: 'renamed', query: { q: 'x' }, createdAt: 100, updatedAt: 200 });
    });
  });

  describe('removeSavedCollectionById', () => {
    it('drops only the named collection through the injected repository', async () => {
      await upsertSavedCollectionById('c1', 'a', {}, 100, repo);
      await upsertSavedCollectionById('c2', 'b', {}, 100, repo);

      await removeSavedCollectionById('c1', repo);

      const result = await getSavedCollections(repo);
      expect(Object.keys(result)).toEqual(['c2']);
    });
  });

  describe('getSavedCollections', () => {
    it('degrades a corrupted store to the valid subset', async () => {
      adapter.seed({
        [StorageKeys.SAVED_COLLECTIONS]: {
          ok: { name: 'kept', query: {}, createdAt: 1 },
          junk: 'not-an-object',
        },
      });

      const result = await getSavedCollections(repo);
      expect(Object.keys(result)).toEqual(['ok']);
    });

    it('falls back to an empty map and logs STORAGE_READ_FAILURE when the injected read throws', async () => {
      vi.spyOn(repo, 'get').mockRejectedValueOnce(new Error('storage boom'));

      await expect(getSavedCollections(repo)).resolves.toEqual({});
      expect(logError).toHaveBeenCalledWith(
        '[SavedCollections] read failed',
        { error: 'storage boom' },
        ErrorCode.STORAGE_READ_FAILURE,
        'savedCollectionsRepository',
      );
    });
  });
});

describe('savedCollectionsRepository (default path backed by real repository)', () => {
  let live: SavedCollectionsStore;
  let port: InMemoryStoragePort;

  beforeEach(async () => {
    await installTestSecretKek();
    const real = await vi.importActual<typeof import('../SettingsRepository.js')>('../SettingsRepository.js');
    const fresh = new real.InMemoryStorageAdapter();
    port = fresh;
    live = new real.SettingsRepository(fresh);
    settingsRepository.get = live.get.bind(live);
    settingsRepository.set = live.set.bind(live);
    vi.mocked(logError).mockClear();
  });

  it('roundtrips a saved map through the default path', async () => {
    const map = {
      c1: { id: 'c1', name: 'ML papers', query: { q: 'transformers' }, createdAt: 100, updatedAt: 200 },
    };

    await saveSavedCollections(map);

    await expect(getSavedCollections()).resolves.toEqual(map);
    await expect(live.get(StorageKeys.SAVED_COLLECTIONS)).resolves.toEqual(map);
  });

  it('upserts through the default path with production read-modify-write', async () => {
    await upsertSavedCollectionById('c1', 'first', { q: 'x' }, 100);
    await upsertSavedCollectionById('c1', 'renamed', { q: 'x' }, 200);

    await expect(getSavedCollections()).resolves.toEqual({
      c1: { id: 'c1', name: 'renamed', query: { q: 'x' }, createdAt: 100, updatedAt: 200 },
    });
  });

  it('degrades a corrupted store to the valid subset through the default path', async () => {
    port.seed({
      [StorageKeys.SAVED_COLLECTIONS]: {
        ok: { name: 'kept', query: {}, createdAt: 1 },
        junk: 'not-an-object',
      },
    });

    const result = await getSavedCollections();
    expect(Object.keys(result)).toEqual(['ok']);
    expect(result['ok']).toEqual({ id: 'ok', name: 'kept', query: {}, createdAt: 1, updatedAt: 1 });
  });

  it('falls back to an empty map and logs STORAGE_READ_FAILURE when the default read throws', async () => {
    vi.spyOn(settingsRepository, 'get').mockRejectedValueOnce(new Error('storage boom'));

    await expect(getSavedCollections()).resolves.toEqual({});
    expect(logError).toHaveBeenCalledWith(
      '[SavedCollections] read failed',
      { error: 'storage boom' },
      ErrorCode.STORAGE_READ_FAILURE,
      'savedCollectionsRepository',
    );
  });
});
