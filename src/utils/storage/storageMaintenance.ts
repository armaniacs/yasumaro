// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/storageMaintenance.ts
 * Storage quota and maintenance helpers.
 */

import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import { purgeLegacyStorage } from './savedUrlRepository.js';
import { logInfo, logError, ErrorCode } from '../logger.js';
import type { SqliteHealthCheck } from './types.js';

/**
 * Lazily construct a real SqliteClient-backed health check for contexts where
 * no healthCheck argument was provided (popup/options pages run in a separate
 * context from the service worker). The utils→background dynamic import is the
 * ADR 2026-08-20 sanctioned escape hatch (dynamic import + onReady) — static
 * import is still forbidden. Falls back to an always-unhealthy check if the
 * background module cannot be reached, preserving the fail-safe "skip
 * destructive purge" behavior.
 */
export async function getDefaultSqliteHealthCheck(): Promise<SqliteHealthCheck> {
    try {
        const { SqliteClient } = await import('../../background/sqlite/offscreenGateway.js');
        const client = new SqliteClient();
        return async () => {
            const r = await client.maintain({ type: 'healthCheck' });
            return r.success ? Boolean(r.data) : false;
        };
    } catch {
        return async () => false;
    }
}

export async function ensureStorageQuota(
    toSave: Record<string, unknown>,
    sqliteHealthCheck?: SqliteHealthCheck
): Promise<void> {
    if (await hasUnlimitedStorage()) return;
    const currentUsage = await getStorageUsage();
    const newDataSize = estimateDataSize(toSave);
    if (currentUsage + newDataSize <= STORAGE_QUOTA_BYTES) return;

    await logInfo('Storage quota near limit, attempting legacy cleanup', {
        currentUsage, newDataSize, limit: STORAGE_QUOTA_BYTES,
    }, 'storage/storageMaintenance.ts');

    // No module-global lookup — callers inject explicitly, or the fail-safe
    // default (always-unhealthy ⇒ skip destructive purge) applies.
    const effectiveHealthCheck = sqliteHealthCheck ?? (await getDefaultSqliteHealthCheck());
    const freed = await purgeLegacyStorage(effectiveHealthCheck);
    const afterCleanup = await getStorageUsage();

    if (afterCleanup + newDataSize <= STORAGE_QUOTA_BYTES) {
        await logInfo('Legacy cleanup freed space, proceeding with save', {
            freed, usageAfter: afterCleanup,
        }, 'storage/storageMaintenance.ts');
        return;
    }
    const errorMsg = `Storage quota exceeded (current: ${afterCleanup}, new: ${newDataSize}, limit: ${STORAGE_QUOTA_BYTES})`;
    await logError(errorMsg, { freed, usageAfter: afterCleanup }, ErrorCode.STORAGE_QUOTA_EXCEEDED, 'storage/storageMaintenance.ts');
    throw new Error(errorMsg);
}
