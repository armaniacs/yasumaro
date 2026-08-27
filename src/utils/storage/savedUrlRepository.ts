// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * savedUrlRepository.ts
 * Saved-URL CRUD — encapsulates chrome.storage.local operations behind a
 * functional module seam.
 *
 * Extracted from savedUrlStore.ts (PBI: architecture deepening).
 * Follows the recordsRepo.ts functional-module pattern.
 *
 * The 30-line field-by-field property preservation blocks in
 * setSavedUrlsWithTimestamps() and updateUrlTimestamp() are replaced by
 * a spread + Object.entries loop — treating SavedUrlEntry as an opaque
 * value object rather than an enumerated bag of fields.
 */

import { withOptimisticLock, ConflictError } from '../optimisticLock.js';
import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import type { RecordType } from '../commonTypes.js';
import { MAX_URL_SET_SIZE, URL_RETENTION_DAYS, MAX_CONTENT_ENTRIES } from '../urlEntry.js';
import type { SavedUrlEntry } from '../urlEntry.js';
import { pickDefined } from '../objectUtils.js';

export { MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD, URL_RETENTION_DAYS, MAX_CONTENT_ENTRIES } from '../urlEntry.js';
export type { SavedUrlEntry } from '../urlEntry.js';

/**
 * Metadata-only subset of a SavedUrlEntry. `url` and `timestamp` are owned by
 * the module and never appear in a patch. A key present with `undefined` means
 * "do not update"; fields that need an explicit empty value follow the storage
 * rules of the type (e.g. `tags: []` clears tags).
 */
export type SavedUrlEntryMetadataPatch = Partial<Omit<SavedUrlEntry, 'url' | 'timestamp'>>;

export interface SaveSavedUrlEntryMetadataOptions {
  /**
   * Refresh the entry timestamp to Date.now() in the same CAS. Defaults to
   * true so recording-time saves bump LRU ordering; content backfills that
   * must not reorder LRU (e.g. setUrlContent) pass false.
   */
  refreshTimestamp?: boolean;
  /**
   * Merge patch.tags into the entry's existing tags (deduplicated, existing
   * tags first) instead of replacing them.
   */
  mergeTags?: boolean;
  createIfMissing?: boolean;
  timestamp?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Spread all fields from `existing` into `target`, skipping `undefined` values
 * and the reserved keys `url`/`timestamp`. This replaces the 30-line
 * field-by-field enumeration that previously existed in
 * setSavedUrlsWithTimestamps() and updateUrlTimestamp().
 *
 * WHY: SavedUrlEntry has 30+ optional fields. Hand-enumerating them meant
 * every new field required edits in 2-3 places. Treating the entry as an
 * opaque value object eliminates that maintenance burden.
 */
function spreadExistingFields(target: SavedUrlEntry, existing: SavedUrlEntry | undefined): SavedUrlEntry {
  if (!existing) return target;
  const { url: _url, timestamp: _ts, ...fields } = existing;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // WHY: dynamic property assignment on result object; URL keys are generated at runtime
    (target as unknown as Record<string, unknown>)[key] = value;
  }
  return target;
}

/**
 * Merge a metadata patch into an entry. `undefined` values are skipped
 * (they mean "no update"); explicit empty values follow the storage rules
 * of the type (empty tags are stored as undefined).
 *
 * `url`/`timestamp` are skipped even though SavedUrlEntryMetadataPatch's
 * Omit<...> type already excludes them: the Omit is a compile-time-only
 * contract. A future caller that passes external data through an `as`
 * cast could bypass it, so this function enforces it at runtime too.
 */
