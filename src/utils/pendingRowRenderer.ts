// @layer 1 — Shared pending-row HTML (dashboard + popup, no chrome.* dependency)
/**
 * Shared pending-row renderer (PBI 2026-11-07-17).
 *
 * Owns `PendingPage` → row-HTML generation in one place. Both surfaces call
 * this renderer; the checkbox-vs-buttons difference stays a presenter-side
 * config (`PendingRowVariant`), never a renderer branch with its own markup
 * evolution. Byte-identical with the former per-surface builders: the popup
 * checkbox fragment and the dashboard actions row moved here verbatim,
 * including the canonical `escapeHtml` seam and the i18n-key fallbacks.
 */
import { tOrKey as t } from './i18n.js';
import { escapeHtml } from './htmlEscape.js';
import { isSecureUrl } from './urlUtils.js';
import { renderPendingReason } from './pendingStorage.js';
import type { PendingPage } from './pendingStorage.js';

/**
 * Presenter-side row config. `checkbox` returns the inner fragment the popup
 * sets on its `.pending-item` element (the element itself, its dataset, and
 * the title-click wiring stay in the popup presenter). `actions` returns the
 * full outer `.pending-entry` row the dashboard region renders.
 */
export type PendingRowVariant = { readonly mode: 'checkbox' } | { readonly mode: 'actions' };

/** Thin `Date` wrapper — moved from `sqliteHistoryPanelView` with the row that needs it. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Build one pending row's HTML for a `PendingPage`. Pure string composition:
 * no DOM access, no listeners — selection state and action firing stay in
 * the presenters.
 */
export function buildPendingRowHtml(page: PendingPage, variant: PendingRowVariant): string {
  if (variant.mode === 'checkbox') {
    return `
          <input type="checkbox" value="${escapeHtml(page.url)}" class="pending-checkbox">
          <div class="pending-item-content">
            <div class="pending-item-title pending-item-title--link">${escapeHtml(page.title)}</div>
            <div class="pending-item-reason">${escapeHtml(page.headerValue || page.reason)}</div>
          </div>
        `;
  }
  const urlEl = isSecureUrl(page.url)
    ? `<a class="history-entry-url" href="${escapeHtml(page.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(page.title || page.url)}</a>`
    : `<span class="history-entry-url">${escapeHtml(page.title || page.url)}</span>`;
  const header = page.headerValue ? `<span class="pending-entry-header"> (${escapeHtml(page.headerValue)})</span>` : '';
  const meta = `${escapeHtml(formatTimestamp(page.timestamp))} — ${escapeHtml(renderPendingReason(page.reason))}${header}`;
  return `<div class="pending-entry" data-pending-url="${escapeHtml(page.url)}">
    <div class="pending-entry-info">
      ${urlEl}
      <div class="pending-entry-meta">${meta}</div>
    </div>
    <div class="pending-entry-actions">
      <button type="button" class="secondary-btn pending-record-btn" data-pending-action="record" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('recordNow') || '📝 今すぐ記録')}</button>
      <button type="button" class="secondary-btn pending-record-btn" data-pending-action="recordWithoutAi" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('recordWithoutAi') || '📝 AI要約なしで記録')}</button>
      <button type="button" class="secondary-btn pending-delete-btn" data-pending-action="delete" data-pending-url="${escapeHtml(page.url)}">${escapeHtml(t('pendingDeleteForever') || '完全に削除')}</button>
    </div>
  </div>`;
}
