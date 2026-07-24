/**
 * storage.ts
 * Wrapper for chrome.storage.local to manage settings.
 *
 * 【リファクタリング履歴】
 * - 単一ファイル（1639行）から storage/types.ts, storage/defaults.ts へ分割
 * - さらに storage.ts 本体（1364行、38 export）を4つの深いモジュールへ分割:
 *   - storage/encryptionSession.ts - マスターパスワード・暗号化キー・HMAC secret
 *   - storage/savedUrlStore.ts     - 保存URL集合・LRU管理・レガシークリーンアップ
 *   - storage/settingsStore.ts     - 設定CRUD・移行・許可URLリスト構築
 *   - storage/domainFilterCache.ts - Content Script向けドメインフィルタキャッシュ
 *
 * このファイルは後方互換のための再エクスポート層。新規コードは上記の
 * 各モジュールから直接importすることを推奨する。
 */

/** @deprecated Use direct module imports instead (see file header). */
export type { EncryptionEnvelope } from './crypto.js';

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
    API_KEY_FIELDS,
    isDomainInWhitelist,
    migrateToSingleSettingsObject,
    getSettings,
    clearSettingsCache,
    saveSettings,
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls,
    purgeLegacyStorage,
} from './storage/settingsStore.js';

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
} from './storage/savedUrlStore.js';
/** @deprecated Use direct module imports instead (see file header). */
export type { SavedUrlEntry } from './storage/savedUrlStore.js';

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
