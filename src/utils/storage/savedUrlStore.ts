/**
 * storage/savedUrlStore.ts
 * Saved-URL set with LRU eviction and per-URL timestamp/metadata tracking.
 * Split out of storage.ts (PBI: storage.ts deepening).
 * Integrates legacy urlStorage.ts (PBI: legacy urlStorage removal).
 */

import { withOptimisticLock } from '../optimisticLock.js';
import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import type { RecordType } from '../commonTypes.js';
import { MAX_URL_SET_SIZE, URL_RETENTION_DAYS, MAX_CONTENT_ENTRIES } from '../urlEntry.js';
import type { SavedUrlEntry } from '../urlEntry.js';

export { MAX_URL_SET_SIZE, URL_WARNING_THRESHOLD, URL_RETENTION_DAYS, MAX_CONTENT_ENTRIES } from '../urlEntry.js';
export type { SavedUrlEntry } from '../urlEntry.js';

/**
 * Metadata-only subset of a SavedUrlEntry. `url` and `timestamp` are owned by
 * the module and never appear in a patch. A key present with `undefined` means
 * "do not update"; fields that need an explicit empty value follow the storage
 * rules of the type (e.g. `tags: []` clears tags).
 *
 * Note: the legacy save path used to write a `title` field that was never part
 * of SavedUrlEntry and never read anywhere (see migrationService's
 * mapLegacyEntryToRecord). This contract intentionally excludes it.
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
   * tags first) instead of replacing them. Preserves the accumulation
   * behavior of the per-tag addUrlTag path used by the legacy
   * saveMetadataStep.
   */
  mergeTags?: boolean;
  createIfMissing?: boolean;
  timestamp?: number;
}

/**
 * Get the list of saved URLs with LRU eviction
 * @returns {Promise<Set<string>>} Set of saved URLs
 */
export async function getSavedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get('savedUrls');
    return new Set((result.savedUrls as string[]) || []);
}

/**
 * Get the detailed URL entries with timestamps
 * @returns {Promise<Map<string, number>>} Map of URLs to timestamps
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
 * 記録方式を含む詳細なURLエントリをすべて取得
 * @returns {Promise<SavedUrlEntry[]>} 保存されたURLエントリの配列
 */
export async function getSavedUrlEntries(): Promise<SavedUrlEntry[]> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    return (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
}