function applyMetadataPatch(
    current: SavedUrlEntry,
    patch: SavedUrlEntryMetadataPatch,
    mergeTags: boolean
): SavedUrlEntry {
    const result: SavedUrlEntry = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (key === 'url' || key === 'timestamp') continue;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (key === 'tags') {
            if (mergeTags) {
                const existing = current.tags || [];
                const seen = new Set(existing);
                const merged = [...existing];
                for (const tag of value as string[]) {
                    if (!seen.has(tag)) {
                        seen.add(tag);
                        merged.push(tag);
                    }
                }
                if (merged.length > 0) result.tags = merged;
                else delete result.tags;
            } else {
                // Empty tag lists are stored as absent (existing convention).
                if ((value as string[]).length > 0) result.tags = value as string[];
                else delete result.tags;
            }
        } else {
            // WHY: dynamic property assignment on result object; URL keys are generated at runtime
            (result as unknown as Record<string, unknown>)[key] = value;
        }
    }
    return result;
}

/**
 * Atomic dual-key CAS for `savedUrls` + `savedUrlsWithTimestamps`.
 *
 * 5 Whys (PBI 2026-08-27-28):
 * 1. なぜ非原子か: `setSavedUrlsWithTimestamps` と `updateUrlTimestamp` が
 *    `savedUrlsWithTimestamps` と `savedUrls` を2回の独立した
 *    `withOptimisticLock` で更新するため、中間状態が観測可能だった。
 * 2. なぜ2回に分けたか: 2キーが `chrome.storage.local` で別キーとして
 *    保存され、各キー単位で CAS する設計を踏襲したため。
 * 3. なぜ気づかなかったか: 単一タブ・単一操作のテストでは競合が発生せず、
 *    並行書き込みのインターリーブを検証するテストがなかった。
 * 4. なぜリトライが二重書き込みを招くか: 片方だけ成功した後にリトライすると
 *    もう片方が重複更新されるため、単一トランザクションで再実行する必要がある。
 * 5. 解: 両キーを単一の楽観的ロック・トランザクションに統合し、
 *    `chrome.storage.local.set({ savedUrls, savedUrlsWithTimestamps })` の
 *    アトミック性 + バージョンチェックで競合ウィンドウを閉じる。
 */
const INITIAL_VERSION = 0;

async function withAtomicSavedUrls(
    updater: (state: { urls: string[]; entries: SavedUrlEntry[] }) => { nextUrls: string[]; nextEntries: SavedUrlEntry[] },
    options: { maxRetries?: number; initialDelay?: number } = {}
): Promise<void> {
    const { maxRetries = 5, initialDelay = 100 } = options;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
        try {
            const result = await chrome.storage.local.get([
                'savedUrls',
                'savedUrls_version',
                'savedUrlsWithTimestamps',
                'savedUrlsWithTimestamps_version',
            ]);
            const currentUrls = (result.savedUrls as string[]) || [];
            const currentUrlsVersion = (result.savedUrls_version as number) ?? INITIAL_VERSION;
            const currentEntries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
            const currentEntriesVersion = (result.savedUrlsWithTimestamps_version as number) ?? INITIAL_VERSION;

            const { nextUrls, nextEntries } = updater({ urls: currentUrls, entries: currentEntries });

            const newUrlsVersion = currentUrlsVersion + 1;
            const newEntriesVersion = currentEntriesVersion + 1;

            const verifyResult = await chrome.storage.local.get([
                'savedUrls',
                'savedUrls_version',
                'savedUrlsWithTimestamps',
                'savedUrlsWithTimestamps_version',
            ]);
            const verifyUrlsVersion = (verifyResult.savedUrls_version as number) ?? INITIAL_VERSION;
            const verifyEntriesVersion = (verifyResult.savedUrlsWithTimestamps_version as number) ?? INITIAL_VERSION;

            if (verifyUrlsVersion !== currentUrlsVersion || verifyEntriesVersion !== currentEntriesVersion) {
                throw new ConflictError(
                    'savedUrls+savedUrlsWithTimestamps',
                    currentUrlsVersion,
                    verifyUrlsVersion !== currentUrlsVersion ? verifyUrlsVersion : verifyEntriesVersion
                );
            }

            await chrome.storage.local.set({
                savedUrls: nextUrls,
                savedUrls_version: newUrlsVersion,
                savedUrlsWithTimestamps: nextEntries,
                savedUrlsWithTimestamps_version: newEntriesVersion,
            });
            return;
        } catch (error) {
            if (!(error instanceof ConflictError)) throw error;
            lastError = error as Error;
            attempt++;
            if (attempt > maxRetries) throw new ConflictError('savedUrls+savedUrlsWithTimestamps', -1, -1);
            const delay = initialDelay * Math.pow(2, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError || new Error('Unexpected error in withAtomicSavedUrls');
}

// ============================================================================
// Read operations
// ============================================================================

/**
 * Get the list of saved URLs as a Set.
 */
export async function getSavedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get('savedUrls');
    return new Set((result.savedUrls as string[]) || []);
}

/**
 * Get the detailed URL entries with timestamps as a Map.
 */
export async function getSavedUrlsWithTimestamps(): Promise<Map<string, number>> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const urlMap = new Map<string, number>();
    for (const entry of entries) {
        urlMap.set(entry.url, entry.timestamp);
    }
    return urlMap;
}

