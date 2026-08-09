import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../../settings/privacySettings.js';
import { initMasterPasswordSettings, loadMasterPasswordSettings } from '../../masterPassword.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../../../popup/privacyConsent.js';
import { getMessage } from '../../../utils/i18n.js';

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
          const { showConfirmDialog } = await import('../../utils/confirmDialog.js');
          const confirmed = await showConfirmDialog({
            title: chrome.i18n.getMessage('confirmWithdrawConsentTitle') || 'Withdraw Privacy Consent',
            message: chrome.i18n.getMessage('confirmWithdrawConsentMessage') || 'Withdrawing consent will also permanently delete all previously recorded browsing history. Continue?',
            confirmLabel: chrome.i18n.getMessage('confirmDelete') || 'Delete',
            cancelLabel: chrome.i18n.getMessage('cancel') || 'Cancel',
            dangerous: true,
          });
          if (!confirmed) return;

          // データ削除→同意撤回の順で行う。同意撤回だけ成功しデータが
          // 残る不整合（GDPR Art.7の実効性を損なう）を避けるため。
          const { clearAllLogs, isServiceError } = await import('../../dashboardSqliteService.js');
          const deleteResult = await clearAllLogs();
          if (isServiceError(deleteResult)) {
            if (statusEl) {
              const base = chrome.i18n.getMessage('withdrawConsentDataDeleteFailed') || 'Failed to delete recorded data. Your consent status was not changed.';
              statusEl.textContent = `${base} (${deleteResult.error})`;
              statusEl.style.color = 'var(--color-error)';
            }
            return;
          }

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
          const { clearAllLogs, isServiceError } = await import('../../dashboardSqliteService.js');
          const sqliteResult = await clearAllLogs();
          if (isServiceError(sqliteResult)) {
            const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
            if (statusEl2) {
              const base = chrome.i18n.getMessage('deleteAllDataFailed') || 'Failed to clear browsing logs. Please try again.';
              statusEl2.textContent = `${base} (${sqliteResult.error})`;
            }
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