/**
 * Save the list of URLs with LRU eviction
 * @param {Set<string>} urlSet - Set of URLs to save
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export async function setSavedUrls(urlSet: Set<string>, urlToAdd: string | null = null): Promise<void> {
    const urlArray = Array.from(urlSet);

    // 【セキュリティ改善】保存前にクォータチェック
    // unlimitedStorage 権限がある場合は chrome.storage.local の実質的な上限がないためスキップ
    if (!(await hasUnlimitedStorage())) {
        const currentUsage = await getStorageUsage();
        const newDataSize = estimateDataSize(urlArray);
        if (currentUsage + newDataSize > STORAGE_QUOTA_BYTES) {
            throw new Error(
                `Storage quota exceeded for saved URLs (current: ${currentUsage}, new: ${newDataSize}, limit: ${STORAGE_QUOTA_BYTES})`
            );
        }
    }

    // 楽観的ロックで安全に保存
    await withOptimisticLock('savedUrls', () => urlArray);

    // LRUタイムスタンプを管理
    if (urlToAdd) {
        await updateUrlTimestamp(urlToAdd);
    }
}

/**
 * Save the URL Map with timestamps (日付ベース重複チェック用)
 * @param {Map<string, number>} urlMap - Map of URLs to timestamps
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export async function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd: string | null = null): Promise<void> {
    // urlToAddが指定されている場合は、現在のタイムスタンプで追加/更新
    if (urlToAdd) {
        urlMap.set(urlToAdd, Date.now());
    }

    const urlArray = Array.from(urlMap.keys());

    // savedUrlsWithTimestampsの楽観的ロックを使用
    // 既存エントリの recordType / maskedCount / tags / content / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を保持しつつ timestamp だけ更新する
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const existingMap = new Map<string, SavedUrlEntry>();
        for (const e of (currentEntries || [])) {
            existingMap.set(e.url, e);
        }
        const entries: SavedUrlEntry[] = [];
        for (const [url, timestamp] of urlMap.entries()) {
            const existing = existingMap.get(url);
            const entry: SavedUrlEntry = { url, timestamp };
            if (existing?.recordType !== undefined) entry.recordType = existing.recordType;
            if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
            if (existing?.tags !== undefined) entry.tags = existing.tags;
            if (existing?.content !== undefined) entry.content = existing.content;
            if (existing?.aiSummary !== undefined) entry.aiSummary = existing.aiSummary;
            if (existing?.sentTokens !== undefined) entry.sentTokens = existing.sentTokens;
            if (existing?.receivedTokens !== undefined) entry.receivedTokens = existing.receivedTokens;
            if (existing?.originalTokens !== undefined) entry.originalTokens = existing.originalTokens;
            if (existing?.cleansedTokens !== undefined) entry.cleansedTokens = existing.cleansedTokens;
            if (existing?.originalBytes !== undefined) entry.originalBytes = existing.originalBytes;
            if (existing?.cleansedBytes !== undefined) entry.cleansedBytes = existing.cleansedBytes;
            if (existing?.aiSummaryOriginalBytes !== undefined) entry.aiSummaryOriginalBytes = existing.aiSummaryOriginalBytes;
            if (existing?.aiSummaryCleansedBytes !== undefined) entry.aiSummaryCleansedBytes = existing.aiSummaryCleansedBytes;
            if (existing?.aiSummaryCleansedElements !== undefined) entry.aiSummaryCleansedElements = existing.aiSummaryCleansedElements;
            if (existing?.aiSummaryCleansedReason !== undefined) entry.aiSummaryCleansedReason = existing.aiSummaryCleansedReason;
            if (existing?.aiSummaryCleansedReasons !== undefined) entry.aiSummaryCleansedReasons = existing.aiSummaryCleansedReasons;
            if (existing?.pageBytes !== undefined) entry.pageBytes = existing.pageBytes;
            if (existing?.candidateBytes !== undefined) entry.candidateBytes = existing.candidateBytes;
            if (existing?.aiProvider !== undefined) entry.aiProvider = existing.aiProvider;
            if (existing?.aiModel !== undefined) entry.aiModel = existing.aiModel;
            if (existing?.aiDuration !== undefined) entry.aiDuration = existing.aiDuration;
            if (existing?.obsidianDuration !== undefined) entry.obsidianDuration = existing.obsidianDuration;
            entries.push(entry);
        }
        // contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）
        const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });
        return entries;
    });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // withOptimisticLockを使用して原子的に更新
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        const newSet = new Set(urlArray);

        // サイズが異なる場合は即座に更新
        if (currentSet.size !== newSet.size) {
            return Array.from(newSet);
        }

        // for...ofループで比較（O(n)配列アロケーションなし）
        for (const x of currentSet) {
            if (!newSet.has(x)) {
                return Array.from(newSet);
            }
        }

        return currentUrls; // 変更なしの場合は元の値を返す
    });
}

/**
 * Update URL timestamp for LRU tracking
 * 【recordType上書き競合対策】楽観的ロックを使用して安全に更新
 * @param {string} url - URL to update
 * @param {RecordType} [recordType] - 記録方式
 */
