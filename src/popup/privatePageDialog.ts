import type { PendingSave } from './mainTypes.js';
import { extractDomain } from '../utils/domainUtils.js';
import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getMessage } from './i18n.js';

export let currentPendingSave: PendingSave | null = null;

export function setCurrentPendingSave(save: PendingSave | null): void {
  currentPendingSave = save;
}

function showPrivatePageDialog(url: string, reason: string, headerValue: string): void {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  const messageEl = document.getElementById('dialog-message');

  if (messageEl) {
    const header = headerValue || reason;
    messageEl.textContent = chrome.i18n.getMessage('warningPrivatePageMessage', [header, url]);
  }

  dialog?.showModal();
}

async function recordWithForce(): Promise<void> {
  if (!currentPendingSave) return;

  const response = await chrome.runtime.sendMessage({
    type: 'record',
    data: {
      title: currentPendingSave.title,
      url: currentPendingSave.url,
      content: currentPendingSave.content,
      force: true
    }
  });

  const statusDiv = document.getElementById('mainStatus');
  if (response?.success) {
    if (statusDiv) {
      statusDiv.textContent = getMessage('saveSuccess');
      statusDiv.className = 'success';
    }
    startAutoCloseTimer();
  } else {
    if (statusDiv) {
      statusDiv.textContent = `${getMessage('saveError')}: ${response?.error || 'Unknown error'}`;
      statusDiv.className = 'error';
    }
  }

  currentPendingSave = null;
}

document.getElementById('dialog-cancel')?.addEventListener('click', () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  currentPendingSave = null;
});

document.getElementById('dialog-save-once')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    await recordWithForce();
  }
});

document.getElementById('dialog-save-domain')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    const domain = extractDomain(currentPendingSave.url);
    if (domain) {
      const settings = await getSettings();
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
      if (!whitelist.includes(domain)) {
        whitelist.push(domain);
        await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);
      }
    }
    await recordWithForce();
  }
});

document.getElementById('dialog-save-path')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();

  if (currentPendingSave) {
    const settings = await getSettings();
    const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    if (!whitelist.includes(currentPendingSave.url)) {
      whitelist.push(currentPendingSave.url);
      await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);
    }
    await recordWithForce();
  }
});

export { showPrivatePageDialog };