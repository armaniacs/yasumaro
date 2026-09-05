import type { PendingSave } from './mainTypes.js';
import { extractDomain } from '../utils/domainUtils.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { updateDomainFilterCache } from '../utils/storage/domainFilterCache.js';
import { startAutoCloseTimer } from './autoClose.js';
import { getMessage } from '../utils/i18n.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';

export let currentPendingSave: PendingSave | null = null;

export function setCurrentPendingSave(save: PendingSave | null): void {
  currentPendingSave = save;
}

let privatePageTrapId: string | null = null;
let recordingFailedTrapId: string | null = null;

function releasePrivatePageTrap(): void {
  if (privatePageTrapId) {
    focusTrapManager.release(privatePageTrapId);
    privatePageTrapId = null;
  }
}

function releaseRecordingFailedTrap(): void {
  if (recordingFailedTrapId) {
    focusTrapManager.release(recordingFailedTrapId);
    recordingFailedTrapId = null;
  }
}

/**
 * 'close' event (native Escape/backdrop/dialog.close) must always release
 * the trap, even for close paths that bypass the button handlers below.
 */
function ensureCloseRelease(dialog: HTMLDialogElement, onClose: () => void): void {
  const el = dialog as HTMLDialogElement & { dataset: DOMStringMap };
  if (el.dataset.focusTrapWired === 'true') return;
  el.dataset.focusTrapWired = 'true';
  dialog.addEventListener('close', onClose);
}

function showPrivatePageDialog(url: string, reason: string, headerValue: string): void {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  const messageEl = document.getElementById('dialog-message');

  if (messageEl) {
    const header = headerValue || reason;
    messageEl.textContent = chrome.i18n.getMessage('warningPrivatePageMessage', [header, url]);
  }

  if (!dialog) return;
  dialog.showModal();
  ensureCloseRelease(dialog, releasePrivatePageTrap);
  // Re-open guard: never double-trap
  releasePrivatePageTrap();
  // Escape routes to the existing close path; 'close' event releases the trap
  privatePageTrapId = focusTrapManager.trap(dialog, () => dialog.close());
}

/**
 * Shows the failure dialog for pages that were withheld by an error rather than
 * by privacy detection. Only retrying makes sense here, so no whitelist options
 * are offered.
 */
function showRecordingFailedDialog(url: string, reasonLabel: string): void {
  const dialog = document.getElementById('recording-failed-dialog') as HTMLDialogElement;
  const messageEl = document.getElementById('recording-failed-message');

  if (messageEl) {
    messageEl.textContent = chrome.i18n.getMessage('recordingFailedDialogMessage', [reasonLabel, url]);
  }

  if (!dialog) return;
  dialog.showModal();
  ensureCloseRelease(dialog, releaseRecordingFailedTrap);
  // Re-open guard: never double-trap
  releaseRecordingFailedTrap();
  // Escape routes to the existing close path; 'close' event releases the trap
  recordingFailedTrapId = focusTrapManager.trap(dialog, () => dialog.close());
}

/**
 * Re-sends the pending page to the background worker.
 * @param force bypasses privacy detection; used only when the user explicitly
 *              chose to save a page that was flagged as private.
 */
async function recordPendingSave(force: boolean): Promise<void> {
  if (!currentPendingSave) return;

  const response = await chrome.runtime.sendMessage({
    type: 'record',
    data: {
      title: currentPendingSave.title,
      url: currentPendingSave.url,
      content: currentPendingSave.content,
      force
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

async function recordWithForce(): Promise<void> {
  await recordPendingSave(true);
}

document.getElementById('dialog-cancel')?.addEventListener('click', () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  releasePrivatePageTrap();
  currentPendingSave = null;
});

document.getElementById('dialog-save-once')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  releasePrivatePageTrap();

  if (currentPendingSave) {
    await recordWithForce();
  }
});

document.getElementById('dialog-save-domain')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  releasePrivatePageTrap();

  if (currentPendingSave) {
    const domain = extractDomain(currentPendingSave.url);
    if (domain) {
      const settings = await settingsRepository.getAll();
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
      if (!whitelist.includes(domain)) {
        whitelist.push(domain);
        await settingsRepository.setAll({ [StorageKeys.DOMAIN_WHITELIST]: whitelist });
        await updateDomainFilterCache(await settingsRepository.getAll());
      }
    }
    await recordWithForce();
  }
});

document.getElementById('dialog-save-path')?.addEventListener('click', async () => {
  const dialog = document.getElementById('private-page-dialog') as HTMLDialogElement;
  dialog?.close();
  releasePrivatePageTrap();

  if (currentPendingSave) {
    const settings = await settingsRepository.getAll();
    const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
    if (!whitelist.includes(currentPendingSave.url)) {
      whitelist.push(currentPendingSave.url);
      await settingsRepository.setAll({ [StorageKeys.DOMAIN_WHITELIST]: whitelist });
      await updateDomainFilterCache(await settingsRepository.getAll());
    }
    await recordWithForce();
  }
});

document.getElementById('recording-failed-dismiss')?.addEventListener('click', () => {
  const dialog = document.getElementById('recording-failed-dialog') as HTMLDialogElement;
  dialog?.close();
  releaseRecordingFailedTrap();
  currentPendingSave = null;
});

document.getElementById('recording-failed-retry')?.addEventListener('click', async () => {
  const dialog = document.getElementById('recording-failed-dialog') as HTMLDialogElement;
  dialog?.close();
  releaseRecordingFailedTrap();

  if (currentPendingSave) {
    // Not a privacy decision: retry the normal path so detection still applies.
    await recordPendingSave(false);
  }
});

export { showPrivatePageDialog, showRecordingFailedDialog };