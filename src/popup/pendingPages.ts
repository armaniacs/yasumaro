import { setElementHtml } from '../utils/htmlFragment.js';
import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { ErrorCode, type ErrorCodeValues } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { getMessageOr } from '../utils/i18n.js';
import { showConfirmDialog } from '../utils/ui/confirmDialog.js';
import { showSuccess, showError } from './errorUtils.js';
import { escapeHtml, clearElement } from './domUtils.js';
import { recordPendingPage } from '../messaging/pendingRecordGateway.js';
import {
  addDomainToWhitelist,
  addPathToWhitelist,
  type WhitelistWriteResult,
} from './whitelistWriter.js';

/**
 * Single failure path for the pending-list actions. The awaited storage and
 * messaging seams reject on their own (a locked master password makes every
 * settings write throw), and a rejected click handler left no trace — the
 * list simply stopped changing. Result-based failures are routed here too:
 * the pending-record gateway normalizes every record failure to
 * {success:false} instead of rejecting, and the whitelist writer returns
 * {ok:false} for rejected patterns.
 *
 * The user-visible sentence derives from the failure payload via
 * errorUtils.showError — the single popup display contract, shared with the
 * status-panel and private-page dialog boundaries.
 */
function reportActionFailure(message: string, error: unknown, errorCode: ErrorCodeValues): void {
  const statusDiv = document.getElementById('mainStatus');
  if (statusDiv) showError(statusDiv, error);
  logError(message, { cause: error }, errorCode);
}

export async function loadPendingPages(): Promise<void> {
  try {
    const pages = await getPendingPages();

    const pendingSection = document.getElementById('pending-section');
    const pendingEmpty = document.getElementById('pending-empty');
    const pendingList = document.getElementById('pending-pages-list');

    if (!pages || pages.length === 0) {
      pendingSection?.classList.add('hidden');
      pendingEmpty?.classList.remove('hidden');
      return;
    }

    pendingSection?.classList.remove('hidden');
    pendingEmpty?.classList.add('hidden');

    if (pendingList) {
      clearElement(pendingList);
      pages.forEach((page, index) => {
        const item = document.createElement('div');
        item.className = 'pending-item';
        item.dataset.url = page.url;
        item.dataset.index = String(index);

        setElementHtml(item, `
          <input type="checkbox" value="${escapeHtml(page.url)}" class="pending-checkbox">
          <div class="pending-item-content">
            <div class="pending-item-title pending-item-title--link">${escapeHtml(page.title)}</div>
            <div class="pending-item-reason">${escapeHtml(page.headerValue || page.reason)}</div>
          </div>
        `);

        const titleEl = item.querySelector('.pending-item-title');
        if (titleEl) {
          titleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: page.url });
          });
        }

        pendingList.appendChild(item);
      });
    }
  } catch (error) {
    logError('Failed to load pending pages', { cause: error }, ErrorCode.CONTENT_EXTRACTION_FAILURE);
  }
}

async function addDomainsOrPathsToWhitelist(urls: string[], type: 'domain' | 'path'): Promise<void> {
  // PBI 2026-09-12-05: validated + deduped + cache-refreshing writes live in
  // the shared whitelist writer seam. Path adds normalize to the URL's
  // hostname — the historical raw-URL / anchored-regex entries could never
  // match any whitelist consumer (all of them match hostnames) and failed
  // pattern validation.
  for (const url of urls) {
    let result: WhitelistWriteResult;
    if (type === 'domain') {
      // Guarded per entry: one unparsable stored URL must not cost the user
      // the remaining whitelist writes, nor the save pass that follows them.
      let domain: string;
      try {
        domain = new URL(url).hostname;
      } catch (error) {
        reportActionFailure(
          'Failed to read the hostname of a pending page URL',
          error,
          ErrorCode.INVALID_INPUT
        );
        continue;
      }
      result = await addDomainToWhitelist(domain);
    } else {
      result = await addPathToWhitelist(url);
    }
    // The writer normalizes validation failures to {ok:false} instead of
    // rejecting — an ignored result dropped the entry without a trace.
    if (!result.ok) {
      reportActionFailure(
        'Failed to add a pending page URL to the whitelist',
        new Error(result.error || result.reason),
        ErrorCode.INVALID_INPUT
      );
    }
  }
}

export async function saveSelectedPages(whitelistType?: 'domain' | 'path'): Promise<void> {
  const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const urls = Array.from(checkboxes).map(cb => cb.value);

  if (urls.length === 0) return;

  try {
    if (whitelistType) {
      await addDomainsOrPathsToWhitelist(urls, whitelistType);
    }

    // Single read for the whole batch — the per-URL read inside the loop was an
    // N+1 over chrome.storage (PBI 2026-09-11-03).
    const pages = await getPendingPages();

    // The gateway normalizes every record failure to {success:false} and never
    // rejects, so the outer catch alone could not see a dead record. Guarded
    // per entry: one failed record must not cost the rest of the batch.
    // Removal is result-driven (PBI 2026-10-03-01): a failed URL stays in
    // pending — removing it would lose the page and could race the
    // background's fire-and-forget re-registration (recordingOutcome) — while
    // removing recorded URLs keeps a retry from re-recording them.
    const failedUrls: string[] = [];
    for (const url of urls) {
      const page = pages.find(p => p.url === url);
      if (!page) continue;
      // PBI 2026-09-12-01: envelope + timeout contract lives in the shared
      // pending-record seam (the dead {type:'record'} copy here predates it).
      try {
        const result = await recordPendingPage({ title: page.title, url: page.url, force: true });
        if (result.success) continue;
        reportActionFailure(
          'Failed to record a pending page',
          new Error(result.error || 'Unknown record failure'),
          ErrorCode.OBSIDIAN_SEND_FAILURE
        );
      } catch (error) {
        reportActionFailure('Failed to record a pending page', error, ErrorCode.OBSIDIAN_SEND_FAILURE);
      }
      failedUrls.push(url);
    }

    const recordedUrls = urls.filter(url => !failedUrls.includes(url));
    if (recordedUrls.length > 0) {
      await removePendingPages(recordedUrls);
    }
    await loadPendingPages();
  } catch (error) {
    reportActionFailure('Failed to save the selected pending pages', error, ErrorCode.STORAGE_WRITE_FAILURE);
  }
}

export function setupEventListeners(): void {
  document.getElementById('btn-select-all')?.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.pending-checkbox') as NodeListOf<HTMLInputElement>;
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
    });
  });

  document.getElementById('btn-save-selected')?.addEventListener('click', () => {
    saveSelectedPages();
  });

  document.getElementById('btn-save-whitelist')?.addEventListener('click', () => {
    saveSelectedPages('domain');
  });

  document.getElementById('btn-discard')?.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
    const urls = Array.from(checkboxes).map(cb => cb.value);

    if (urls.length === 0) {
      const statusDiv = document.getElementById('mainStatus');
      if (statusDiv) {
        showSuccess(statusDiv, getMessageOr('pendingPagesEmpty', 'No items selected.'));
      }
      return;
    }

    // Accessible dialog seam (PBI 2026-09-17-19) replaces native confirm().
    try {
      const confirmed = await showConfirmDialog({
        message: chrome.i18n.getMessage('warningConfirmSave'),
      });
      if (confirmed) {
        await removePendingPages(urls);
        await loadPendingPages();
      }
    } catch (error) {
      reportActionFailure('Failed to discard the selected pending pages', error, ErrorCode.STORAGE_WRITE_FAILURE);
    }
  });
}