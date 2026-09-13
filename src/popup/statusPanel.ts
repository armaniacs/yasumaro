import { StatusInfo } from './statusChecker.js';
import { loadActiveTabStatus } from './statusStore.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { addDomainToWhitelist, addPathToWhitelist } from './whitelistWriter.js';
import { getMessage } from '../utils/i18n.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getCurrentTab } from './tabUtils.js';
import { extractDomain } from '../utils/domainUtils.js';
import { updateStatusIcon, escapeHtml, wireOnce } from './domUtils.js';
import { requestContentFromTab } from './contentFetchGateway.js';
import { getCleansedBadgeText } from '../utils/cleansingBadge.js';
import { renderCleansingHtml, renderLockedHtml, renderTrustHtml, renderTrustFallbackHtml, renderPrivacyHtml, renderCacheHtml, renderDomainStateHtml, renderLastSavedHtml } from './statusRenderers.js';
import type { ContentResponse } from './mainTypes.js';

/** Per-element toast timer — rapid double-deny used to start two competing chains (PBI 2026-09-12-41). */
let errorToastTimer: ReturnType<typeof setTimeout> | undefined = null as unknown as ReturnType<typeof setTimeout> | undefined;

export async function initStatusPanel(): Promise<void> {
  try {
    // Show privacy mode badge (best-effort, guard against test environments)
    try {
      const settings = await settingsRepository.getAll();
      if (settings) {
        const mode = (settings[StorageKeys.PRIVACY_MODE] as string) || 'full_pipeline';
        const modeBadge = document.getElementById('statusModeBadge');
        if (modeBadge) {
          const modeKey = mode === 'local_only' ? 'privacyModeLocalOnlyShort' : mode === 'full_pipeline' ? 'privacyModeFullPipelineShort' : mode === 'masked_cloud' ? 'privacyModeMaskedCloudShort' : 'privacyModeCloudOnlyShort';
          modeBadge.textContent = getMessage(modeKey) || mode;
          modeBadge.className = `status-badge status-mode-badge mode-${mode}`;
        }
      }
    } catch {
      // Mode badge is non-critical; ignore errors
    }

    // Active-tab status fetch goes through the shared store (PBI 2026-09-07-24)
    const snapshot = await loadActiveTabStatus();
    const currentTab = snapshot.tab;

    if (!snapshot.url || !currentTab) {
      const panel = document.getElementById('statusPanel');
      if (panel) panel.style.display = 'none';
      return;
    }

    const status = snapshot.status;

    if (!status) {
      renderSpecialUrlStatus();
      return;
    }

    renderStatusPanel(status);

    if (currentTab.id) {
      // PBI 2026-09-11-04: passive ask through the shared gateway (timeout +
      // no prompts) instead of a raw callback send with no timeout.
      void requestContentFromTab(currentTab.id).then((response: ContentResponse | null) => {
        if (!response) return;
        updateCleansingStatus(response.cleanseStats, response.cleansedReason);
      });
    }

    if (currentTab.url) {
      void updateTrustStatus(currentTab.url);
    }

    initCleansingFeedbackButton();

    const toggleBtn = document.getElementById('statusToggleBtn') as (HTMLElement & { dataset: DOMStringMap }) | null;
    const detailsPanel = document.getElementById('statusDetails');

    // Wire once per element — initStatusPanel re-runs after every whitelist
    // write and a bare addEventListener stacks duplicate toggle handlers
    // (PBI 2026-09-12-29). Same wireOnce discipline as the other buttons.
    wireOnce(toggleBtn, (el) => {
      el.addEventListener('click', () => {
        const isExpanded = el.getAttribute('aria-expanded') === 'true';
        el.setAttribute('aria-expanded', String(!isExpanded));
        detailsPanel?.classList.toggle('hidden');
        detailsPanel?.setAttribute('aria-hidden', String(isExpanded));

        const toggleText = document.getElementById('statusToggleText');
        if (toggleText) {
          toggleText.textContent = isExpanded
            ? getMessage('statusShowDetails')
            : getMessage('statusHideDetails');
        }
      });
    });
  } catch (error) {
    logError('Error initializing status panel', { cause: error }, ErrorCode.INTERNAL_ERROR);
    const panel = document.getElementById('statusPanel');
    if (panel) panel.style.display = 'none';
  }
}

