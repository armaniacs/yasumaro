import { checkPageStatus, StatusInfo } from './statusChecker.js';
import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
import { getMessage } from './i18n.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getCurrentTab } from './tabUtils.js';
import { extractDomain } from '../utils/domainUtils.js';
import { updateStatusIcon, escapeHtml } from './domUtils.js';
import type { ContentResponse } from './mainTypes.js';

let _recordCurrentPage: ((force: boolean) => Promise<void>) | null = null;

export function setRecordCurrentPageFn(fn: (force: boolean) => Promise<void>): void {
  _recordCurrentPage = fn;
}

function getRecordCurrentPage(): (force: boolean) => Promise<void> {
  if (!_recordCurrentPage) {
    throw new Error('recordCurrentPage not initialized. Call setRecordCurrentPageFn first.');
  }
  return _recordCurrentPage;
}

export async function initStatusPanel(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (!currentTab?.url) {
      const panel = document.getElementById('statusPanel');
      if (panel) panel.style.display = 'none';
      return;
    }

    const status = await checkPageStatus(currentTab.url);

    if (!status) {
      renderSpecialUrlStatus();
      return;
    }

    renderStatusPanel(status);

    if (currentTab.id) {
      chrome.tabs.sendMessage(currentTab.id, { type: 'GET_CONTENT' }, (response: ContentResponse | undefined) => {
        if (chrome.runtime.lastError || !response) return;
        updateCleansingStatus(response.cleanseStats, response.cleansedReason);
      });
    }

    if (currentTab.url) {
      void updateTrustStatus(currentTab.url);
    }

    const toggleBtn = document.getElementById('statusToggleBtn');
    const detailsPanel = document.getElementById('statusDetails');

    toggleBtn?.addEventListener('click', () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
      detailsPanel?.classList.toggle('hidden');
      detailsPanel?.setAttribute('aria-hidden', String(isExpanded));

      const toggleText = document.getElementById('statusToggleText');
      if (toggleText) {
        toggleText.textContent = isExpanded
          ? getMessage('statusShowDetails')
          : getMessage('statusHideDetails');
      }
    });
  } catch (error) {
    logError('Error initializing status panel', { cause: error }, ErrorCode.INTERNAL_ERROR);
    const panel = document.getElementById('statusPanel');
    if (panel) panel.style.display = 'none';
  }
}

export function getCleansedReasonText(cleansedReason?: 'hard' | 'keyword' | 'both' | 'none'): string {
  if (!cleansedReason || cleansedReason === 'none') {
    return '';
  }

  switch (cleansedReason) {
    case 'hard':
      return getMessage('cleansedBadgeHard') || '🧹 Hard';
    case 'keyword':
      return getMessage('cleansedBadgeKeyword') || '🧹 Keyword';
    case 'both':
      return getMessage('cleansedBadgeBoth') || '🧹 Both';
    default:
      return '';
  }
}

export function updateCleansingStatus(cleanseStats: ContentResponse['cleanseStats'], cleansedReason?: ContentResponse['cleansedReason']): void {
  const cleansingContent = document.getElementById('statusCleansingContent');
  if (!cleansingContent) return;

  if (!cleanseStats || cleanseStats.totalRemoved === 0) {
    cleansingContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusCleansingNone')}</span>`;
    return;
  }

  let html = '';

  const reasonText = getCleansedReasonText(cleansedReason);
  if (reasonText) {
    html += `<span class="status-value">${reasonText}</span>`;
  }

  if (cleanseStats.hardStripRemoved > 0) {
    html += `<span class="status-value">${getMessage('statusCleansingHard', [String(cleanseStats.hardStripRemoved)])}</span>`;
  }
  if (cleanseStats.keywordStripRemoved > 0) {
    html += `<span class="status-value">${getMessage('statusCleansingKeyword', [String(cleanseStats.keywordStripRemoved)])}</span>`;
  }
  if (cleanseStats.totalRemoved > 0) {
    html += `<span class="status-value status-muted">${getMessage('statusCleansingTotal', [String(cleanseStats.totalRemoved)])}</span>`;
  }
  cleansingContent.innerHTML = html;
}

