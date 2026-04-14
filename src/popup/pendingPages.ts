import { getPendingPages, removePendingPages } from '../utils/pendingStorage.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getMessage } from './i18n.js';
import { showSuccess } from './errorUtils.js';
import { escapeHtml } from './domUtils.js';

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
          <input type="checkbox" value="${page.url}" class="pending-checkbox">
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
  const { domainWhitelist = [] } = await chrome.storage.local.get('domainWhitelist') as { domainWhitelist?: string[] };

  const newEntries = urls.map(url => {
    if (type === 'domain') {
      const domain = new URL(url).hostname;
      return domain;
    } else {
      const urlObj = new URL(url);
      return `^${escapeRegex(urlObj.origin + urlObj.pathname)}$`;
    }
  });

  const updatedList = [...domainWhitelist, ...newEntries];
  await chrome.storage.local.set({ domainWhitelist: updatedList });
}

export async function saveSelectedPages(whitelistType?: 'domain' | 'path'): Promise<void> {
  const checkboxes = document.querySelectorAll('.pending-checkbox:checked') as NodeListOf<HTMLInputElement>;
  const urls = Array.from(checkboxes).map(cb => cb.value);

  if (urls.length === 0) return;

  if (whitelistType) {
    await addDomainsOrPathsToWhitelist(urls, whitelistType);
  }

  for (const url of urls) {
    const pages = await getPendingPages();
    const page = pages.find(p => p.url === url);
    if (page) {
      await chrome.runtime.sendMessage({
        type: 'record',
        data: {
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