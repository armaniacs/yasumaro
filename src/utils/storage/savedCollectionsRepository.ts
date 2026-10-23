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
import { settingsRepository } from './SettingsRepository.js';
import {
  normalizeSavedCollections,
  removeSavedCollection,
  upsertSavedCollection,
  type SavedCollection,
} from './savedCollections.js';

export async function getSavedCollections(): Promise<Record<string, SavedCollection>> {
  try {
    const stored = await settingsRepository.get(StorageKeys.SAVED_COLLECTIONS);
    return normalizeSavedCollections(stored);
  } catch {
    return {};
  }
}

export async function saveSavedCollections(
  map: Record<string, SavedCollection>,
): Promise<void> {
  // The stored shape is Record<string, SavedCollection> (the strict per-key
  // literal type); the read side still normalizes, so a corrupted store
  // degrades to the valid subset instead of failing the panel.
  await settingsRepository.set(StorageKeys.SAVED_COLLECTIONS, map);
}

export async function upsertSavedCollectionById(
  id: string,
  name: string,
  query: Record<string, unknown>,
  now: number,
): Promise<void> {
  const current = await getSavedCollections();
  await saveSavedCollections(upsertSavedCollection(current, id, name, query, now));
}

export async function removeSavedCollectionById(id: string): Promise<void> {
  const current = await getSavedCollections();
  await saveSavedCollections(removeSavedCollection(current, id));
}
