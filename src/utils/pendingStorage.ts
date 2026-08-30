import { logInfo, logDebug, logError, ErrorCode } from './logger.js';
import { errorMessage } from './errorUtils.js';
import { hashUrl } from './crypto/index.js';
import { getMessage } from './i18n.js';
import { withOptimisticLock } from './optimisticLock.js';

/**
 * Reasons a page was held back because it looks private.
 * These are user decisions: the page was detected, not failed, so the user
 * chooses whether to save it and whether to trust the domain or path.
 */
export type PrivacyPendingReason = 'cache-control' | 'set-cookie' | 'authorization';

/**
 * Reasons a page was held back because recording failed.
 * These are faults, not user decisions: retrying is the only meaningful action,
 * and whitelisting the domain would not help.
 */
export type ErrorPendingReason = 'pipeline-error' | 'obsidian-write-failed' | 'local-ai-unavailable';

export type PendingReason = PrivacyPendingReason | ErrorPendingReason;

const PRIVACY_PENDING_REASONS: ReadonlySet<string> = new Set<PrivacyPendingReason>([
  'cache-control',
  'set-cookie',
  'authorization'
]);

/**
 * True when the pending page was withheld by privacy detection rather than by a failure.
 * Callers use this to decide whether to offer "save / trust domain" or "retry".
 */
export function isPrivacyPendingReason(reason: string): reason is PrivacyPendingReason {
  return PRIVACY_PENDING_REASONS.has(reason);
}

const PENDING_REASON_MESSAGE_KEYS: Readonly<Record<PendingReason, string>> = {
  'cache-control': 'pendingReasonCache',
  'set-cookie': 'pendingReasonCookie',
  'authorization': 'pendingReasonAuth',
  'pipeline-error': 'pendingReasonPipelineError',
  'obsidian-write-failed': 'pendingReasonObsidianWriteFailed',
  'local-ai-unavailable': 'pendingReasonLocalAiUnavailable'
};

/**
 * Localized label for a pending reason. Unknown reasons fall through to the raw
 * value so a newly added reason degrades to something readable instead of blank.
 */
export function renderPendingReason(reason: string): string {
  const key = PENDING_REASON_MESSAGE_KEYS[reason as PendingReason];
  if (!key) return reason;
  return getMessage(key) || reason;
}

export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: PendingReason;
  headerValue?: string;
  expiry: number;
  errorMessage?: string;
}

export const PENDING_PAGES_KEY = 'pending_pages';

/**
 * When the stored list grows past this, addPendingPage prunes expired entries
 * before appending. Bounds the list without a dedicated alarm for the common
 * case of a user who never opens the pending panel.
 */
export const PENDING_PAGES_PRUNE_THRESHOLD = 50;
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
    const urlHash = await hashUrl(page.url);

    // Serialize the read-modify-write so a concurrent addPendingPage /
    // removePendingPages cannot slot its verify+write between our read and
    // write and drop one of the two updates (VULN-005). The dedup re-check
    // and the expiry prune both run inside the updater against the
    // freshly-read list.
    const updatedPages = await withOptimisticLock<PendingPage[]>(
      PENDING_PAGES_KEY,
      (current) => {
        const pages = Array.isArray(current) ? current : [];
        if (pages.some(p => p.url === page.url)) return pages;
        // VULN-006: prune expired entries at the write boundary so the list
        // stays bounded even when the daily purge alarm has not run yet.
        const basePages = pages.length > PENDING_PAGES_PRUNE_THRESHOLD
          ? pages.filter(p => p.expiry > Date.now())
          : pages;
        return [...basePages, page];
      }
    );

    await logInfo('addPendingPage called', {
      urlHash,
      currentCount: updatedPages.length,
      source: 'pendingStorage'
    });
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
    const urlSet = new Set(urls);
    await withOptimisticLock<PendingPage[]>(
      PENDING_PAGES_KEY,
      (current) => {
        const pages = Array.isArray(current) ? current : [];
        return pages.filter(p => !urlSet.has(p.url));
      }
    );
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
