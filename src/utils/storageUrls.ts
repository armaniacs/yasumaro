/**
 * utils/url モジュールのエクスポートを集約したファイル
 * storageUrls.ts を分割したファイル群のエクスポートを集約
 */

// 型定義と定数
export type { SavedUrlEntry, CleansedReason } from './urlEntry.js';
export type { SavedUrlEntryMetadataPatch } from './storage/savedUrlStore.js';
export {
    MAX_URL_SET_SIZE,
    URL_WARNING_THRESHOLD,
    URL_RETENTION_DAYS
} from './urlEntry.js';

// 基本URL管理機能
export {
    getSavedUrls,
    setSavedUrls,
    getSavedUrlsWithTimestamps,
    setSavedUrlsWithTimestamps,
    getSavedUrlEntries,
    addSavedUrl,
    removeSavedUrl,
    isUrlSaved,
    getSavedUrlCount,
    updateSavedUrlEntry,
    mergeSavedUrlEntry,
    saveSavedUrlEntryMetadata,
    setUrlTags,
    addUrlTag,
    removeUrlTag
} from './storage/savedUrlStore.js';

// 許可URL管理機能
export {
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls
} from './allowedUrls.js';