// PBI 2026-09-12-41: label policy lives in the shared CleansingBadge table.
// This one-line adapter is kept for main.ts's re-export.
export function getCleansedReasonText(cleansedReason?: 'hard' | 'keyword' | 'both' | 'none'): string {
  return getCleansedBadgeText(cleansedReason, getMessage);
}

export function updateCleansingStatus(cleanseStats: ContentResponse['cleanseStats'], cleansedReason?: ContentResponse['cleansedReason']): void {
  const cleansingContent = document.getElementById('statusCleansingContent');
  if (!cleansingContent) return;
  // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
  cleansingContent.innerHTML = renderCleansingHtml(cleanseStats, cleansedReason, { t: getMessage, esc: escapeHtml });
}

export async function updateTrustStatus(url: string): Promise<void> {
  const trustContent = document.getElementById('statusTrustContent');
  const permArea = document.getElementById('permissionRequestArea');
  const errorMsg = document.getElementById('permissionDeniedMessage') as HTMLElement | null;
  if (!trustContent) return;

  try {
    const { isAllUrlsPermitted, isHostPermitted, requestPermission, recordDeniedVisit } = await import('../utils/permissionManager.js');
    const allUrlsGranted = await isAllUrlsPermitted();
    const permitted = allUrlsGranted || await isHostPermitted(url);
    if (!permitted) {
      // PBI 2026-09-11-04 (round 5): LOCKED is communicated via the badge +
      // permission area only. The record button is owned solely by
      // RecordSession (sole-writer contract, PBI 2026-09-07-24) — disabling
      // it here raced resetRecordButton and blocked the designed
      // "Record Anyway" (force) escape hatch.
      trustContent.innerHTML = renderLockedHtml({ t: getMessage, esc: escapeHtml });
      if (permArea) {
        permArea.classList.remove('hidden');
        // Wire the request button once per element — updateTrustStatus runs on
        // every status refresh and addEventListener would stack duplicate
        // handlers (double prompt + double recordDeniedVisit).
        const requestBtn = document.getElementById('btnRequestPermission') as HTMLElement & { dataset: DOMStringMap } | null;
        wireOnce(requestBtn, (el) => {
          el.addEventListener('click', async () => {
            // PBI 2026-09-12-41: extractDomain instead of `new URL(url)` —
            // a malformed URL threw before the toast ever showed. The stale
            // closure URL concern (user navigates between render and click)
            // is noted but re-querying chrome.tabs added async complexity
            // that broke the wiring contract; revisit with an event-based
            // tab-URL refresh.
            const granted = await requestPermission(url);
            if (granted) {
              permArea.classList.add('hidden');
              void updateTrustStatus(url);
            } else {
              const domain = extractDomain(url);
              if (domain) await recordDeniedVisit(domain);
              if (errorMsg) {
                errorMsg.classList.remove('hidden');
                requestAnimationFrame(() => {
                  errorMsg.classList.add('visible');
                });
                // PBI 2026-09-12-41: per-element timer token — rapid double-deny
                // used to start two competing toast chains.
                if (errorToastTimer !== undefined) clearTimeout(errorToastTimer);
                errorToastTimer = setTimeout(() => {
                  errorMsg.classList.remove('visible');
                  setTimeout(() => {
                    errorMsg.classList.add('hidden');
                  }, 300);
                }, 3000);
              }
            }
          });
        });
      }
      return;
    }

    if (permArea) permArea.classList.add('hidden');

    const { getTrustLevelDisplay, checkDomainTrust } = await import('../utils/trustChecker.js');
    const [display, checkResult] = await Promise.all([
      getTrustLevelDisplay(url),
      checkDomainTrust(url)
    ]);

    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    trustContent.innerHTML = renderTrustHtml(display, checkResult, { t: getMessage, esc: escapeHtml });
  } catch {
    trustContent.innerHTML = renderTrustFallbackHtml({ t: getMessage, esc: escapeHtml });
  }
}

/**
 * 可視テキストラベルを更新する。アイコンと同じi18nキーを使い、
 * data-i18n属性も同期させる（applyI18n再適用時の上書き対策）。
 * ラベル要素が存在しないDOM（旧テスト等）では何もしない。
 *
 * check-i18nはdata-i18nのリテラルを静的走査するため、使用キー一覧:
 * data-i18n="statusRecordable" data-i18n="statusBlocked"
 * data-i18n="statusPrivateDetected" data-i18n="statusPublicPage" data-i18n="statusNoInfo"
 */