export async function updateTrustStatus(url: string): Promise<void> {
  const trustContent = document.getElementById('statusTrustContent');
  const permArea = document.getElementById('permissionRequestArea');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;
  const errorMsg = document.getElementById('permissionDeniedMessage') as HTMLElement | null;
  if (!trustContent) return;

  try {
    const { isAllUrlsPermitted, isHostPermitted, requestPermission, recordDeniedVisit } = await import('../utils/permissionManager.js');
    const allUrlsGranted = await isAllUrlsPermitted();
    const permitted = allUrlsGranted || await isHostPermitted(url);
    if (!permitted) {
      trustContent.innerHTML = `<span class="status-value status-trust-locked">🔒 LOCKED</span>`;
      if (recordBtn) recordBtn.disabled = true;
      if (permArea) {
        permArea.classList.remove('hidden');
        document.getElementById('btnRequestPermission')?.addEventListener('click', async () => {
          const granted = await requestPermission(url);
          if (granted) {
            permArea.classList.add('hidden');
            if (recordBtn) recordBtn.disabled = false;
            void updateTrustStatus(url);
          } else {
            const domain = new URL(url).hostname;
            await recordDeniedVisit(domain);
            if (errorMsg) {
              errorMsg.classList.remove('hidden');
              requestAnimationFrame(() => {
                errorMsg.classList.add('visible');
              });
              setTimeout(() => {
                errorMsg.classList.remove('visible');
                setTimeout(() => {
                  errorMsg.classList.add('hidden');
                }, 300);
              }, 3000);
            }
          }
        });
      }
      return;
    }

    if (permArea) permArea.classList.add('hidden');
    if (recordBtn) recordBtn.disabled = false;

    const { getTrustLevelDisplay, checkDomainTrust } = await import('../utils/trustChecker.js');
    const [display, checkResult] = await Promise.all([
      getTrustLevelDisplay(url),
      checkDomainTrust(url)
    ]);

    const levelKey = `statusTrust${display.level.charAt(0) + display.level.slice(1).toLowerCase()}` as
      'statusTrustTrusted' | 'statusTrustSensitive' | 'statusTrustUnverified';
    const levelText = getMessage(levelKey) || display.level;

    const trustClass = `status-trust-${display.level.toLowerCase()}`;
    let html = `<span class="status-value ${trustClass}">${levelText}</span>`;

    if (checkResult.showAlert && checkResult.trustResult.category) {
      const catKey = checkResult.trustResult.category === 'finance'
        ? 'statusTrustAlertFinance'
        : 'statusTrustAlertSensitive';
      html += `<span class="status-value status-warning">${getMessage(catKey)}</span>`;
    }

    trustContent.innerHTML = html;
  } catch {
    trustContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
  }
}

