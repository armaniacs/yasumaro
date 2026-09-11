import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getMessage } from '../utils/i18n.js';
import { showSuccess } from './errorUtils.js';
import { escapeHtml } from './domUtils.js';
import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { updateDomainFilterCache } from '../utils/storage/domainFilterCache.js';

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

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function addDomainsOrPathsToWhitelist(urls: string[], type: 'domain' | 'path'): Promise<void> {
  // PBI 2026-09-11-03: write through the SettingsRepository seam (settings blob)
  // instead of a top-level scattered key — after migration, getAll() only reads
  // the blob, so a direct chrome.storage.local.set was never visible to the
  // DomainFilter. Same pattern as statusPanel.ts whitelist handlers.
  const settings = await settingsRepository.getAll();
  const currentList = settings[StorageKeys.DOMAIN_WHITELIST] ?? [];

  const newEntries = urls.map(url => {
    if (type === 'domain') {
      const domain = new URL(url).hostname;
      return domain;
    } else {
      const urlObj = new URL(url);
      return `^${escapeRegex(urlObj.origin + urlObj.pathname)}$`;
    }
  });

  const updatedList = [...currentList, ...newEntries.filter(e => !currentList.includes(e))];
  await settingsRepository.setAll({ [StorageKeys.DOMAIN_WHITELIST]: updatedList } as unknown as import('../utils/storage/types.js').Settings);
  await updateDomainFilterCache(await settingsRepository.getAll());
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
      // PBI 2026-09-11-03: the old {type:'record', data:...} envelope predates
      // VALID_MESSAGE_TYPES — the router never handled it, so "Save" removed
      // the page from the list without recording it. MANUAL_RECORD is the
      // contract the MessageRouter + ManualRecordValidator expect.
      await chrome.runtime.sendMessage({
        type: 'MANUAL_RECORD',
        payload: {
          title: page.title,
          url: page.url,
          content: '',
          force: true
        }
      });
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