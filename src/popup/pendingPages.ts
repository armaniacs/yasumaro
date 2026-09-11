import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getMessage } from '../utils/i18n.js';
import { showSuccess } from './errorUtils.js';
import { escapeHtml } from './domUtils.js';
import { recordPendingPage } from '../messaging/pendingRecordGateway.js';
import { addDomainToWhitelist, addPathToWhitelist } from './whitelistWriter.js';

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
      pendingList.innerHTML = '';
      pages.forEach((page, index) => {
        const item = document.createElement('div');
        item.className = 'pending-item';
        item.dataset.url = page.url;
        item.dataset.index = String(index);

        item.innerHTML = `
          <input type="checkbox" value="${escapeHtml(page.url)}" class="pending-checkbox">
          <div class="pending-item-content">
            <div class="pending-item-title pending-item-title--link">${escapeHtml(page.title)}</div>
            <div class="pending-item-reason">${escapeHtml(page.headerValue || page.reason)}</div>
          </div>
        `;

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
    if (type === 'domain') {
      const domain = new URL(url).hostname;
      await addDomainToWhitelist(domain);
    } else {
      await addPathToWhitelist(url);
    }
  }
}

export async function saveSelectedPages(whitelistType?: 'domain' | 'path'): Promise<void> {
  const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const urls = Array.from(checkboxes).map(cb => cb.value);

  if (urls.length === 0) return;

  if (whitelistType) {
    await addDomainsOrPathsToWhitelist(urls, whitelistType);
  }

  // Single read for the whole batch — the per-URL read inside the loop was an
  // N+1 over chrome.storage (PBI 2026-09-11-03).
  const pages = await getPendingPages();

  for (const url of urls) {
    const page = pages.find(p => p.url === url);
    if (page) {
      // PBI 2026-09-12-01: envelope + timeout contract lives in the shared
      // pending-record seam (the dead {type:'record'} copy here predates it).
      await recordPendingPage({ title: page.title, url: page.url, force: true });
    }
  }

  await removePendingPages(urls);
  await loadPendingPages();
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
        showSuccess(statusDiv, getMessage('pendingPagesEmpty') || 'No items selected.');
      }
      return;
    }

    if (confirm(chrome.i18n.getMessage('warningConfirmSave'))) {
      await removePendingPages(urls);
      await loadPendingPages();
    }
  });
}

// Set up event listeners on module load
setupEventListeners();