function renderStatusPanel(status: StatusInfo): void {
  const domainIcon = document.getElementById('statusDomainIcon');
  const privacyIcon = document.getElementById('statusPrivacyIcon');

  if (domainIcon) {
    if (status.domainFilter.allowed) {
      updateStatusIcon(domainIcon, 'success');
      domainIcon.className = 'status-icon status-success';
      domainIcon.setAttribute('aria-label', getMessage('statusRecordable'));
    } else {
      updateStatusIcon(domainIcon, 'error');
      domainIcon.className = 'status-icon status-error';
      domainIcon.setAttribute('aria-label', getMessage('statusBlocked'));
    }
  }

  if (privacyIcon) {
    if (status.privacy.isPrivate) {
      updateStatusIcon(privacyIcon, 'warning');
      privacyIcon.className = 'status-icon status-warning';
      privacyIcon.setAttribute('aria-label', getMessage('statusPrivateDetected'));
    } else if (status.privacy.hasCache) {
      updateStatusIcon(privacyIcon, 'success');
      privacyIcon.className = 'status-icon status-success';
      privacyIcon.setAttribute('aria-label', getMessage('statusPublicPage'));
    } else {
      updateStatusIcon(privacyIcon, 'muted');
      privacyIcon.className = 'status-icon status-muted';
      privacyIcon.setAttribute('aria-label', getMessage('statusNoInfo'));
    }
  }

  const domainState = document.getElementById('statusDomainState');
  const domainMode = document.getElementById('statusDomainMode');

  if (domainState) {
    const stateMsg = status.domainFilter.allowed
      ? getMessage('statusDomainAllowed')
      : getMessage('statusDomainBlocked');
    domainState.innerHTML = `<span class="status-value ${status.domainFilter.allowed ? 'status-success' : 'status-error'}">${stateMsg}</span>`;

    if (status.domainFilter.matchedPattern) {
      const patternMsg = getMessage('statusPattern', [escapeHtml(status.domainFilter.matchedPattern)]);
      domainState.innerHTML += `<span class="status-value status-muted">${patternMsg}</span>`;
    }
  }

  if (domainMode) {
    const modeKey = `statusFilterMode${status.domainFilter.mode.charAt(0).toUpperCase()}${status.domainFilter.mode.slice(1)}`;
    domainMode.innerHTML = `<span class="status-value status-muted">${getMessage(modeKey)}</span>`;
  }

  const privacyContent = document.getElementById('statusPrivacyContent');
  if (privacyContent) {
    if (!status.privacy.hasCache) {
      privacyContent.innerHTML = `
        <span class="status-value status-muted">${getMessage('statusNoInfo')}</span>
        <span class="status-value status-muted status-hint">${getMessage('statusReloadHint')}</span>
      `;
    } else {
      let html = '';
      if (status.privacy.isPrivate) {
        if (status.privacy.reason === 'cache-control') {
          html += `<span class="status-value status-warning">${getMessage('statusCacheControlPrivate')}</span>`;
        } else if (status.privacy.reason === 'set-cookie') {
          html += `<span class="status-value status-warning">${getMessage('statusSetCookieDetected')}</span>`;
        } else if (status.privacy.reason === 'authorization') {
          html += `<span class="status-value status-warning">${getMessage('statusAuthDetected')}</span>`;
        }

        html += `
          <div class="status-actions">
            <button class="status-action-btn primary" id="statusRecordOnce" data-i18n="saveOnce">今すぐ記録</button>
            <button class="status-action-btn" id="statusAddDomain" data-i18n="saveDomain">ドメインを許可</button>
            <button class="status-action-btn" id="statusAddPath" data-i18n="savePath">パスを許可</button>
          </div>
        `;
      } else {
        html += `<span class="status-value status-success">${getMessage('statusPublicPage')}</span>`;
      }
      privacyContent.innerHTML = html;

      if (status.privacy.isPrivate) {
        attachPrivacyActionListeners();
      }
    }
  }

  const cacheContent = document.getElementById('statusCacheContent');
  if (cacheContent) {
    let html = '';

    console.log('[StatusPanel] Cache status:', {
      hasCache: status.cache.hasCache,
      cacheControl: status.cache.cacheControl,
      hasCookie: status.cache.hasCookie,
      hasAuth: status.cache.hasAuth
    });

    if (!status.cache.hasCache) {
      html = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
    } else {
      if (status.cache.cacheControl) {
        html += `<span class="status-value">Cache-Control: ${escapeHtml(status.cache.cacheControl)}</span>`;
      }
      if (status.cache.hasCookie) {
        html += `<span class="status-value">${getMessage('statusSetCookiePresent')}</span>`;
      }
      if (status.cache.hasAuth) {
        html += `<span class="status-value">${getMessage('statusAuthorizationPresent')}</span>`;
      }
      if (!html) {
        html = `<span class="status-value status-muted">${getMessage('statusNoCacheInfo')}</span>`;
      }
    }
    cacheContent.innerHTML = html;
  }

  const lastSavedContent = document.getElementById('statusLastSavedContent');
  if (lastSavedContent) {
    if (!status.lastSaved.exists) {
      lastSavedContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNotSaved')}</span>`;
    } else {
      lastSavedContent.innerHTML = `
        <span class="status-value">${escapeHtml(status.lastSaved.timeAgo || '')}</span>
        <span class="status-value status-muted">${escapeHtml(status.lastSaved.formatted || '')}</span>
      `;
    }
  }

  const cleansingContent = document.getElementById('statusCleansingContent');
  if (cleansingContent) {
    cleansingContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
  }

  const trustContent = document.getElementById('statusTrustContent');
  if (trustContent) {
    trustContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
  }

  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;
  if (recordBtn && !recordBtn.disabled && _recordCurrentPage) {
    const recordPage = _recordCurrentPage;
    if (!status.domainFilter.allowed) {
      recordBtn.textContent = getMessage('forceRecordAnyway') || 'Record Anyway';
      recordBtn.onclick = () => void recordPage(true);
    } else {
      recordBtn.textContent = getMessage('recordNow');
      recordBtn.onclick = () => recordPage(false);
    }
  }
}