function updateStatusLabel(label: HTMLElement | null, messageKey: string): void {
  if (!label) return;
  label.textContent = getMessage(messageKey);
  label.setAttribute('data-i18n', messageKey);
}

function renderStatusPanel(status: StatusInfo): void {
  const domainIcon = document.getElementById('statusDomainIcon');
  const privacyIcon = document.getElementById('statusPrivacyIcon');
  const domainLabel = document.getElementById('statusDomainLabel');
  const privacyLabel = document.getElementById('statusPrivacyLabel');

  if (domainIcon) {
    if (status.domainFilter.allowed) {
      updateStatusIcon(domainIcon, 'success');
      domainIcon.className = 'status-icon status-success';
      domainIcon.setAttribute('aria-label', getMessage('statusRecordable'));
      updateStatusLabel(domainLabel, 'statusRecordable');
    } else {
      updateStatusIcon(domainIcon, 'error');
      domainIcon.className = 'status-icon status-error';
      domainIcon.setAttribute('aria-label', getMessage('statusBlocked'));
      updateStatusLabel(domainLabel, 'statusBlocked');
    }
  }

  if (privacyIcon) {
    if (status.privacy.isPrivate) {
      updateStatusIcon(privacyIcon, 'warning');
      privacyIcon.className = 'status-icon status-warning';
      privacyIcon.setAttribute('aria-label', getMessage('statusPrivateDetected'));
      updateStatusLabel(privacyLabel, 'statusPrivateDetected');
    } else if (status.privacy.hasCache) {
      updateStatusIcon(privacyIcon, 'success');
      privacyIcon.className = 'status-icon status-success';
      privacyIcon.setAttribute('aria-label', getMessage('statusPublicPage'));
      updateStatusLabel(privacyLabel, 'statusPublicPage');
    } else {
      updateStatusIcon(privacyIcon, 'muted');
      privacyIcon.className = 'status-icon status-muted';
      privacyIcon.setAttribute('aria-label', getMessage('statusNoInfo'));
      updateStatusLabel(privacyLabel, 'statusNoInfo');
    }
  }

  const domainState = document.getElementById('statusDomainState');
  const domainMode = document.getElementById('statusDomainMode');

  if (domainState) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    domainState.innerHTML = renderDomainStateHtml(status, { t: getMessage, esc: escapeHtml });
  }

  if (domainMode) {
    const modeKey = `statusFilterMode${status.domainFilter.mode.charAt(0).toUpperCase()}${status.domainFilter.mode.slice(1)}`;
    domainMode.innerHTML = `<span class="status-value status-muted">${getMessage(modeKey)}</span>`;
  }

  const privacyContent = document.getElementById('statusPrivacyContent');
  if (privacyContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    privacyContent.innerHTML = renderPrivacyHtml(status, { t: getMessage, esc: escapeHtml });
    if (status.privacy.isPrivate) {
      attachPrivacyActionListeners();
    }
  }

  const cacheContent = document.getElementById('statusCacheContent');
  if (cacheContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    cacheContent.innerHTML = renderCacheHtml(status, { t: getMessage, esc: escapeHtml });
  }

  const lastSavedContent = document.getElementById('statusLastSavedContent');
  if (lastSavedContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    lastSavedContent.innerHTML = renderLastSavedHtml(status, { t: getMessage, esc: escapeHtml });
  }

  const cleansingContent = document.getElementById('statusCleansingContent');
  if (cleansingContent) {
    cleansingContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
  }

  const trustContent = document.getElementById('statusTrustContent');
  if (trustContent) {
    trustContent.innerHTML = `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`;
  }

  // NOTE (PBI 2026-09-05-06): the status render used to rewrite
  // recordBtn.onclick here through a module hook, but main.ts never set that
  // hook — the branch was dead in production and raced the session's own
  // button wiring in theory. The session (RecordSession.resetRecordButton)
  // is now the sole button writer; this render only updates status content.
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
  const addDomainBtn = document.getElementById('statusAddDomain');
  addDomainBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const domain = extractDomain(tab.url);
      if (domain) {
        // PBI 2026-09-12-05: validated, deduped, cache-refreshing writes live
        // in the shared whitelist writer seam.
        const result = await addDomainToWhitelist(domain);
        if (result.ok && result.added) {
          const statusDiv = document.getElementById('mainStatus');
          if (statusDiv) {
            statusDiv.textContent = getMessage('domainAddedToWhitelist') || `Added ${domain} to whitelist`;
            statusDiv.className = 'success';
          }
          await initStatusPanel();
        } else if (!result.ok) {
          const statusDiv = document.getElementById('mainStatus');
          if (statusDiv) {
            statusDiv.textContent = result.reason === 'no-domain'
              ? 'Invalid URL'
              : `Invalid pattern: ${domain}`;
            statusDiv.className = 'error';
          }
        }
      }
    }
  });

  const addPathBtn = document.getElementById('statusAddPath');
  addPathBtn?.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (tab?.url) {
      const result = await addPathToWhitelist(tab.url);
      if (result.ok && result.added) {
        const statusDiv = document.getElementById('mainStatus');
        if (statusDiv) {
          statusDiv.textContent = getMessage('pathAddedToWhitelist') || `Added path to whitelist`;
          statusDiv.className = 'success';
        }
        await initStatusPanel();
      } else if (!result.ok) {
        const statusDiv = document.getElementById('mainStatus');
        if (statusDiv) {
          statusDiv.textContent = result.reason === 'no-domain'
            ? 'Invalid URL'
            : `Invalid pattern: ${tab.url}`;
          statusDiv.className = 'error';
        }
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

  // Wire once per element — re-init (popup reopen / recursive initStatusPanel)
  // must not stack duplicate requestAllUrls handlers. Same discipline as
  // btnRequestPermission (PBI 2026-09-11-04).
  const btn = document.getElementById('btnRequestAllUrls') as HTMLElement & { dataset: DOMStringMap } | null;
  wireOnce(btn, (el) => {
    el.addEventListener('click', async () => {
      const granted = await requestAllUrls();
      if (granted) {
        banner.classList.add('hidden');
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          void updateTrustStatus(tabs[0].url);
        }
      }
    });
  });
}

