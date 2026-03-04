/**
 * migration.ts
 * Data migration functions for uBlock format rules (old to lightweight format).
 *
 * Old format (v2.2.4 and earlier):
 * { blockRules: [{domain, options, ...}], exceptionRules: [{domain, options, ...}], metadata }
 *
 * New lightweight format (v2.2.5+):
 * { blockDomains: ['domain1', 'domain2', ...], exceptionDomains: ['domain1', 'domain2', ...], metadata }
 */
const MIGRATION_BACKUP_KEY = 'migration_backup';
const MIGRATION_BACKUP_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7日
/**
 * マイグレーション用バックアップを作成
 * @param {string} key - バックアップ元のストレージキー
 * @returns {Promise<void>}
 */
async function createMigrationBackup(key) {
    const result = await chrome.storage.local.get([key]);
    const backup = {
        timestamp: Date.now(),
        originalData: result[key] || null
    };
    await chrome.storage.local.set({
        [MIGRATION_BACKUP_KEY]: backup
    });
    // ログはstorage.tsからimportするのを避けるためconsoleを使用
    console.log('[Migration] Backup created for key:', key, 'timestamp:', backup.timestamp);
}
/**
 * マイグレーション用バックアップから復元
 * @param {string} key - 復元先のストレージキー
 * @returns {Promise<boolean>} 復元成功時true
 */
async function restoreFromMigrationBackup(key) {
    const result = await chrome.storage.local.get([MIGRATION_BACKUP_KEY]);
    const backup = result[MIGRATION_BACKUP_KEY];
    if (!backup || !backup.originalData) {
        console.error('[Migration] Backup not found for key:', key);
        return false;
    }
    await chrome.storage.local.set({ [key]: backup.originalData });
    console.warn('[Migration] Rolled back from backup', key, 'backup timestamp:', backup.timestamp);
    return true;
}
/**
 * 古いバックアップをクリーンアップ
 * @returns {Promise<void>}
 */
async function cleanupOldBackups() {
    const result = await chrome.storage.local.get([MIGRATION_BACKUP_KEY]);
    const backup = result[MIGRATION_BACKUP_KEY];
    if (backup && (Date.now() - backup.timestamp) > MIGRATION_BACKUP_RETENTION) {
        await chrome.storage.local.remove([MIGRATION_BACKUP_KEY]);
        console.log('[Migration] Cleaned up old backup');
    }
}
/**
 * Migrate old format uBlock rules to new lightweight format.
 * @param {OldFormat} oldRules - Old format {blockRules, exceptionRules, metadata}
 * @returns {OldFormat | NewFormat} - New format {blockDomains, exceptionDomains, metadata} or oldRules if already migrated
 */
export function migrateToLightweightFormat(oldRules) {
    // Check that new format exists AND old format does NOT exist
    // This avoids incorrectly detecting a mixed object as already migrated
    if (oldRules.blockDomains && oldRules.exceptionDomains &&
        !oldRules.blockRules && !oldRules.exceptionRules) {
        return oldRules;
    }
    // Filter out rules without domain property before mapping
    const blockDomains = (oldRules.blockRules || [])
        .filter(r => r.domain)
        .map(r => r.domain);
    const exceptionDomains = (oldRules.exceptionRules || [])
        .filter(r => r.domain)
        .map(r => r.domain);
    return {
        blockDomains,
        exceptionDomains,
        metadata: {
            ...(oldRules.metadata || {}),
            importedAt: oldRules.metadata?.importedAt || Date.now(),
            ruleCount: blockDomains.length + exceptionDomains.length,
            migrated: true
        }
    };
}
/**
 * Migrate uBlock settings in storage to new lightweight format.
 * With rollback support on failure.
 * @returns {Promise<boolean>} - true if migration was performed, false otherwise
 * @throws {Error} - Migration failure (after rollback attempt)
 */
export async function migrateUblockSettings() {
    // Use hardcoded key to avoid dynamic import in Service Worker context
    const UBLOCK_RULES_KEY = 'ublock_rules';
    // 古いバックアップのクリーンアップ
    await cleanupOldBackups();
    const result = await chrome.storage.local.get([UBLOCK_RULES_KEY]);
    const ublockRules = result[UBLOCK_RULES_KEY];
    // If already in new format (and NOT in old format) or no data exists, nothing to do
    if (!ublockRules ||
        (ublockRules.blockDomains && ublockRules.exceptionDomains && !ublockRules.blockRules && !ublockRules.exceptionRules)) {
        return false;
    }
    try {
        // バックアップ作成
        await createMigrationBackup(UBLOCK_RULES_KEY);
        // マイグレーション実行
        const newRules = migrateToLightweightFormat(ublockRules);
        await chrome.storage.local.set({ [UBLOCK_RULES_KEY]: newRules });
        // 成功時はバックアップを削除
        await chrome.storage.local.remove([MIGRATION_BACKUP_KEY]);
        console.log('[Migration] Successfully migrated uBlock rules');
        return true;
    }
    catch (error) {
        // 失敗時はロールバック
        console.error('[Migration] Migration failed, attempting rollback:', error);
        const restored = await restoreFromMigrationBackup(UBLOCK_RULES_KEY);
        if (restored) {
            console.log('[Migration] Rollback successful');
        }
        else {
            console.error('[Migration] Rollback failed');
        }
        throw error;
    }
}
//# sourceMappingURL=migration.js.map