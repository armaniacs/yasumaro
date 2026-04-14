// ============================================================================
// Tranco Consent Panel
// ============================================================================

import { getMessage } from '../popup/i18n.js';
import { showStatus } from '../popup/settingsUiHelper.js';
import { getSettings, saveSettingsWithAllowedUrls, StorageKeys } from '../utils/storage.js';

export interface TrancoConsentState {
  needsConsent: 'GRANTED' | 'DENIED' | 'PENDING' | 'ALREADY_GRANTED' | 'RETRY_NEEDED';
  grantedVersion: string | null;
  deniedReason: string | null;
  retryDaysRemaining: number | null;
  latestVersion: string;
}

export async function initTrancoConsentPanel(): Promise<void> {
  console.log('[Dashboard] Initializing Tranco Consent Panel');

  const currentVersionEl = document.getElementById('trancoCurrentVersion');
  const domainCountEl = document.getElementById('trancoDomainCount');
  const consentStatusEl = document.getElementById('trancoConsentStatus');

  if (!currentVersionEl || !domainCountEl || !consentStatusEl) {
    console.warn('[Dashboard] Tranco UI elements not found');
    return;
  }

  try {
    // Get current Tranco version
    const settings = await getSettings();
    const version = settings[StorageKeys.TRANCO_VERSION] as string | null;
    const domains = settings[StorageKeys.TRANCO_DOMAINS] as string[] || [];

    // Display version info
    if (version) {
      const d = new Date(version);
      currentVersionEl.textContent = d.toLocaleDateString(
        chrome.i18n.getUILanguage() || 'ja-JP',
        { year: 'numeric', month: 'long', day: 'numeric' }
      );
    } else {
      currentVersionEl.textContent = getMessage('trancoStatusNotUpdated');
    }

    domainCountEl.textContent = domains.length.toString();

    // Get consent state
    const consentState = await getTrancoConsentState(version || 'unknown');
    updateConsentUI(consentState);
  } catch (e) {
    console.error('[Dashboard] Error loading Tranco consent state:', e);
    showStatus('trancoUpdateStatus', getMessage('errorLoadTrancoData') || 'Trancoデータの読み込みに失敗しました', 'error');
  }
}

async function getTrancoConsentState(latestVersion: string): Promise<TrancoConsentState> {
  const settings = await getSettings();
  const grantedVersion = settings[StorageKeys.TRANCO_CONSENT_GRANTED] as string | null;
  const deniedTimestamp = settings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] as number | null;

  let needsConsent: TrancoConsentState['needsConsent'];
  let calculatedRetryDays: number | null = null;

  if (grantedVersion === latestVersion) {
    needsConsent = 'ALREADY_GRANTED';
  } else if (deniedTimestamp) {
    const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);
    const retryDaysRemaining = Math.max(0, 30 - Math.ceil(elapsedDays));

    if (retryDaysRemaining > 0) {
      needsConsent = 'DENIED';
      calculatedRetryDays = retryDaysRemaining;
    } else {
      needsConsent = 'RETRY_NEEDED';
    }
  } else {
    needsConsent = 'PENDING';
  }

  return {
    needsConsent,
    grantedVersion,
    deniedReason: settings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] as string | null,
    retryDaysRemaining: calculatedRetryDays,
    latestVersion
  };
}

function updateConsentUI(state: TrancoConsentState): void {
  const consentStatusEl = document.getElementById('trancoConsentStatus');
  const consentRetryInfoEl = document.getElementById('trancoConsentRetryInfo');
  const consentActionsEl = document.getElementById('trancoConsentActions');

  if (!consentStatusEl) return;

  // Update status badge
  consentStatusEl.textContent = getMessage(`trancoConsentStatus${state.needsConsent}`) || state.needsConsent;
  consentStatusEl.className = `status-badge status-${state.needsConsent.toLowerCase()}`;

  // Update retry info
  if (state.retryDaysRemaining !== null && state.retryDaysRemaining > 0) {
    consentRetryInfoEl!.textContent = getMessage('trancoConsentRetryDaysRemaining')
      ?.replace('{days}', state.retryDaysRemaining.toString()) || `再確認まで ${state.retryDaysRemaining} 日`;
    consentRetryInfoEl!.hidden = false;
  } else {
    consentRetryInfoEl!.hidden = true;
  }

  // Update actions
  if (state.needsConsent === 'PENDING' || state.needsConsent === 'RETRY_NEEDED') {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'btn-primary';
    grantBtn.textContent = getMessage('trancoUpdateModalConfirmLabel') || '同意する';
    grantBtn.addEventListener('click', () => handleTrancoGrant(state.latestVersion));

    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn-secondary';
    denyBtn.textContent = getMessage('trancoUpdateModalDenyLabel') || '拒否する';
    denyBtn.addEventListener('click', () => handleTrancoDeny());

    consentActionsEl!.innerHTML = '';
    consentActionsEl!.appendChild(grantBtn);
    consentActionsEl!.appendChild(denyBtn);
    consentActionsEl!.hidden = false;
  } else {
    consentActionsEl!.hidden = true;
  }
}

async function handleTrancoGrant(version: string): Promise<void> {
  try {
    const settings = await getSettings();

    const updatedSettings = { ...settings };
    updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = version;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = null;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = null;

    await saveSettingsWithAllowedUrls(updatedSettings);

    showStatus(
      'trancoStatus',
      getMessage('trancoConsentGranted') || '同意を保存しました',
      'success'
    );

    await initTrancoConsentPanel();
  } catch (e) {
    console.error('[Dashboard] Error granting Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessage('errorConsentData') || '同意の保存中にエラーが発生しました',
      'error'
    );
  }
}

async function handleTrancoDeny(): Promise<void> {
  try {
    const settings = await getSettings();

    const updatedSettings = { ...settings };
    updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = null;
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = 'deny';
    updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = Date.now();

    await saveSettingsWithAllowedUrls(updatedSettings);

    showStatus(
      'trancoStatus',
      getMessage('trancoConsentDenied') || '拒否を保存しました',
      'error'
    );

    await initTrancoConsentPanel();
  } catch (e) {
    console.error('[Dashboard] Error denying Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessage('errorConsentData') || '拒否の保存中にエラーが発生しました',
      'error'
    );
  }
}