function initCleansingFeedbackButton(): void {
  const btn = document.getElementById('reportCleansingFeedbackBtn') as (HTMLButtonElement & { dataset: DOMStringMap }) | null;
  if (!btn) return;
  // Wire once per element — attachPrivacyActionListeners re-inits the panel
  // after every whitelist write, and re-running init() stacked a duplicate
  // click handler each time (PBI 2026-09-12-08). Same discipline as the
  // permission buttons (PBI 2026-09-11-04).
  wireOnce(btn, (el) => {
    el.addEventListener('click', async () => {
    const statusEl = document.getElementById('reportCleansingFeedbackStatus');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      const url = tab?.url ?? '';
      const domain = url ? new URL(url).hostname : '';
      let htmlSnippet = '';
      let removedByReason: Record<string, number> = {};
      if (tab?.id !== undefined) {
        const resp = await requestContentFromTab(tab.id);
        if (resp?.content) htmlSnippet = resp.content.slice(0, 500);
        if (resp?.cleanseStats) removedByReason = { ...resp.cleanseStats } as unknown as Record<string, number>;
        if (resp?.aiSummaryCleansedStats) {
          removedByReason = { ...removedByReason, ...resp.aiSummaryCleansedStats } as unknown as Record<string, number>;
        }
      }
      if (!htmlSnippet) {
        htmlSnippet = document.documentElement.outerHTML.slice(0, 500);
      }
      const { enqueueFeedback } = await import('../utils/aiSummaryCleaner/feedbackQueue.js');
      await enqueueFeedback({ url, domain, htmlSnippet, removedByReason });
      if (statusEl) statusEl.textContent = getMessage('reportCleansingFeedbackSuccess') || '報告しました';
    } catch (e) {
      if (statusEl) statusEl.textContent = getMessage('reportCleansingFeedbackError') || '報告に失敗しました';
      logError('Failed to enqueue cleansing feedback', { cause: e }, ErrorCode.INTERNAL_ERROR);
    }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    });
  });
}

export { initAllUrlsPermissionBanner };