async function updateUrlTimestamp(url: string, recordType?: RecordType): Promise<void> {
    // 【recordType上書き競合対策】楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        let entries = currentEntries || [];

        // 既存のURLエントリを取得してから削除
        const existing = entries.find(entry => entry.url === url);
        entries = entries.filter(entry => entry.url !== url);

        // 新しいエントリを追加（既存の tags / maskedCount / content / cleansedReason / aiSummary / sentTokens / receivedTokens / originalTokens / cleansedTokens / originalBytes / cleansedBytes / aiSummaryOriginalBytes / aiSummaryCleansedBytes / aiSummaryCleansedElements / aiSummaryCleansedReason を引き継ぐ）
        const entry: SavedUrlEntry = { url, timestamp: Date.now() };
        if (recordType) entry.recordType = recordType;
        if (existing?.maskedCount !== undefined) entry.maskedCount = existing.maskedCount;
        if (existing?.tags !== undefined) entry.tags = existing.tags;
        if (existing?.content !== undefined) entry.content = existing.content;
        if (existing?.cleansedReason !== undefined) entry.cleansedReason = existing.cleansedReason;
        if (existing?.aiSummary !== undefined) entry.aiSummary = existing.aiSummary;
        if (existing?.sentTokens !== undefined) entry.sentTokens = existing.sentTokens;
        if (existing?.receivedTokens !== undefined) entry.receivedTokens = existing.receivedTokens;
        if (existing?.originalTokens !== undefined) entry.originalTokens = existing.originalTokens;
        if (existing?.cleansedTokens !== undefined) entry.cleansedTokens = existing.cleansedTokens;
        if (existing?.originalBytes !== undefined) entry.originalBytes = existing.originalBytes;
        if (existing?.cleansedBytes !== undefined) entry.cleansedBytes = existing.cleansedBytes;
        if (existing?.aiSummaryOriginalBytes !== undefined) entry.aiSummaryOriginalBytes = existing.aiSummaryOriginalBytes;
        if (existing?.aiSummaryCleansedBytes !== undefined) entry.aiSummaryCleansedBytes = existing.aiSummaryCleansedBytes;
        if (existing?.aiSummaryCleansedElements !== undefined) entry.aiSummaryCleansedElements = existing.aiSummaryCleansedElements;
        if (existing?.aiSummaryCleansedReason !== undefined) entry.aiSummaryCleansedReason = existing.aiSummaryCleansedReason;
        if (existing?.aiSummaryCleansedReasons !== undefined) entry.aiSummaryCleansedReasons = existing.aiSummaryCleansedReasons;
        if (existing?.pageBytes !== undefined) entry.pageBytes = existing.pageBytes;
        if (existing?.candidateBytes !== undefined) entry.candidateBytes = existing.candidateBytes;
        if (existing?.aiProvider !== undefined) entry.aiProvider = existing.aiProvider;
        if (existing?.aiModel !== undefined) entry.aiModel = existing.aiModel;
        if (existing?.aiDuration !== undefined) entry.aiDuration = existing.aiDuration;
        if (existing?.obsidianDuration !== undefined) entry.obsidianDuration = existing.obsidianDuration;
        entries.push(entry);

        // 7日より古いエントリを削除（日数ベース）
        const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        entries = entries.filter(entry => entry.timestamp >= cutoff);

        // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
        if (entries.length > MAX_URL_SET_SIZE) {
            entries.sort((a, b) => a.timestamp - b.timestamp);
            entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
        }

        // contentは最新MAX_CONTENT_ENTRIES件のみ保持（ストレージ節約）
        const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
        sorted.forEach((e, i) => { if (i >= MAX_CONTENT_ENTRIES) delete e.content; });

        return entries;
    });

    // savedUrlsセットも同期（isUrlSaved, getSavedUrlCountで使用）
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const currentSet = new Set(currentUrls || []);
        currentSet.add(url);
        return Array.from(currentSet);
    });
}

/**
 * Add a URL to the saved list with LRU tracking (日付ベース対応)
 * @param {string} url - URL to add
 * @param {RecordType} [recordType] - 記録方式
 */
export async function addSavedUrl(url: string, recordType?: RecordType): Promise<void> {
    if (recordType) {
        await updateUrlTimestamp(url, recordType);
    } else {
        await updateUrlTimestamp(url);
    }
}

/**
 * Remove a URL from the saved list
 * @param {string} url - URL to remove
 */
export async function removeSavedUrl(url: string): Promise<void> {
    // 楽観的ロックで安全に削除
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const urlSet = new Set(currentUrls || []);
        urlSet.delete(url);
        return Array.from(urlSet);
    });

    // タムスタンプ管理からも削除
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        return entries.filter(entry => entry.url !== url);
    });
}

/**
 * Check if URL is in the saved list
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} True if URL is saved
 */
export async function isUrlSaved(url: string): Promise<boolean> {
    const currentUrls = await getSavedUrls();
    return currentUrls.has(url);
}

/**
 * Get the count of saved URLs
 * @returns {Promise<number>} Number of saved URLs
 */
export async function getSavedUrlCount(): Promise<number> {
    const currentUrls = await getSavedUrls();
    return currentUrls.size;
}

/**
 * Merge a patch into a SavedUrlEntry, preserving fields not present in the patch.
 * Used to rebuild entries while keeping existing metadata.
 */
export function mergeSavedUrlEntry(
    current: SavedUrlEntry,
    patch: Partial<SavedUrlEntry>
): SavedUrlEntry {
    return { ...current, ...patch };
}

