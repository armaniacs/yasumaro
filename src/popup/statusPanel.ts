import { StatusInfo } from './statusChecker.js';
import { loadActiveTabStatus } from './statusStore.js';
import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../utils/storage/types.js';
import { addDomainToWhitelist, addPathToWhitelist } from './whitelistWriter.js';
import { getMessage, getMessageOr } from '../utils/i18n.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { getCurrentTab, getDomainForUrl } from './tabUtils.js';
import { extractDomain } from '../utils/domainUtils.js';
import { updateStatusIcon, escapeHtml, wireOnce } from './domUtils.js';
import { requestContentFromTab } from './contentFetchGateway.js';
import { getCleansedBadgeText } from '../utils/cleansingBadge.js';
import { buildRemovedCounts } from '../utils/commonTypes.js';
import type { AiSummaryRemovedStats } from '../utils/commonTypes.js';
import { setElementHtml } from '../utils/htmlFragment.js';
import { statusChannel } from '../utils/ui/statusChannel.js';
// Side-effect import: registers the popup-only 'mainStatus' TTL binding
// owned by statusClasses.ts, so every #mainStatus writer inherits it.
import './statusClasses.js';

// Popup-only TTL for the cleansing-feedback surface (see statusClasses.ts
// for the 'mainStatus' binding).
statusChannel.register('reportCleansingFeedbackStatus', { defaultTtlMs: 2000 });
import { renderCleansingHtml, renderDomainStateHtml, renderPrivacyHtml, renderCacheHtml, renderLastSavedHtml } from './statusRenderers.js';
import type { ContentResponse } from './mainTypes.js';
import { reportHandlerError, updateTrustStatus, initAllUrlsPermissionBanner } from './trustPanel.js';

export { updateTrustStatus, initAllUrlsPermissionBanner };

// Show privacy mode badge (best-effort, guard against test environments)
async function renderPrivacyModeBadge(): Promise<void> {
  try {
    const settings = await settingsRepository.getAll();
    if (settings) {
      const mode = (settings[StorageKeys.PRIVACY_MODE] as string) || 'full_pipeline';
      const modeBadge = document.getElementById('statusModeBadge');
      if (modeBadge) {
        const modeKey = mode === 'local_only' ? 'privacyModeLocalOnlyShort' : mode === 'full_pipeline' ? 'privacyModeFullPipelineShort' : mode === 'masked_cloud' ? 'privacyModeMaskedCloudShort' : 'privacyModeCloudOnlyShort';
        modeBadge.textContent = getMessageOr(modeKey, mode);
        modeBadge.className = `status-badge status-mode-badge mode-${mode}`;
      }
    }
  } catch {
    // Mode badge is non-critical; ignore errors
  }
}

export async function initStatusPanel(): Promise<void> {
  try {
    await renderPrivacyModeBadge();

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
  setElementHtml(cleansingContent, renderCleansingHtml(cleanseStats, cleansedReason, { t: getMessage, esc: escapeHtml }));
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
    setElementHtml(domainState, renderDomainStateHtml(status, { t: getMessage, esc: escapeHtml }));
  }

  if (domainMode) {
    const modeKey = `statusFilterMode${status.domainFilter.mode.charAt(0).toUpperCase()}${status.domainFilter.mode.slice(1)}`;
    setElementHtml(domainMode, `<span class="status-value status-muted">${getMessage(modeKey)}</span>`);
  }

  const privacyContent = document.getElementById('statusPrivacyContent');
  if (privacyContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    setElementHtml(privacyContent, renderPrivacyHtml(status, { t: getMessage, esc: escapeHtml }));
    if (status.privacy.isPrivate) {
      attachPrivacyActionListeners();
    }
  }

  const cacheContent = document.getElementById('statusCacheContent');
  if (cacheContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    setElementHtml(cacheContent, renderCacheHtml(status, { t: getMessage, esc: escapeHtml }));
  }

  const lastSavedContent = document.getElementById('statusLastSavedContent');
  if (lastSavedContent) {
    // PBI 2026-09-12-41: string building moved to the statusRenderers seam.
    setElementHtml(lastSavedContent, renderLastSavedHtml(status, { t: getMessage, esc: escapeHtml }));
  }

  const cleansingContent = document.getElementById('statusCleansingContent');
  if (cleansingContent) {
    setElementHtml(cleansingContent, `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`);
  }

  const trustContent = document.getElementById('statusTrustContent');
  if (trustContent) {
    setElementHtml(trustContent, `<span class="status-value status-muted">${getMessage('statusNoInfo')}</span>`);
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
    setElementHtml(panel, `
      <div class="status-summary">
        <span class="status-value status-error">${getMessage('statusPageNotRecordable')}</span>
      </div>
    `);
  }
}

