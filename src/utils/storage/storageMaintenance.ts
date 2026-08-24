// @layer 1 — Infrastructure: storage quota and maintenance (Layer 0 only, SqliteHealthCheck injected)
/**
 * storage/storageMaintenance.ts
 * Storage quota and maintenance helpers.
 * Depends only on Layer 0 (quota, types) and injected SqliteHealthCheck.
 */

import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import { purgeLegacyStorage } from './savedUrlRepository.js';
import { logInfo, logError, ErrorCode } from '../logger.js';
import type { SqliteHealthCheck } from './types.js';

export async function getDefaultSqliteHealthCheck(): Promise<SqliteHealthCheck> {
    // Fallback that reports unhealthy so callers fail safe when no health check is injected.
    // Real health check should be injected from createBackgroundServices via SqliteClient.
    return async () => false;
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