/**
 * Deep-update a single SavedUrlEntry by URL using an updater closure.
 * Lock, merge, and LRU semantics are concentrated here.
 * @param url - URL to update
 * @param updater - function that receives the current entry and returns the updated entry
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
            updatedEntries[idx] = updater(updatedEntries[idx]);
            return updatedEntries;
        }
        return entries;
    });
}

/**
 * Atomically update a URL entry's timestamp and metadata in a single CAS.
 *
 * Timestamp + metadata are committed in one withOptimisticLock cycle so a
 * concurrent update or a Service Worker termination between the two writes can
 * never leave a partially-updated entry. If the entry does not exist yet it is
 * created with `{ url, timestamp: Date.now() }` merged with the patch.
 *
 * The `savedUrls` mirror set is intentionally not touched: updateSavedUrlEntry
 * never synced it either, and keeping this operation a single CAS preserves
 * the existing mirror behavior.
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
        // New entries always get Date.now() (or the explicit `timestamp`
        // option) here — there is no prior timestamp to "not refresh", so
        // `refreshTimestamp` is intentionally not consulted on this branch.
        if (idx < 0) {
            if (!createIfMissing) return entries;
            return [...entries, applyMetadataPatch({ url, timestamp: timestamp ?? Date.now() }, patch, mergeTags)];
        }
        const updatedEntries = [...entries];
        const merged = applyMetadataPatch(updatedEntries[idx], patch, mergeTags);
        updatedEntries[idx] = refreshTimestamp
            ? { ...merged, timestamp: timestamp ?? Date.now() }
            : merged;
        return updatedEntries;
    });
}

/**
 * Merge a metadata patch into an entry. `undefined` values are skipped
 * (they mean "no update"); explicit empty values follow the storage rules
 * of the type (empty tags are stored as undefined).
 *
 * `url`/`timestamp` are skipped even though SavedUrlEntryMetadataPatch's
 * Omit<...> type already excludes them: the Omit is a compile-time-only
 * contract. A future caller that passes external data through an `as`
 * cast (e.g. an import/restore feature) could bypass it, so this function
 * — the last line of defense before storage — enforces it at runtime too.
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
            (result as unknown as Record<string, unknown>)[key] = value;
        }
    }
    return result;
}

/**
 * Set tags for a URL entry.
 */
export async function setUrlTags(url: string, tags: string[]): Promise<void> {
    await updateSavedUrlEntry(url, (entry) => ({
        ...entry,
        tags: tags.length > 0 ? tags : undefined
    }));
    // Note: warning for URL not found is not logged here to keep updateSavedUrlEntry generic.
    // The caller can check existence beforehand if needed.
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
        return { ...entry, tags: filtered.length > 0 ? filtered : undefined };
    });
}

// ============================================================================
// Legacy Storage Cleanup (quota recovery)
// ============================================================================

/** Maximum entries to keep in legacy savedUrlsWithTimestamps after cleanup. */
const LEGACY_MAX_ENTRIES = 500;

/**
 * Clean up legacy chrome.storage.local data (savedUrlsWithTimestamps large
 * fields, the savedUrls key) to free quota space.
 *
 * @param sqliteHealthCheck - PBI 2026-07-09-10: optional health check the
 *   caller can inject (e.g. bound to `sqliteClient.isSqliteHealthy()`).
 *   This module never imports the SQLite client — it's used from multiple
 *   contexts (Service Worker, popup, dashboard) and only the Service
 *   Worker context has direct access to it. When provided and it reports
 *   unhealthy (or throws), this destructive cleanup is skipped entirely:
 *   chrome.storage.local may be the only surviving copy of the data if
 *   SQLite is broken, so it must not be deleted in that case.
 *   When omitted, cleanup proceeds unconditionally (existing behavior).
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
            }, undefined, 'storage/savedUrlStore.ts');
            return 0;
        }
        if (!healthy) {
            await logWarn('SQLite unhealthy — skipping legacy purge to preserve data', {}, undefined, 'storage/savedUrlStore.ts');
            return 0;
        }
    }

    const before = await getStorageUsage();
    let freed = 0;

    try {
        // 1. Clean up savedUrlsWithTimestamps: strip large fields, trim count
        const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

        if (entries.length > 0) {
            // Keep only the most recent entries, sorted by timestamp
            let cleaned = [...entries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // Truncate to max count
            if (cleaned.length > LEGACY_MAX_ENTRIES) {
                cleaned = cleaned.slice(0, LEGACY_MAX_ENTRIES);
            }

            // Strip large metadata fields (they're in SQLite)
            cleaned = cleaned.map(entry => {
                const stripped: SavedUrlEntry = { url: entry.url, timestamp: entry.timestamp };
                // Preserve fields needed by legacy history panel
                if (entry.recordType) stripped.recordType = entry.recordType;
                if (entry.maskedCount !== undefined) stripped.maskedCount = entry.maskedCount;
                if (entry.tags) stripped.tags = entry.tags;
                if (entry.isTrancoDomain !== undefined) stripped.isTrancoDomain = entry.isTrancoDomain;
                return stripped;
            });

            await chrome.storage.local.set({ savedUrlsWithTimestamps: cleaned });
        }

        // 2. Clean up legacy keys that are no longer needed
        const legacyKeys = ['savedUrls'];
        try {
            await chrome.storage.local.remove(legacyKeys);
        } catch {
            // Ignore errors during cleanup
        }

        const after = await getStorageUsage();
        freed = before > after ? before - after : 0;
    } catch (err) {
        await logError('Legacy storage cleanup failed', { error: errorMessage(err) }, ErrorCode.STORAGE_WRITE_FAILURE, 'storage/savedUrlStore.ts');
        freed = 0;
    }

    return freed;
}
