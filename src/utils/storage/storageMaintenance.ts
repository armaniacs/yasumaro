/**
 * storage/storageMaintenance.ts
 * Storage quota and maintenance helpers.
 * Extracted from settingsStore.ts (PBI-01) to isolate the utils -> background dependency.
 */

import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES, hasUnlimitedStorage } from './quota.js';
import { purgeLegacyStorage } from './savedUrlStore.js';
import { logInfo, logError, ErrorCode } from '../logger.js';

export async function getDefaultSqliteHealthCheck(): Promise<() => Promise<boolean>> {
    try {
        const { SqliteClient } = await import('../../background/sqliteClient.js');
        const client = new SqliteClient();
        return () => client.isSqliteHealthy();
    } catch {
        return async () => false;
    }
}

export async function ensureStorageQuota(
    toSave: Record<string, unknown>,
    sqliteHealthCheck?: () => Promise<boolean>
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
