// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/storageMaintenance.ts
 * Storage quota and maintenance helpers.
 */

import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import { purgeLegacyStorage } from './savedUrlRepository.js';
import { logInfo, logError, ErrorCode } from '../logger.js';
import type { SqliteHealthCheck } from './types.js';

let _injectedHealthCheck: SqliteHealthCheck | null = null;

/**
 * Inject the SQLite health check implementation from the background layer.
 * Called once at startup from createBackgroundServices.
 */
export function setSqliteHealthCheck(hc: SqliteHealthCheck): void {
    _injectedHealthCheck = hc;
}

export function getSqliteHealthCheck(): SqliteHealthCheck | null {
    return _injectedHealthCheck;
}

export async function ensureStorageQuota(
    toSave: Record<string, unknown>,
    sqliteHealthCheck: SqliteHealthCheck
): Promise<void> {
    if (await hasUnlimitedStorage()) return;
    const currentUsage = await getStorageUsage();
    const newDataSize = estimateDataSize(toSave);
    if (currentUsage + newDataSize <= STORAGE_QUOTA_BYTES) return;

    await logInfo('Storage quota near limit, attempting legacy cleanup', {
        currentUsage, newDataSize, limit: STORAGE_QUOTA_BYTES,
    }, 'storage/storageMaintenance.ts');

    const freed = await purgeLegacyStorage(sqliteHealthCheck);
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
