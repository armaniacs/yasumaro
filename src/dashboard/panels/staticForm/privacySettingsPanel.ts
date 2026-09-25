import { type PanelLifecycle } from '../types.js';
import { tryNavigate } from '../registryContext.js';
import { init as initPrivacySettings, loadPrivacySettings } from '../../settings/privacySettings.js';
import { initMasterPasswordSettings, loadMasterPasswordSettings } from '../../masterPassword.js';
import { initNavTrailToggle } from '../../settings/navTrailToggle.js';
import { getPrivacyConsent, withdrawPrivacyConsent } from '../../../utils/storage/privacyConsent.js';
import { getMessageOr } from '../../../utils/i18n.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { clearAllLogs, isServiceError } from '../../dashboardSqliteService.js';

export function createPrivacySettingsPanel(): PanelLifecycle & { refresh?: () => Promise<void> } {
  return {
    id: 'panel-privacy',
    category: 'static-form',
    async mount(container) {
      initPrivacySettings();
      initMasterPasswordSettings();
      await loadMasterPasswordSettings();
      // PBI 03: the opt-in navigation-trail switch lives on the privacy panel
      // because it is a consent decision, not a recording preference.
      await initNavTrailToggle(container);

      const display = container.querySelector('#consentStatusDisplay') as HTMLElement | null;
      const btn = container.querySelector('#btnWithdrawConsent') as HTMLButtonElement | null;
      const statusEl = container.querySelector('#withdrawConsentStatus') as HTMLElement | null;
      if (display && btn) {
        const state = await getPrivacyConsent();
        display.textContent = state.hasConsented
          ? (state.consentDate
              ? getMessageOr('consented', `Consented (${state.consentDate})`, [state.consentDate])
              : getMessageOr('consentedNoDate', 'Consented'))
          : getMessageOr('notConsented', 'Not consented');
        btn.classList.toggle('hidden', !state.hasConsented);
        btn.addEventListener('click', async () => {
          const confirmed = await showConfirmDialog({
            title: getMessageOr('confirmWithdrawConsentTitle', 'Withdraw Privacy Consent'),
            message: getMessageOr('confirmWithdrawConsentMessage', 'Withdrawing consent will also permanently delete all previously recorded browsing history. Continue?'),
            confirmLabel: getMessageOr('confirmDelete', 'Delete'),
            cancelLabel: getMessageOr('cancel', 'Cancel'),
            dangerous: true,
          });
          if (!confirmed) return;

          // データ削除→同意撤回の順で行う。同意撤回だけ成功しデータが
          // 残る不整合（GDPR Art.7の実効性を損なう）を避けるため。
          const delRes = await clearAllLogs();
          if (isServiceError(delRes)) {
            if (statusEl) {
              const base = getMessageOr('withdrawConsentDataDeleteFailed', 'Failed to delete recorded data. Your consent status was not changed.');
              statusEl.textContent = `${base} (${delRes.error})`;
              statusEl.style.color = 'var(--color-error)';
            }
            return;
          }

          const ok = await withdrawPrivacyConsent();
          if (statusEl) {
            statusEl.textContent = ok
              ? getMessageOr('consentWithdrawnStopped', 'Consent withdrawn. Recording will stop.')
              : getMessageOr('consentWithdrawFailed', 'Failed to withdraw consent.');
            statusEl.style.color = ok ? 'var(--color-success-text)' : 'var(--color-error)';
          }
          display.textContent = getMessageOr('notConsented', 'Not consented');
          btn.classList.add('hidden');
          // PBI 03: withdrawPrivacyConsent() already switched the feature off
          // in storage; this only keeps the rendered checkbox in step.
          const navTrail = container.querySelector('#navTrailEnabled') as HTMLInputElement | null;
          if (navTrail) navTrail.checked = false;
        });
      }

      container.querySelector('#btnDeleteAllData')?.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
          title: getMessageOr('confirmClearAllTitle', 'Delete All History'),
          message: getMessageOr('confirmClearAllMessage', getMessageOr('deleteAllDataConfirm', 'This will permanently delete all stored data. Continue?')),
          confirmLabel: getMessageOr('confirmDelete', 'Delete'),
          cancelLabel: getMessageOr('cancel', 'Cancel'),
          dangerous: true,
        });
        if (!confirmed) return;
        try {
          await chrome.storage.local.clear();
          const sqliteResult = await clearAllLogs();
          if (isServiceError(sqliteResult)) {
            const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
            if (statusEl2) {
              const base = getMessageOr('deleteAllDataFailed', 'Failed to clear browsing logs. Please try again.');
              statusEl2.textContent = `${base} (${sqliteResult.error})`;
            }
            return;
          }
          const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
          if (statusEl2) statusEl2.textContent = chrome.i18n.getMessage('deleteAllDataSuccess');
          setTimeout(() => window.location.reload(), 2000);
        } catch {
          const statusEl2 = container.querySelector('#deleteAllDataStatus') as HTMLElement | null;
          if (statusEl2) statusEl2.textContent = getMessageOr('deleteAllDataFailed', 'Failed to delete all data.');
        }
      });

      container.querySelector('#btnGoToExportLogs')?.addEventListener('click', () => {
        // Registry 経由で遷移する (PBI 2026-09-07-25)。以前の sidebar ボタンの
        // click シミュレートは DOM 迂回であり、sidebar の active 同期は
        // Bootstrapper の navigate 購読が担う。registry 未初期化時 (単体テスト等)
        // は何もしない — tryNavigate() が失敗時に何もしない。
        tryNavigate('panel-export-logs');
      });
    },
    async refresh() {
      await loadPrivacySettings();
    },
  };
}
