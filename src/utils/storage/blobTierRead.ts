/**
 * blobTierRead.ts — tier order for raw readers of keys the settings writers
 * now persist inside the `settings` blob.
 *
 * Contract (every raw reader of such a key must go through here):
 *   1. blob first: the blob is where the dashboard writes, so a value present
 *      in it (including `false` / `[]`) always wins.
 *   2. top-level fallback: only when the blob does not hold the key. A legacy
 *      profile that never folded still has its only copy at the top level, but
 *      a top-level copy next to a written blob can be stale and must not
 *      override it.
 */

/** Storage key of the settings blob; callers fetch it in the same read as the keys they resolve. */
export const SETTINGS_BLOB_STORAGE_KEY = 'settings';

/** Keys a raw-read result must carry so `readBlobFirst` can resolve a key. */
export function withBlobTierKeys(keys: readonly string[]): string[] {
    return [...keys, SETTINGS_BLOB_STORAGE_KEY];
}

export function readBlobFirst(result: Record<string, unknown>, key: string): unknown {
    const blob = result[SETTINGS_BLOB_STORAGE_KEY];
    if (blob !== null && typeof blob === 'object') {
        const fromBlob = (blob as Record<string, unknown>)[key];
        if (fromBlob !== undefined) return fromBlob;
    }
    return result[key];
}

function blobTierValuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Generation-skew detector for fail-closed reads. Returns true when the blob
 * holds a key whose top-level copy is also present but different: the two
 * copies come from different setting generations (for example the two-stage
 * domain-filter cache write landed the blob before the mirror). Callers fail
 * closed (block or useCache:false) instead of trusting the permissive side.
 * A missing copy on either side is not skew: legacy profiles have top-level
 * only, fresh writes may have blob only.
 */
export function hasBlobTopLevelSkew(result: Record<string, unknown>, keys: readonly string[]): boolean {
    const blob = result[SETTINGS_BLOB_STORAGE_KEY];
    if (blob === null || typeof blob !== 'object') return false;
    const record = blob as Record<string, unknown>;
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        if (!Object.prototype.hasOwnProperty.call(result, key)) continue;
        if (!blobTierValuesEqual(record[key], result[key])) return true;
    }
    return false;
}

/**
 * Scoped projection: resolves only the listed policy keys through the blob
 * tier and never returns the blob object itself. Content scripts keep the
 * allowlisted verdict inputs in scope while encrypted API keys and sync
 * destinations that share the blob stay out of the content heap.
 */
export function resolveBlobFirstAll(result: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = readBlobFirst(result, key);
    return out;
}