/**
 * Get all saved URL entries.
 */
export async function getSavedUrlEntries(): Promise<SavedUrlEntry[]> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    return (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
}

/**
 * Check if URL is in the saved list.
 */
export async function isUrlSaved(url: string): Promise<boolean> {
    const currentUrls = await getSavedUrls();
    return currentUrls.has(url);
}

/**
 * Get the count of saved URLs.
 */
export async function getSavedUrlCount(): Promise<number> {
    const currentUrls = await getSavedUrls();
    return currentUrls.size;
}

// ============================================================================
// Write operations — LRU management
// ============================================================================

/**
 * Save the URL Set with LRU eviction.
 */
export async function setSavedUrls(urlSet: Set<string>, urlToAdd: string | null = null): Promise<void> {
    const urlArray = Array.from(urlSet);

    if (!(await hasUnlimitedStorage())) {
        const currentUsage = await getStorageUsage();
        const newDataSize = estimateDataSize(urlArray);
        if (currentUsage + newDataSize > STORAGE_QUOTA_BYTES) {
            throw new Error(
                `Storage quota exceeded for saved URLs (current: ${currentUsage}, new: ${newDataSize}, limit: ${STORAGE_QUOTA_BYTES})`
            );
        }
    }

    await withOptimisticLock('savedUrls', () => urlArray);

    if (urlToAdd) {
        await updateUrlTimestamp(urlToAdd);
    }
}

/**
 * Save the URL Map with timestamps.
 * Existing entry fields are preserved via spreadExistingFields() — no
 * manual field enumeration needed.
 *
 * Atomic: `savedUrls` と `savedUrlsWithTimestamps` を単一トランザクションで
 * 更新し、中間状態を観測させない。
 */
export async function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd: string | null = null): Promise<void> {
    if (urlToAdd) {
        urlMap.set(urlToAdd, Date.now());
    }

    const urlArray = Array.from(urlMap.keys());

    await withAtomicSavedUrls(({ urls: currentUrls, entries: currentEntries }) => {
        const existingMap = new Map<string, SavedUrlEntry>();
        for (const e of (currentEntries || [])) {
            existingMap.set(e.url, e);
        }
        const nextEntries: SavedUrlEntry[] = [];
        for (const [url, timestamp] of urlMap.entries()) {
            const existing = existingMap.get(url);
            const entry: SavedUrlEntry = { url, timestamp };
            spreadExistingFields(entry, existing);
            nextEntries.push(entry);
        }
        // contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）
        const sorted = nextEntries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });

        const currentSet = new Set(currentUrls || []);
        const newSet = new Set(urlArray);
        let nextUrls: string[];
        if (currentSet.size !== newSet.size) {
            nextUrls = Array.from(newSet);
        } else {
            let changed = false;
            for (const x of currentSet) {
                if (!newSet.has(x)) { changed = true; break; }
            }
            nextUrls = changed ? Array.from(newSet) : (currentUrls || []);
        }

        return { nextUrls, nextEntries };
    });
}

