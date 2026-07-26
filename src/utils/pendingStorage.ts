import { logInfo, logDebug, logError, ErrorCode } from './logger.js';
import { errorMessage } from './errorUtils.js';
import { hashUrl } from './crypto.js';

export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: 'cache-control' | 'set-cookie' | 'authorization' | 'pipeline-error' | 'obsidian-write-failed' | 'local-ai-unavailable';
  headerValue?: string;
  expiry: number;
  errorMessage?: string;
}

export const PENDING_PAGES_KEY = 'pending_pages';
const LEGACY_PENDING_PAGES_KEY = 'osh_pending_pages';

/**
 * Migrates pending pages data from the legacy 'osh_pending_pages' key
 * (from the pre-rebrand "Obsidian Smart History" project name) to the
 * current 'pending_pages' key. No-op if the legacy key holds no data.
 */
export async function migrateLegacyPendingPagesKey(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(LEGACY_PENDING_PAGES_KEY);
    const legacyPages = result[LEGACY_PENDING_PAGES_KEY] as PendingPage[] | undefined;
    if (!legacyPages || legacyPages.length === 0) {
      if (LEGACY_PENDING_PAGES_KEY in result) {
        await chrome.storage.local.remove(LEGACY_PENDING_PAGES_KEY);
      }
      return;
    }

    const currentPages = await getPendingPagesList();
    const existingUrls = new Set(currentPages.map(p => p.url));
    const mergedPages = [...currentPages, ...legacyPages.filter(p => !existingUrls.has(p.url))];

    await chrome.storage.local.set({ [PENDING_PAGES_KEY]: mergedPages });
    await chrome.storage.local.remove(LEGACY_PENDING_PAGES_KEY);

    await logInfo(
      'Migrated pending pages from legacy key',
      { migratedCount: legacyPages.length, source: 'pendingStorage' }
    );
  } catch (error) {
    await logError(
      'Failed to migrate legacy pending pages key',
      { error: errorMessage(error), source: 'pendingStorage' },
      ErrorCode.STORAGE_MIGRATION_FAILURE
    );
  }
}

/**
 * Retrieves the list of pending pages directly from chrome.storage.local.
 * @returns Promise resolving to an array of PendingPage objects, or an empty array if none exist.
 */
async function getPendingPagesList(): Promise<PendingPage[]> {
  try {
    const result = await chrome.storage.local.get(PENDING_PAGES_KEY);
    return (result[PENDING_PAGES_KEY] as PendingPage[]) || [];
  } catch (error) {
    await logError(
      'Failed to get pending pages list',
      { error: errorMessage(error), source: 'pendingStorage' },
      ErrorCode.STORAGE_READ_FAILURE
    );
    return [];
  }
}

/**
 * Adds a pending page to storage if it doesn't already exist.
 * @param page - The PendingPage object to add.
 * @returns Promise that resolves when the operation is complete.
 */
export async function addPendingPage(page: PendingPage): Promise<void> {
  try {
    let pages: PendingPage[];
    try {
      pages = await getPendingPagesList();
    } catch {
      pages = [];
    }

    // Exclusion of duplicates
    const exists = pages.some(p => p.url === page.url);
    const urlHash = await hashUrl(page.url);
    await logInfo('addPendingPage called', { urlHash, exists, currentCount: pages.length, source: 'pendingStorage' });
    if (exists) return;

    const updatedPages = [...pages, page];

    await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
    await logDebug('Pending page saved', { newCount: updatedPages.length, source: 'pendingStorage' });
  } catch (error) {
    await logError(
      'Failed to add pending page',
      { error: errorMessage(error), urlHash: await hashUrl(page.url), source: 'pendingStorage' },
      ErrorCode.STORAGE_WRITE_FAILURE
    );
    throw error;
  }
}

/**
 * Retrieves all non-expired pending pages from storage.
 * @returns Promise resolving to an array of PendingPage objects that have not expired.
 */
export async function getPendingPages(): Promise<PendingPage[]> {
  try {
    const pages = await getPendingPagesList();
    return pages.filter(p => p.expiry > Date.now());
  } catch (error) {
    await logError(
      'Failed to get pending pages',
      { error: errorMessage(error), source: 'pendingStorage' },
      ErrorCode.STORAGE_READ_FAILURE
    );
    return [];
  }
}

/**
 * Removes pending pages with matching URLs from storage.
 * @param urls - Array of URLs to remove from pending pages.
 * @returns Promise that resolves when the operation is complete.
 */
export async function removePendingPages(urls: string[]): Promise<void> {
  try {
    const pages = await getPendingPagesList();
    const urlSet = new Set(urls);
    const updatedPages = pages.filter(p => !urlSet.has(p.url));

    await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
  } catch (error) {
    await logError(
      'Failed to remove pending pages',
      { error: errorMessage(error), urlsCount: urls.length, source: 'pendingStorage' },
      ErrorCode.STORAGE_WRITE_FAILURE
    );
  }
}

/**
 * Removes all expired pending pages from storage.
 * @returns Promise that resolves when the operation is complete.
 */
export async function clearExpiredPages(): Promise<void> {
  try {
    const pages = await getPendingPagesList();
    const updatedPages = pages.filter(p => p.expiry > Date.now());

    await chrome.storage.local.set({ [PENDING_PAGES_KEY]: updatedPages });
  } catch (error) {
    await logError(
      'Failed to clear expired pages',
      { error: errorMessage(error), source: 'pendingStorage' },
      ErrorCode.STORAGE_WRITE_FAILURE
    );
  }
}
