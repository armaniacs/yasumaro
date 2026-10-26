// @layer 1 — Settings validation (no background imports)
/**
 * savedCollections.ts
 *
 * Normalizer for named saved collections (PBI 2026-10-23-06). Kept separate
 * from the defaults module so the settings pipeline can validate a stored
 * map without pulling the repository chain.
 *
 * 縮退の出口: unknown input fails closed to null, so a corrupted collection
 * is dropped from the list instead of poisoning the render or the save.
 */

export interface SavedCollection {
  id: string;
  name: string;
  query: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Normalize one stored collection; unknown input falls back to null. */
export function normalizeSavedCollection(id: unknown, raw: unknown): SavedCollection | null {
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const name = asString(record['name']);
  if (name === null) return null;
  const query =
    typeof record['query'] === 'object' && record['query'] !== null
      ? (record['query'] as Record<string, unknown>)
      : {};
  const createdAt = asNumber(record['createdAt']);
  if (createdAt === null) return null;
  const updatedAt = asNumber(record['updatedAt']) ?? createdAt;
  return { id, name, query, createdAt, updatedAt };
}

/** Normalize a stored map; corrupted entries are dropped from the result. */
export function normalizeSavedCollections(raw: unknown): Record<string, SavedCollection> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, SavedCollection> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeSavedCollection(id, entry);
    if (normalized !== null) out[id] = normalized;
  }
  return out;
}

/** Pure upsert: insert-or-rename one collection on the map (stamps updatedAt). */
export function upsertSavedCollection(
  map: Record<string, SavedCollection>,
  id: string,
  name: string,
  query: Record<string, unknown>,
  now: number,
): Record<string, SavedCollection> {
  const existing = map[id];
  const createdAt = existing ? existing.createdAt : now;
  return { ...map, [id]: { id, name, query, createdAt, updatedAt: now } };
}

/** Pure remove: drop one collection from the map (missing id is a no-op). */
export function removeSavedCollection(
  map: Record<string, SavedCollection>,
  id: string,
): Record<string, SavedCollection> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => key !== id));
}

/** Pure duplicate: copy one collection under a new id (missing id is a no-op). */
export function duplicateSavedCollection(
  map: Record<string, SavedCollection>,
  id: string,
  newId: string,
  name: string,
  now: number,
): Record<string, SavedCollection> {
  const source = map[id];
  if (!source || newId === '' || newId === id) return map;
  return { ...map, [newId]: { id: newId, name, query: source.query, createdAt: now, updatedAt: now } };
}