/**
 * Update URL timestamp for LRU tracking.
 * Existing entry fields are preserved via spreadExistingFields().
 *
 * Atomic: `savedUrls` と `savedUrlsWithTimestamps` を単一トランザクションで
 * 更新し、並行する読み取りが中間状態を観測しないようにする。
 * 7日 cutoff / LRU eviction / content 保持ロジックは維持。
 */
async function updateUrlTimestamp(url: string, recordType?: RecordType): Promise<void> {
    await withAtomicSavedUrls(({ entries: currentEntries }) => {
        let entries = currentEntries || [];
        const existing = entries.find(entry => entry.url === url);
        entries = entries.filter(entry => entry.url !== url);

        const entry: SavedUrlEntry = { url, timestamp: Date.now() };
        spreadExistingFields(entry, existing);
        if (recordType) entry.recordType = recordType;
        entries.push(entry);

        // 7日より古いエントリを削除
        const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        entries = entries.filter(e => e.timestamp >= cutoff);

        if (entries.length > MAX_URL_SET_SIZE) {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
        }

        // contentは最新MAX_CONTENT_ENTRIES件のみ保持
        const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });

        const nextEntries = entries;
        // LRU 削除が両キーで同一URLに対して行われるよう、entries 駆動で
        // savedUrls を導出する。中間不一致を防止し、両キー一致を保証する。
        const nextUrls = nextEntries.map(e => e.url);

        return { nextUrls, nextEntries };
    });
}

// ============================================================================
// Write operations — CRUD
// ============================================================================

/**
 * Add a URL to the saved list with LRU tracking.
 */
export async function addSavedUrl(url: string, recordType?: RecordType): Promise<void> {
    await updateUrlTimestamp(url, recordType);
}

/**
 * Remove a URL from the saved list.
 * Atomic: 両キーを単一トランザクションで削除し、中間不一致を防止。
 */
export async function removeSavedUrl(url: string): Promise<void> {
    await withAtomicSavedUrls(({ urls: currentUrls, entries: currentEntries }) => {
        const urlSet = new Set(currentUrls || []);
        urlSet.delete(url);
        const nextUrls = Array.from(urlSet);
        const nextEntries = (currentEntries || []).filter(entry => entry.url !== url);
        return { nextUrls, nextEntries };
    });
}

/**
 * Merge a patch into a SavedUrlEntry, preserving fields not present in the patch.
 */
export function mergeSavedUrlEntry(
    current: SavedUrlEntry,
    patch: Partial<SavedUrlEntry>
): SavedUrlEntry {
    return { ...current, ...patch };
}

/**
 * Deep-update a single SavedUrlEntry by URL using an updater closure.
 */
export async function updateSavedUrlEntry(
    url: string,
    updater: (entry: SavedUrlEntry) => SavedUrlEntry
): Promise<void> {
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx >= 0) {
            const updatedEntries = [...entries];
            const current = updatedEntries[idx];
            if (current === undefined) return entries;
            updatedEntries[idx] = updater(current);
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * Atomically update a URL entry's timestamp and metadata in a single CAS.
 */
export async function saveSavedUrlEntryMetadata(
    url: string,
    patch: SavedUrlEntryMetadataPatch,
    options: SaveSavedUrlEntryMetadataOptions = {}
): Promise<void> {
    const { refreshTimestamp = true, mergeTags = false, createIfMissing = true, timestamp } = options;

    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        const idx = entries.findIndex(e => e.url === url);
        if (idx < 0) {
            if (!createIfMissing) return entries;
            return [...entries, applyMetadataPatch({ url, timestamp: timestamp ?? Date.now() }, patch, mergeTags)];
        }
        const updatedEntries = [...entries];
        const current = updatedEntries[idx];
        if (current === undefined) return entries;
        const merged = applyMetadataPatch(current, patch, mergeTags);
        updatedEntries[idx] = refreshTimestamp
            ? { ...merged, timestamp: timestamp ?? Date.now() }
            : merged;
        return updatedEntries;
    });
}

