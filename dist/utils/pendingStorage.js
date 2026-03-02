import { logInfo, logDebug, logError, ErrorCode } from './logger.js';
import { hashUrl } from './crypto.js';
const PENDING_PAGES_KEY = 'osh_pending_pages';
/**
 * Retrieves the list of pending pages directly from chrome.storage.local.
 * @returns Promise resolving to an array of PendingPage objects, or an empty array if none exist.
 */
async function getPendingPagesList() {
    try {
        const result = await chrome.storage.local.get(PENDING_PAGES_KEY);
        return result[PENDING_PAGES_KEY] || [];
    }
    catch (error) {
        await logError('Failed to get pending pages list', { error: error instanceof Error ? error.message : String(error), source: 'pendingStorage' }, ErrorCode.STORAGE_READ_FAILURE);
        return [];
    }
}
/**
 * Adds a pending page to storage if it doesn't already exist.
 * @param page - The PendingPage object to add.
 * @returns Promise that resolves when the operation is complete.
 */
export async function addPendingPage(page) {
    try {
        let pages;
        try {
            pages = await getPendingPagesList();
        }
        catch {
            pages = [];
        }
        // Exclusion of duplicates
        const exists = pages.some(p => p.url === page.url);
        const urlHash = await hashUrl(page.url);
        await logInfo('addPendingPage called', { urlHash, exists, currentCount: pages.length, source: 'pendingStorage' });
        if (exists)
            return;
        const updatedPages = [...pages, page];
        await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
        await logDebug('Pending page saved', { newCount: updatedPages.length, source: 'pendingStorage' });
    }
    catch (error) {
        await logError('Failed to add pending page', { error: error instanceof Error ? error.message : String(error), urlHash: await hashUrl(page.url), source: 'pendingStorage' }, ErrorCode.STORAGE_WRITE_FAILURE);
        throw error;
    }
}
/**
 * Retrieves all non-expired pending pages from storage.
 * @returns Promise resolving to an array of PendingPage objects that have not expired.
 */
export async function getPendingPages() {
    try {
        const pages = await getPendingPagesList();
        return pages.filter(p => p.expiry > Date.now());
    }
    catch (error) {
        await logError('Failed to get pending pages', { error: error instanceof Error ? error.message : String(error), source: 'pendingStorage' }, ErrorCode.STORAGE_READ_FAILURE);
        return [];
    }
}
/**
 * Removes pending pages with matching URLs from storage.
 * @param urls - Array of URLs to remove from pending pages.
 * @returns Promise that resolves when the operation is complete.
 */
export async function removePendingPages(urls) {
    try {
        const pages = await getPendingPagesList();
        const urlSet = new Set(urls);
        const updatedPages = pages.filter(p => !urlSet.has(p.url));
        await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
    }
    catch (error) {
        await logError('Failed to remove pending pages', { error: error instanceof Error ? error.message : String(error), urlsCount: urls.length, source: 'pendingStorage' }, ErrorCode.STORAGE_WRITE_FAILURE);
    }
}
/**
 * Removes all expired pending pages from storage.
 * @returns Promise that resolves when the operation is complete.
 */
export async function clearExpiredPages() {
    try {
        const pages = await getPendingPagesList();
        const updatedPages = pages.filter(p => p.expiry > Date.now());
        await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
    }
    catch (error) {
        await logError('Failed to clear expired pages', { error: error instanceof Error ? error.message : String(error), source: 'pendingStorage' }, ErrorCode.STORAGE_WRITE_FAILURE);
    }
}
//# sourceMappingURL=pendingStorage.js.map