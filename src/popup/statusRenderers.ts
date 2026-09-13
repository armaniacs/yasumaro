/**
 * statusRenderers.ts — Layer-0 pure string renderers for the status panel
 * (PBI 2026-09-12-41).
 *
 * Extracted from statusPanel.ts so the trust taxonomy and cleansing display
 * are unit-testable without a popup DOM. The wiring (DOM writes, wireOnce,
 * timers, dynamic imports) stays in statusPanel.ts — only string building
 * moved here. No `document`, no `chrome.*`, no dynamic import, no timers.
 */
import type { ContentResponse } from './mainTypes.js';
import type { StatusInfo } from './statusChecker.js';
import { getCleansedBadgeText } from '../utils/cleansingBadge.js';

export interface RendererDeps {
  t: (key: string, substitutions?: string | string[]) => string;
  esc: (value: string) => string;
}

export function renderCleansingHtml(
  cleanseStats: ContentResponse['cleanseStats'],
  cleansedReason: ContentResponse['cleansedReason'],
  deps: RendererDeps,
): string {
  if (!cleanseStats || cleanseStats.totalRemoved === 0) {
    return `<span class="status-value status-muted">${deps.t('statusCleansingNone')}</span>`;
  }

  let html = '';
  const reasonText = getCleansedBadgeText(cleansedReason, deps.t);
  if (reasonText) {
    html += `<span class="status-value">${reasonText}</span>`;
  }
  if (cleanseStats.hardStripRemoved > 0) {
    html += `<span class="status-value">${deps.t('statusCleansingHard', [String(cleanseStats.hardStripRemoved)])}</span>`;
  }
  if (cleanseStats.keywordStripRemoved > 0) {
    html += `<span class="status-value">${deps.t('statusCleansingKeyword', [String(cleanseStats.keywordStripRemoved)])}</span>`;
  }
  if (cleanseStats.totalRemoved > 0) {
    html += `<span class="status-value status-muted">${deps.t('statusCleansingTotal', [String(cleanseStats.totalRemoved)])}</span>`;
  }
  return html;
}

export function renderLockedHtml(deps: RendererDeps): string {
  return `<span class="status-value status-trust-locked">🔒 ${deps.esc(deps.t('statusTrustLocked') || 'LOCKED')}</span>`;
}

export function renderTrustHtml(
  display: { level: string },
  check: { showAlert?: boolean; trustResult?: { category?: string } },
  deps: RendererDeps,
): string {
  const levelKey = `statusTrust${display.level.charAt(0) + display.level.slice(1).toLowerCase()}` as
    'statusTrustTrusted' | 'statusTrustSensitive' | 'statusTrustUnverified';
  const levelText = deps.t(levelKey) || display.level;

  const trustClass = `status-trust-${display.level.toLowerCase()}`;
  let html = `<span class="status-value ${trustClass}">${levelText}</span>`;

  if (check.showAlert && check.trustResult?.category) {
    const catKey = check.trustResult.category === 'finance'
      ? 'statusTrustAlertFinance'
      : 'statusTrustAlertSensitive';
    html += `<span class="status-value status-warning">${deps.t(catKey)}</span>`;
  }

  return html;
}

export function renderTrustFallbackHtml(deps: RendererDeps): string {
  return `<span class="status-value status-muted">${deps.t('statusNoInfo')}</span>`;
}

export function renderPrivacyHtml(status: StatusInfo, deps: RendererDeps): string {
  if (!status.privacy.hasCache) {
    return `
      <span class="status-value status-muted">${deps.t('statusNoInfo')}</span>
      <span class="status-value status-muted status-hint">${deps.t('statusReloadHint')}</span>
    `;
  }
  if (status.privacy.isPrivate) {
    let html = '';
    if (status.privacy.reason === 'cache-control') {
      html += `<span class="status-value status-warning">${deps.t('statusCacheControlPrivate')}</span>`;
    } else if (status.privacy.reason === 'set-cookie') {
      html += `<span class="status-value status-warning">${deps.t('statusSetCookieDetected')}</span>`;
    } else if (status.privacy.reason === 'authorization') {
      html += `<span class="status-value status-warning">${deps.t('statusAuthDetected')}</span>`;
    }
    html += `
      <div class="status-actions">
        <button class="status-action-btn" id="statusAddDomain" data-i18n="saveDomain">ドメインを許可</button>
        <button class="status-action-btn" id="statusAddPath" data-i18n="savePath">パスを許可</button>
      </div>
    `;
    return html;
  }
  return `<span class="status-value status-success">${deps.t('statusPublicPage')}</span>`;
}

export function renderCacheHtml(status: StatusInfo, deps: RendererDeps): string {
  if (!status.cache.hasCache) {
    return `<span class="status-value status-muted">${deps.t('statusNoInfo')}</span>`;
  }
  let html = '';
  if (status.cache.cacheControl) {
    html += `<span class="status-value">Cache-Control: ${deps.esc(status.cache.cacheControl)}</span>`;
  }
  if (status.cache.hasCookie) {
    html += `<span class="status-value">${deps.t('statusSetCookiePresent')}</span>`;
  }
  if (status.cache.hasAuth) {
    html += `<span class="status-value">${deps.t('statusAuthorizationPresent')}</span>`;
  }
  if (!html) {
    html = `<span class="status-value status-muted">${deps.t('statusNoCacheInfo')}</span>`;
  }
  return html;
}

export function renderDomainStateHtml(status: StatusInfo, deps: RendererDeps): string {
  const stateMsg = status.domainFilter.allowed
    ? deps.t('statusDomainAllowed')
    : deps.t('statusDomainBlocked');
  const cls = status.domainFilter.allowed ? 'status-success' : 'status-error';
  let html = `<span class="status-value ${cls}">${stateMsg}</span>`;
  if (status.domainFilter.matchedPattern) {
    const patternMsg = deps.t('statusPattern', [deps.esc(status.domainFilter.matchedPattern)]);
    html += `<span class="status-value status-muted">${patternMsg}</span>`;
  }
  return html;
}

export function renderLastSavedHtml(status: StatusInfo, deps: RendererDeps): string {
  if (!status.lastSaved.exists) {
    return `<span class="status-value status-muted">${deps.t('statusNotSaved')}</span>`;
  }
  return `
    <span class="status-value">${deps.esc(status.lastSaved.timeAgo || '')}</span>
    <span class="status-value status-muted">${deps.esc(status.lastSaved.formatted || '')}</span>
  `;
}
