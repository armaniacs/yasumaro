/**
 * savedCollectionsRepository.ts
 *
 * Repository seam for named saved collections (PBI 2026-10-23-06). Thin
 * functions over SettingsRepository: the read normalizes the stored map, the
 * write runs the pure upsert/remove and stamps updatedAt. The CAS budget
 * semantics ride the repository's own set() — this module owns no storage.
 *
 * 縮退の出口: a reader that throws falls back to an empty list, so a
 * corrupted store degrades to "no collections" instead of failing the panel.
 */

import { StorageKeys } from './types.js';
import { settingsRepository, type SettingsRepository } from './SettingsRepository.js';
import {
  normalizeSavedCollections,
  duplicateSavedCollection,
  removeSavedCollection,
  upsertSavedCollection,
  type SavedCollection,
} from './savedCollections.js';
import { errorMessage } from '../errorUtils.js';
import { logError } from '../logger/api.js';
import { ErrorCode } from '../logger/types.js';

/**
 * Minimal store seam: `get`/`set` are the only repository members this module
 * needs. Production callers omit it (the singleton is the factory default);
 * tests pass a real `SettingsRepository` over an in-memory port.
 */
export type SavedCollectionsStore = Pick<SettingsRepository, 'get' | 'set'>;

export async function getSavedCollections(
  repo: SavedCollectionsStore = settingsRepository,
): Promise<Record<string, SavedCollection>> {
  try {
    const stored = await repo.get(StorageKeys.SAVED_COLLECTIONS);
    return normalizeSavedCollections(stored);
  } catch (error) {
    void logError('[SavedCollections] read failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'savedCollectionsRepository');
    return {};
  }
}

export async function saveSavedCollections(
  map: Record<string, SavedCollection>,
  repo: SavedCollectionsStore = settingsRepository,
): Promise<void> {
  // The stored shape is Record<string, SavedCollection> (the strict per-key
  // literal type); the read side still normalizes, so a corrupted store
  // degrades to the valid subset instead of failing the panel.
  await repo.set(StorageKeys.SAVED_COLLECTIONS, map);
}

export async function upsertSavedCollectionById(
  id: string,
  name: string,
  query: Record<string, unknown>,
  now: number,
  repo: SavedCollectionsStore = settingsRepository,
): Promise<void> {
  const current = await getSavedCollections(repo);
  await saveSavedCollections(upsertSavedCollection(current, id, name, query, now), repo);
}

export async function removeSavedCollectionById(
  id: string,
  repo: SavedCollectionsStore = settingsRepository,
): Promise<void> {
  const current = await getSavedCollections(repo);
  await saveSavedCollections(removeSavedCollection(current, id), repo);
}

export async function duplicateSavedCollectionById(
  id: string,
  newId: string,
  name: string,
  now: number,
  repo: SavedCollectionsStore = settingsRepository,
): Promise<void> {
  const current = await getSavedCollections(repo);
  await saveSavedCollections(duplicateSavedCollection(current, id, newId, name, now), repo);
}
