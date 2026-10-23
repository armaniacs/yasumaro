/**
 * savedCollectionsRepository.test.ts
 *
 * Roundtrip tests for the saved-collections repository seam
 * (PBI 2026-10-23-02). The contract: save-then-read returns the same shape
 * that was written, and a corrupted store degrades to the valid subset
 * instead of throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
