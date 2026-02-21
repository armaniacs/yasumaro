import { getSettings, saveSettings } from './storage';
/**
 * Retrieves the list of pending pages from settings.
 * @returns Promise resolving to an array of PendingPage objects, or an empty array if none exist.
 */
async function getPendingPagesList() {
    const settings = await getSettings();
    return settings['pendingPages'] || [];
}
/**
 * Adds a pending page to storage if it doesn't already exist.
 * @param page - The PendingPage object to add.
 * @returns Promise that resolves when the operation is complete.
 */
export async function addPendingPage(page) {
    const pages = await getPendingPagesList();
    // Exclusion of duplicates
    const exists = pages.some(p => p.url === page.url);
    if (exists)
        return;
    const updatedPages = [...pages, page];
    await saveSettings({ pendingPages: updatedPages });
}
/**
 * Retrieves all non-expired pending pages from storage.
 * @returns Promise resolving to an array of PendingPage objects that have not expired.
 */
export async function getPendingPages() {
    const pages = await getPendingPagesList();
    return pages.filter(p => p.expiry > Date.now());
}
/**
 * Removes pending pages with matching URLs from storage.
 * @param urls - Array of URLs to remove from pending pages.
 * @returns Promise that resolves when the operation is complete.
 */
export async function removePendingPages(urls) {
    const pages = await getPendingPagesList();
    const urlSet = new Set(urls);
    const updatedPages = pages.filter(p => !urlSet.has(p.url));
    await saveSettings({ pendingPages: updatedPages });
}
/**
 * Removes all expired pending pages from storage.
 * @returns Promise that resolves when the operation is complete.
 */
export async function clearExpiredPages() {
    const pages = await getPendingPagesList();
    const updatedPages = pages.filter(p => p.expiry > Date.now());
    await saveSettings({ pendingPages: updatedPages });
}
//# sourceMappingURL=pendingStorage.js.map