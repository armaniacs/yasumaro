/**
 * storage/savedUrlStore.ts
 * @deprecated Import directly from savedUrlRepository.ts instead.
 *
 * This file is a backward-compatibility re-export layer. All logic has
 * moved to savedUrlRepository.ts (PBI: architecture deepening).
 *
 * New code should import from:
 *   - src/utils/storage/savedUrlRepository.ts (functions + types)
 *   - src/utils/urlEntry.ts (SavedUrlEntry type + constants)
 */

export {
    getSavedUrls,
    getSavedUrlsWithTimestamps,
    getSavedUrlEntries,
    setSavedUrls,
    setSavedUrlsWithTimestamps,
    addSavedUrl,
    removeSavedUrl,
    isUrlSaved,
    getSavedUrlCount,
    mergeSavedUrlEntry,
    updateSavedUrlEntry,
    saveSavedUrlEntryMetadata,
    setUrlTags,
    addUrlTag,
    removeUrlTag,
    purgeLegacyStorage,
    MAX_URL_SET_SIZE,
    URL_RETENTION_DAYS,
    MAX_CONTENT_ENTRIES,
} from './savedUrlRepository.js';

export type {
    SavedUrlEntry,
    SavedUrlEntryMetadataPatch,
    SaveSavedUrlEntryMetadataOptions,
} from './savedUrlRepository.js';

// Re-export URL_WARNING_THRESHOLD from urlEntry for backward compat
export { URL_WARNING_THRESHOLD } from '../urlEntry.js';
