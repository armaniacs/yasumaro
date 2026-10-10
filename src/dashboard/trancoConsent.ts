// ============================================================================
// Tranco Consent Panel
// ============================================================================

import { getMessage, getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { clearElement } from '../utils/domClear.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { StorageKeys } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import { evaluateTrancoConsent, persistTrancoConsentDeny, persistTrancoConsentGrant } from '../utils/storage/trancoConsent.js';

interface TrancoConsentState {
  needsConsent: 'GRANTED' | 'DENIED' | 'PENDING' | 'ALREADY_GRANTED' | 'RETRY_NEEDED';
  grantedVersion: string | null;
  deniedReason: string | null;
  retryDaysRemaining: number | null;
  latestVersion: string;
}

export async function initTrancoConsentPanel(repo: SettingsReader = settingsRepository): Promise<void> {
  console.log('[Dashboard] Initializing Tranco Consent Panel');

  const currentVersionEl = document.getElementById('trancoCurrentVersion');
  const domainCountEl = document.getElementById('trancoDomainCount');
  const consentStatusEl = document.getElementById('trancoConsentStatus');

  if (!currentVersionEl || !domainCountEl || !consentStatusEl) {
    console.warn('[Dashboard] Tranco UI elements not found');
    return;
  }

  try {
    // Get current Tranco version and domains with DEFAULT_SETTINGS fallback.
    const trancoSettings = await repo.getMany([StorageKeys.TRANCO_VERSION, StorageKeys.TRANCO_DOMAINS]);
    const version = trancoSettings[StorageKeys.TRANCO_VERSION];
    const domains = trancoSettings[StorageKeys.TRANCO_DOMAINS] ?? [];

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
    const consentState = await getTrancoConsentState(repo, version || 'unknown');
    updateConsentUI(repo, consentState);
  } catch (e) {
    console.error('[Dashboard] Error loading Tranco consent state:', e);
    showStatus('trancoUpdateStatus', getMessageOr('errorLoadTrancoData', 'Trancoデータの読み込みに失敗しました'), 'error');
  }
}

async function getTrancoConsentState(repo: SettingsReader, latestVersion: string): Promise<TrancoConsentState> {
  const consentSettings = await repo.getMany([
    StorageKeys.TRANCO_CONSENT_GRANTED,
    StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP,
    StorageKeys.TRANCO_CONSENT_DENIED_REASON,
  ]);
  const grantedVersion = consentSettings[StorageKeys.TRANCO_CONSENT_GRANTED];
  const deniedTimestamp = consentSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP];
  const deniedReason = consentSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON];

  // 30 日ルールは共有モジュールの判定 1 箇所だけ。ここは 5 状態への写像のみ。
  const decision = evaluateTrancoConsent({
    currentVersion: latestVersion,
    grantedVersion: grantedVersion ?? null,
    deniedTimestamp: deniedTimestamp ?? null,
  });

  let needsConsent: TrancoConsentState['needsConsent'];
  let calculatedRetryDays: number | null = null;

  if (decision.alreadyGranted) {
    needsConsent = 'ALREADY_GRANTED';
  } else if (!decision.hasDenial) {
    needsConsent = 'PENDING';
  } else if (decision.needsConsent) {
    needsConsent = 'RETRY_NEEDED';
  } else {
    needsConsent = 'DENIED';
    calculatedRetryDays = decision.daysUntilRetry;
  }

  return {
    needsConsent,
    grantedVersion: grantedVersion as string | null,
    deniedReason: deniedReason as string | null,
    retryDaysRemaining: calculatedRetryDays,
    latestVersion
  };
}

function updateConsentUI(repo: SettingsReader, state: TrancoConsentState): void {
  const consentStatusEl = document.getElementById('trancoConsentStatus');
  const consentRetryInfoEl = document.getElementById('trancoConsentRetryInfo');
  const consentActionsEl = document.getElementById('trancoConsentActions');

  if (!consentStatusEl) return;

  // Update status badge
  consentStatusEl.textContent = getMessageOr(`trancoConsentStatus${state.needsConsent}`, state.needsConsent);
  consentStatusEl.className = `status-badge status-${state.needsConsent.toLowerCase()}`;

  // Update retry info
  if (state.retryDaysRemaining !== null && state.retryDaysRemaining > 0) {
    consentRetryInfoEl!.textContent = getMessageWithSubstitutions(
      'trancoConsentRetryDaysRemaining',
      { days: state.retryDaysRemaining },
      '再確認まで {days} 日',
    );
    consentRetryInfoEl!.hidden = false;
  } else {
    consentRetryInfoEl!.hidden = true;
  }

  // Update actions
  if (state.needsConsent === 'PENDING' || state.needsConsent === 'RETRY_NEEDED') {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'btn-primary';
    grantBtn.textContent = getMessageOr('trancoUpdateModalConfirmLabel', '同意する');
    grantBtn.addEventListener('click', () => handleTrancoGrant(repo, state.latestVersion));

    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn-secondary';
    denyBtn.textContent = getMessageOr('trancoUpdateModalDenyLabel', '拒否する');
    denyBtn.addEventListener('click', () => handleTrancoDeny(repo));

    clearElement(consentActionsEl);
    consentActionsEl!.appendChild(grantBtn);
    consentActionsEl!.appendChild(denyBtn);
    consentActionsEl!.hidden = false;
  } else {
    consentActionsEl!.hidden = true;
  }
}

async function handleTrancoGrant(repo: SettingsReader, version: string): Promise<void> {
  try {
    await persistTrancoConsentGrant(version);

    showStatus(
      'trancoStatus',
      getMessageOr('trancoConsentGranted', '同意を保存しました'),
      'success'
    );

    await initTrancoConsentPanel(repo);
  } catch (e) {
    console.error('[Dashboard] Error granting Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessageOr('errorConsentData', '同意の保存中にエラーが発生しました'),
      'error'
    );
  }
}

async function handleTrancoDeny(repo: SettingsReader): Promise<void> {
  try {
    await persistTrancoConsentDeny();

    showStatus(
      'trancoStatus',
      getMessageOr('trancoConsentDenied', '拒否を保存しました'),
      'error'
    );

    await initTrancoConsentPanel(repo);
  } catch (e) {
    console.error('[Dashboard] Error denying Tranco consent:', e);
    showStatus(
      'trancoStatus',
      getMessageOr('errorConsentData', '拒否の保存中にエラーが発生しました'),
      'error'
    );
  }
}
