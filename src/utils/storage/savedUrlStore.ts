/**
 * storage/savedUrlStore.ts
 * Saved-URL set with LRU eviction and per-URL timestamp/metadata tracking.
 * Split out of storage.ts (PBI: storage.ts deepening).
 */

import { withOptimisticLock } from '../optimisticLock.js';
import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES } from './quota.js';

// URL set size limit constants
export const MAX_URL_SET_SIZE = 10000;
export const URL_WARNING_THRESHOLD = 8000;
export const URL_RETENTION_DAYS = 35;

export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: string;
    maskedCount?: number;
    tags?: string[];
    /** Tranco信頼ドメインが使用されたか（Phase 1) */
    isTrancoDomain?: boolean;
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
 * Update URL timestamp for LRU tracking
 * @param {string} url - URL to update
 */
async function updateUrlTimestamp(url: string): Promise<void> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    let entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

    // 既存のURLがある場合は削除
    entries = entries.filter(entry => entry.url !== url);

    // 新しいエントリを追加
    entries.push({ url, timestamp: Date.now() });

    // 7日より古いエントリを削除（日数ベース）
    const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    entries = entries.filter(entry => entry.timestamp >= cutoff);

    // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
    if (entries.length > MAX_URL_SET_SIZE) {
        entries.sort((a, b) => a.timestamp - b.timestamp);
        entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
    }

    await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
}

/**
 * Save the list of URLs with LRU eviction
 * @param {Set<string>} urlSet - Set of URLs to save
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export async function setSavedUrls(urlSet: Set<string>, urlToAdd: string | null = null): Promise<void> {
    const urlArray = Array.from(urlSet);

    // 【セキュリティ改善】保存前にクォータチェック
    const currentUsage = await getStorageUsage();
    const newDataSize = estimateDataSize(urlArray);
    if (currentUsage + newDataSize > STORAGE_QUOTA_BYTES) {
        throw new Error(
            `Storage quota exceeded for saved URLs (current: ${currentUsage}, new: ${newDataSize}, limit: ${STORAGE_QUOTA_BYTES})`
        );
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
    // 既存エントリの recordType / maskedCount / tags を保持しつつ timestamp だけ更新する
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
            entries.push(entry);
        }
        return entries;
    });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // Note: これは競合の可能性がありますが、savedUrlsはsavedUrlsWithTimestampsから再生成可能です
    const currentSavedUrls = await chrome.storage.local.get('savedUrls');
    const currentSavedArray = currentSavedUrls['savedUrls'] as string[] || [];

    // 配列が同じならスキップ
    if (JSON.stringify(currentSavedArray.sort()) !== JSON.stringify(urlArray.sort())) {
        await chrome.storage.local.set({ savedUrls: urlArray });
    }
}

/**
 * Add a URL to the saved list with LRU tracking (日付ベース対応)
 * @param {string} url - URL to add
 */
export async function addSavedUrl(url: string): Promise<void> {
    const urlMap = await getSavedUrlsWithTimestamps();
    urlMap.set(url, Date.now());
    await setSavedUrlsWithTimestamps(urlMap, url);
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
