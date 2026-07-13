import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../../../popup/privacySettings.js';
import { initMasterPasswordSettings, loadMasterPasswordSettings } from '../../masterPassword.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../../../popup/privacyConsent.js';
import { getMessage } from '../../../popup/i18n.js';

export function createPrivacySettingsPanel(): StaticFormPanel {
  return {
    id: 'panel-privacy',
    category: 'static-form',
    async mount(container) {
      initPrivacySettings();
      initMasterPasswordSettings();
      await loadMasterPasswordSettings();

      const display = container.querySelector('#consentStatusDisplay') as HTMLElement | null;
      const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement | null;
      const statusEl = container.querySelector('#withdrawConsentStatus') as HTMLElement | null;
      if (display && btn) {
        const state = await getPrivacyConsent();
        display.textContent = state.hasConsented
          ? chrome.i18n.getMessage('consented') || `Consented (${state.consentDate || ''})`
          : chrome.i18n.getMessage('notConsented') || 'Not consented';
        btn.classList.toggle('hidden', !state.hasConsented);
        btn.addEventListener('click', async () => {
          const ok = await withdrawPrivacyConsent();
          if (statusEl) {
            statusEl.textContent = ok ? 'Consent withdrawn. Recording will stop.' : 'Failed to withdraw consent.';
            statusEl.style.color = ok ? 'var(--color-success-text)' : 'var(--color-error)';
          }
          display.textContent = 'Not consented';
          btn.classList.add('hidden');
        });
      }

      container.querySelector('#btnDeleteAllData')?.addEventListener('click', async () => {
        const { showConfirmDialog } = await import('../../utils/confirmDialog.js');
        const confirmed = await showConfirmDialog({
          title: chrome.i18n.getMessage('confirmClearAllTitle') || 'Delete All History',
          message: chrome.i18n.getMessage('confirmClearAllMessage') || chrome.i18n.getMessage('deleteAllDataConfirm') || 'This will permanently delete all stored data. Continue?',
          confirmLabel: chrome.i18n.getMessage('confirmDelete') || 'Delete',
          cancelLabel: chrome.i18n.getMessage('cancel') || 'Cancel',
          dangerous: true,
        });
        if (!confirmed) return;
        try {
          await chrome.storage.local.clear();
          const { clearAllLogs } = await import('../../dashboardSqliteService.js');
          const sqliteResult = await clearAllLogs();
          if (!sqliteResult) {
            const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
            if (statusEl2) statusEl2.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to clear browsing logs. Please try again.';
            return;
          }
          const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
          if (statusEl2) statusEl2.textContent = chrome.i18n.getMessage('deleteAllDataSuccess');
          setTimeout(() => window.location.reload(), 2000);
        } catch {
          const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
          if (statusEl2) statusEl2.textContent = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to delete all data.';
        }
      });

      container.querySelector('#btnGoToExportLogs')?.addEventListener('click', () => {
        document.querySelector<HTMLButtonElement>('.sidebar-nav-btn[data-panel="panel-export-logs"]')?.click();
      });
    },
    async refresh() {
      await loadPrivacySettings();
    },
  };
}
