// @layer Barrel — Re-export (deprecated, use direct imports)
/**
 * storage.ts
 * Wrapper for chrome.storage.local to manage settings.
 *
 * 【リファクタリング履歴】
 * - 単一ファイル（1639行）から storage/types.ts, storage/defaults.ts へ分割
 * - さらに storage.ts 本体（1364行、38 export）を4つの深いモジュールへ分割:
 *   - storage/encryptionSession.ts - マスターパスワード・暗号化キー・HMAC secret
 *   - storage/savedUrlStore.ts     - 保存URL集合・LRU管理・レガシークリーンアップ
 *   - storage/SettingsRepository.ts - 設定CRUD・移行・decrypt（唯一の設定アクセス経路）
 *   - storage/domainFilterCache.ts - Content Script向けドメインフィルタキャッシュ
 * - Phase15: SettingsRepository へ統一。本ファイルは残余 call site 用の
 *   互換 re-export 層。新規コードは SettingsRepository を直接 import すること。
 *
 * 【残置理由（PBI-28確定）】
 * - テストの barrel 参照はゼロ（全テストが直接モジュールを import/mocks する）
 * - 本ファイルは削除不可: `src/utils/trustDb/trancoConsentManager.ts` が
 *   `await import('../storage.js')` で getSettings/saveSettings を実行時に取得する
 *   （storage/trustDb 間の循環を dynamic import で回避する意図的設計。
 *   詳細は dev-docs/LAYERS.md「Layer 1-循環」および ADR
 *   2026-08-20-utils-layer-circular-dependency を参照）
 * - `trancoVersionTracker.ts` の `typeof import('../storage.js')`（型のみ）も残る
 */

/** @deprecated Use direct module imports instead (see file header). */
export type { EncryptionEnvelope } from './crypto/index.js';

/** @deprecated Use direct module imports instead (see file header). */
export { StorageKeys } from './storage/types.js';
/** @deprecated Use direct module imports instead (see file header). */
export { DEFAULT_SETTINGS } from './storage/defaults.js';
/** @deprecated Use direct module imports instead (see file header). */
export type { StorageKey, StorageKeyValues, StrictSettings, Settings, ProviderSlot } from './storage/types.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
    getOrCreateEncryptionKey,
    isMasterPasswordEnabled,
    isEncryptionLocked,
    setMasterPassword,
    unlockWithPassword,
    lockSession,
    changeMasterPassword,
    removeMasterPassword,
    clearEncryptionKeyCache,
    getOrCreateHmacSecret,
} from './storage/encryptionSession.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
    ALLOWED_AI_PROVIDER_DOMAINS,
    isDomainInWhitelist,
    buildAllowedUrls,
    computeUrlsHash,
    getAllowedUrls,
} from './storage/urlWhitelist.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
    API_KEY_FIELDS,
    migrateToSingleSettingsObject,
    cleanupExpiredSettingsBackups,
    LEGACY_SETTINGS_BACKUP_KEY,
} from './storage/settingsMigration.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
    MAX_URL_SET_SIZE,
    URL_WARNING_THRESHOLD,
    URL_RETENTION_DAYS,
    getSavedUrls,
    getSavedUrlsWithTimestamps,
    setSavedUrls,
    setSavedUrlsWithTimestamps,
    addSavedUrl,
    removeSavedUrl,
    isUrlSaved,
    getSavedUrlCount,
} from './storage/savedUrlRepository.js';
/** @deprecated Use direct module imports instead (see file header). */
export type { SavedUrlEntry } from './storage/savedUrlRepository.js';

/** @deprecated Use direct module imports instead (see file header). */
export {
    getDomainFilterCacheSync,
    isDomainFilterCacheValid,
    normalizeDomainUrl,
    matchesWildcardPattern,
    updateDomainFilterCache,
} from './storage/domainFilterCache.js';

/**
 * ストレージ使用量を取得
 * @returns {Promise<number>} 使用量（バイト）
 */
/** @deprecated Use direct module imports instead (see file header). */
export { getStorageUsage } from './storage/quota.js';

/** @deprecated Use direct module imports instead (see file header). */

/** @deprecated Use direct module imports instead (see file header). */
export { purgeLegacyStorage } from './storage/savedUrlRepository.js';

/** @deprecated Use SettingsRepository directly instead. */
export {
    settingsRepository,
    SettingsRepository,
    type SettingsReader,
    type StoragePort,
    ChromeStoragePort,
    InMemoryStoragePort,
} from './storage/SettingsRepository.js';

// Compatibility shims for call sites still importing getSettings / saveSettings
// from this barrel. These thin wrappers delegate to SettingsRepository.

import { settingsRepository } from './storage/SettingsRepository.js';
import type { Settings } from './storage/types.js';
import { updateDomainFilterCache } from './storage/domainFilterCache.js';

/** @deprecated Use settingsRepository.getAll() directly. */
export async function getSettings(): Promise<Settings> {
    return settingsRepository.getAll();
}

/** @deprecated Use settingsRepository.setAll() directly. */
export async function saveSettings(
    settings: Settings,
    _updateAllowedUrlsFlag?: boolean,
    sqliteHealthCheck?: () => Promise<boolean>
): Promise<void> {
    return settingsRepository.setAll(settings, sqliteHealthCheck ? { sqliteHealthCheck } : undefined);
}

/** @deprecated Use settingsRepository.clearCache() directly. */
export function clearSettingsCache(): void {
    settingsRepository.clearCache();
}

/** @deprecated Use settingsRepository.setAll() + updateDomainFilterCache() directly. */
export async function saveSettingsWithAllowedUrls(settings: Settings): Promise<void> {
    await settingsRepository.setAll(settings);
    await updateDomainFilterCache(settings);
}
