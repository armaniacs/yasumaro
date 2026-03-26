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

interface OldRule {
  domain: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OldFormat {
  blockRules?: OldRule[];
  exceptionRules?: OldRule[];
  metadata?: Record<string, unknown>;
  // Potentially already migrated keys
  blockDomains?: string[];
  exceptionDomains?: string[];
}

interface NewFormat {
  blockDomains: string[];
  exceptionDomains: string[];
  metadata: {
    importedAt: number;
    ruleCount: number;
    migrated: true;
    [key: string]: unknown;
  };
}

/**
 * マイグレーションバックアップ
 */
interface MigrationBackup {
  timestamp: number;
  originalData: OldFormat | null;
  checksum: string;
}

/** 簡易チェックサム（データ長 + 先頭100文字の charCode 合計） */
export function computeChecksum(data: unknown): string {
  const str = JSON.stringify(data) ?? '';
  const sum = str.slice(0, 100).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `${str.length}-${sum}`;
}

const MIGRATION_BACKUP_KEY = 'migration_backup';
const MIGRATION_BACKUP_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7日

/**
 * マイグレーション用バックアップを作成
 * @param {string} key - バックアップ元のストレージキー
 * @returns {Promise<void>}
 */
async function createMigrationBackup(key: string): Promise<void> {
  const result = await chrome.storage.local.get([key]);
  const originalData = (result[key] as OldFormat | undefined) || null;
  const backup: MigrationBackup = {
    timestamp: Date.now(),
    originalData,
    checksum: computeChecksum(originalData)
  };
  await chrome.storage.local.set({ [MIGRATION_BACKUP_KEY]: backup });
  console.log('[Migration] Backup created with checksum:', backup.checksum);
}

/**
 * マイグレーション用バックアップから復元
 * @param {string} key - 復元先のストレージキー
 * @returns {Promise<boolean>} 復元成功時true
 */
export async function restoreFromMigrationBackup(key: string): Promise<boolean> {
  const result = await chrome.storage.local.get([MIGRATION_BACKUP_KEY]);
  const backup = result[MIGRATION_BACKUP_KEY] as MigrationBackup | undefined;

  if (!backup || !backup.originalData) {
    console.error('[Migration] Backup not found for key:', key);
    throw new Error('[Migration] Rollback failed: backup not found');
  }

  const actualChecksum = computeChecksum(backup.originalData);
  if (backup.checksum && backup.checksum !== actualChecksum) {
    console.error('[Migration] Backup checksum mismatch', { expected: backup.checksum, actual: actualChecksum });
    throw new Error('[Migration] Rollback failed: data integrity check failed');
  }

  await chrome.storage.local.set({ [key]: backup.originalData });
  console.warn('[Migration] Rolled back from backup', key, 'at:', backup.timestamp);
  return true;
}

/**
 * 古いバックアップをクリーンアップ
 * @returns {Promise<void>}
 */
async function cleanupOldBackups(): Promise<void> {
  const result = await chrome.storage.local.get([MIGRATION_BACKUP_KEY]);
  const backup = result[MIGRATION_BACKUP_KEY] as MigrationBackup | undefined;

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
export function migrateToLightweightFormat(oldRules: OldFormat): OldFormat | NewFormat {
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
export async function migrateUblockSettings(): Promise<boolean> {
  // Use hardcoded key to avoid dynamic import in Service Worker context
  const UBLOCK_RULES_KEY = 'ublock_rules';

  // 古いバックアップのクリーンアップ
  await cleanupOldBackups();

  const result = await chrome.storage.local.get([UBLOCK_RULES_KEY]);
  const ublockRules = result[UBLOCK_RULES_KEY] as OldFormat;

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
  } catch (error) {
    console.error('[Migration] Migration failed, attempting rollback:', error);
    try {
      await restoreFromMigrationBackup(UBLOCK_RULES_KEY);
      console.log('[Migration] Rollback successful');
    } catch (rollbackError) {
      console.error('[Migration] Rollback also failed:', rollbackError);
      throw new Error(
        `Migration failed and rollback also failed. ` +
        `Original: ${error}. Rollback: ${rollbackError}`
      );
    }
    throw error;
  }
}

/**
 * Tranco バージョン初期化（非推奨）
 *
 * ⚠️ この関数は非推奨です。TrustDb.initialize() が唯一の初期化パスとして
 * 使用してください。この関数は後方互換性のために残されていますが、
 * 新規コードでは使用しないでください。
 *
 * 理由: TrustDbとmigration.tsで二重に初期化処理が存在し、競合リスクがある
 * @deprecated Use TrustDb.initialize() instead
 */
export async function initializeTrancoVersion(): Promise<void> {
  console.warn('[Migration] initializeTrancoVersion() is deprecated. Use TrustDb.initialize() instead.');
  // TrustDbに委譲（二重初期化を防止）
  const { getTrustDb } = await import('./trustDb/trustDb.js');
  const db = getTrustDb();
  await db.initialize();
}