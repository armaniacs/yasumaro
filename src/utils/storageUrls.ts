/**
 * utils/url モジュールのエクスポートを集約したファイル
 * storageUrls.ts を分割したファイル群のエクスポートを集約
 */

// 型定義と定数
export type { SavedUrlEntry, CleansedReason } from './urlEntry.js';
export {
    MAX_URL_SET_SIZE,
    URL_WARNING_THRESHOLD,
    URL_RETENTION_DAYS,
    MAX_CONTENT_ENTRIES
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
    getSavedUrlCount
} from './urlStorage.js';

// URLメタデータ設定機能
export {
    setUrlRecordType,
    setUrlContent,
    setUrlCleansedReason,
    setUrlMaskedCount,
    setUrlTags,
    addUrlTag,
    removeUrlTag,
    setUrlAiSummary,
    setUrlSentTokens,
    setUrlReceivedTokens,
    setUrlOriginalTokens,
    setUrlCleansedTokens,
    setUrlPageBytes,
    setUrlCandidateBytes,
    setUrlOriginalBytes,
    setUrlCleansedBytes,
    setUrlAiSummaryOriginalBytes,
    setUrlAiSummaryCleansedBytes,
    setUrlAiSummaryCleansedElements,
    setUrlAiSummaryCleansedReason,
    setUrlAiSummaryCleansedReasons,
    setUrlAiProvider,
    setUrlAiModel,
    setUrlAiDuration,
    setUrlObsidianDuration,
    setUrlExtractedSentencesBytes,
    setUrlExtractedSentencesOriginalBytes,
    setUrlFallbackTriggered
} from './urlMetadata.js';

// 許可URL管理機能
export {
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls
} from './allowedUrls.js';