export function renderSpecialUrlStatus(): void {
  const panel = document.getElementById('statusPanel');
  if (panel) {
    panel.innerHTML = `
      <div class="status-summary">
        <span class="status-value status-error">${getMessage('statusPageNotRecordable')}</span>
      </div>
    `;
  }
}

function attachPrivacyActionListeners(): void {
  const recordOnceBtn = document.getElementById('statusRecordOnce');
  recordOnceBtn?.addEventListener('click', async () => {
    const recordPageFn = getRecordCurrentPage();
    await recordPageFn(true);
  });

  const addDomainBtn = document.getElementById('statusAddDomain');
  addDomainBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const domain = extractDomain(tab.url);
      if (domain) {
        const settings = await getSettings();
        const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
        if (!whitelist.includes(domain)) {
          whitelist.push(domain);
          await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);

          const statusDiv = document.getElementById('mainStatus');
          if (statusDiv) {
            statusDiv.textContent = getMessage('domainAddedToWhitelist') || `Added ${domain} to whitelist`;
            statusDiv.className = 'success';
          }

          await initStatusPanel();
        }
      }
    }
  });

  const addPathBtn = document.getElementById('statusAddPath');
  addPathBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const settings = await getSettings();
      const whitelist = settings[StorageKeys.DOMAIN_WHITELIST] || [];
      if (!whitelist.includes(tab.url)) {
        whitelist.push(tab.url);
        await saveSettings({ [StorageKeys.DOMAIN_WHITELIST]: whitelist }, true);

        const statusDiv = document.getElementById('mainStatus');
        if (statusDiv) {
          statusDiv.textContent = getMessage('pathAddedToWhitelist') || `Added path to whitelist`;
          statusDiv.className = 'success';
        }

        await initStatusPanel();
      }
    }
  });
}

async function initAllUrlsPermissionBanner(): Promise<void> {
  const banner = document.getElementById('allUrlsPermissionBanner');
  if (!banner) return;

  const { isAllUrlsPermitted, requestAllUrls } = await import('../utils/permissionManager.js');
  const permitted = await isAllUrlsPermitted();

  if (permitted) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  document.getElementById('btnRequestAllUrls')?.addEventListener('click', async () => {
    const granted = await requestAllUrls();
    if (granted) {
      banner.classList.add('hidden');
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.url) {
        void updateTrustStatus(tabs[0].url);
      }
    }
  });
}

export { initAllUrlsPermissionBanner };