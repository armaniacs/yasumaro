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