function attachPrivacyActionListeners(): void {
  // Wire once per element — same discipline as the toggle / permission /
  // feedback buttons. A bare addEventListener here stacks a duplicate
  // whitelist write on every re-init of a persistent button node.
  const addDomainBtn = document.getElementById('statusAddDomain') as (HTMLElement & { dataset: DOMStringMap }) | null;
  wireOnce(addDomainBtn, (el) => {
    el.addEventListener('click', async () => {
      try {
        const tab = await getCurrentTab();
        if (tab?.url) {
          const domain = extractDomain(tab.url);
          if (domain) {
            // PBI 2026-09-12-05: validated, deduped, cache-refreshing writes live
            // in the shared whitelist writer seam.
            const result = await addDomainToWhitelist(domain);
            if (result.ok && result.added) {
              statusChannel.report('mainStatus', getMessageOr('domainAddedToWhitelist', `Added ${domain} to whitelist`), 'success');
              await initStatusPanel();
            } else if (!result.ok) {
              statusChannel.report(
                'mainStatus',
                result.reason === 'no-domain' ? getMessageOr('statusInvalidUrl', 'Invalid URL') : `Invalid pattern: ${domain}`,
                'error'
              );
            }
          }
        }
      } catch (e) {
        reportHandlerError('Failed to add the domain to the whitelist', e);
      }
    });
  });

  const addPathBtn = document.getElementById('statusAddPath') as (HTMLElement & { dataset: DOMStringMap }) | null;
  wireOnce(addPathBtn, (el) => {
    el.addEventListener('click', async () => {
      try {
        const tab = await getCurrentTab();
        if (tab?.url) {
          const result = await addPathToWhitelist(tab.url);
          if (result.ok && result.added) {
            statusChannel.report('mainStatus', getMessageOr('pathAddedToWhitelist', `Added path to whitelist`), 'success');
            await initStatusPanel();
          } else if (!result.ok) {
            statusChannel.report(
              'mainStatus',
              result.reason === 'no-domain' ? getMessageOr('statusInvalidUrl', 'Invalid URL') : `Invalid pattern: ${tab.url}`,
              'error'
            );
          }
        }
      } catch (e) {
        reportHandlerError('Failed to add the path to the whitelist', e);
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
      const tab = await getCurrentTab();
      const url = tab?.url ?? '';
      const domain = getDomainForUrl(url) ?? '';
      let htmlSnippet = '';
      let removedByReason: Record<string, number> = {};
      let aiSummary: AiSummaryRemovedStats | undefined;
      if (tab?.id !== undefined) {
        const resp = await requestContentFromTab(tab.id);
        if (resp?.content) htmlSnippet = resp.content.slice(0, 500);
        // Counts and AI-summary byte/reason stats are separate units: the
        // builder keeps them apart and the entry carries them in separate
        // fields, so a byte size can never be read as a removal count.
        const counts = buildRemovedCounts(resp?.cleanseStats, resp?.aiSummaryCleansedStats);
        removedByReason = counts.byReason;
        aiSummary = counts.aiSummary;
      }
      if (!htmlSnippet) {
        htmlSnippet = document.documentElement.outerHTML.slice(0, 500);
      }
      const { enqueueFeedback } = await import('../utils/aiSummaryCleaner/feedbackQueue.js');
      await enqueueFeedback({ url, domain, htmlSnippet, removedByReason, ...(aiSummary ? { aiSummary } : {}) });
      if (statusEl) statusChannel.report(statusEl, getMessageOr('reportCleansingFeedbackSuccess', '報告しました'), 'success');
    } catch (e) {
      if (statusEl) statusChannel.report(statusEl, getMessageOr('reportCleansingFeedbackError', '報告に失敗しました'), 'error');
      logError('Failed to enqueue cleansing feedback', { cause: e }, ErrorCode.INTERNAL_ERROR);
    }
    });
  });
}