// ============================================================================
// Tag operations
// ============================================================================

/**
 * Set tags for a URL entry.
 */
export async function setUrlTags(url: string, tags: string[]): Promise<void> {
    await updateSavedUrlEntry(url, (entry) => {
        const { tags: _omit, ...rest } = entry;
        return { ...rest, ...pickDefined({ tags: tags.length > 0 ? tags : undefined }) };
    });
}

/**
 * Add a tag to a URL entry.
 */
export async function addUrlTag(url: string, tag: string): Promise<void> {
    await updateSavedUrlEntry(url, (entry) => {
        const currentTags = entry.tags || [];
        if (!currentTags.includes(tag)) {
            return { ...entry, tags: [...currentTags, tag] };
        }
        return entry;
    });
}

/**
 * Remove a tag from a URL entry.
 */
export async function removeUrlTag(url: string, tag: string): Promise<void> {
    await updateSavedUrlEntry(url, (entry) => {
        if (!entry.tags) return entry;
        const filtered = entry.tags.filter(t => t !== tag);
        const { tags: _omit, ...rest } = entry;
        return { ...rest, ...pickDefined({ tags: filtered.length > 0 ? filtered : undefined }) };
    });
}

// ============================================================================
// Legacy Storage Cleanup (quota recovery)
// ============================================================================

/** Maximum entries to keep in legacy savedUrlsWithTimestamps after cleanup. */
const LEGACY_MAX_ENTRIES = 500;

/**
 * Clean up legacy chrome.storage.local data to free quota space.
 */
export async function purgeLegacyStorage(
    sqliteHealthCheck?: () => Promise<boolean>
): Promise<number> {
    const { logWarn, logError, ErrorCode } = await import('../logger.js');
    const { errorMessage } = await import('../errorUtils.js');

    if (sqliteHealthCheck) {
        let healthy: boolean;
        try {
            healthy = await sqliteHealthCheck();
        } catch (err) {
            await logWarn('SQLite health check failed — skipping legacy purge to preserve data', {
                error: errorMessage(err),
            }, undefined, 'storage/savedUrlRepository.ts');
            return 0;
        }
        if (!healthy) {
            await logWarn('SQLite unhealthy — skipping legacy purge to preserve data', {}, undefined, 'storage/savedUrlRepository.ts');
            return 0;
        }
    }

    const before = await getStorageUsage();
    let freed = 0;

    try {
        const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

        if (entries.length > 0) {
            let cleaned = [...entries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            if (cleaned.length > LEGACY_MAX_ENTRIES) {
                cleaned = cleaned.slice(0, LEGACY_MAX_ENTRIES);
            }

            // Strip large metadata fields (keep only fields needed by legacy history panel)
            cleaned = cleaned.map(entry => {
                const stripped: SavedUrlEntry = { url: entry.url, timestamp: entry.timestamp };
                if (entry.recordType) stripped.recordType = entry.recordType;
                if (entry.maskedCount !== undefined) stripped.maskedCount = entry.maskedCount;
                if (entry.tags) stripped.tags = entry.tags;
                if (entry.isTrancoDomain !== undefined) stripped.isTrancoDomain = entry.isTrancoDomain;
                return stripped;
            });

            await chrome.storage.local.set({ savedUrlsWithTimestamps: cleaned });
        }

        const legacyKeys = ['savedUrls'];
        try {
            await chrome.storage.local.remove(legacyKeys);
        } catch {
            // Ignore errors during cleanup
        }

        const after = await getStorageUsage();
        freed = before > after ? before - after : 0;
    } catch (err) {
        await logError('Legacy storage cleanup failed', { error: errorMessage(err) }, ErrorCode.STORAGE_WRITE_FAILURE, 'storage/savedUrlRepository.ts');
        freed = 0;
    }

    return freed;
}
