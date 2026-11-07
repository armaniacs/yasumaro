import { tOrKey as t } from '../../../utils/i18n.js';
import { SQLITE_HISTORY_IDS } from './sqliteHistoryPanelView.js';

// ---------------------------------------------------------------------------
// Confirm dialogs (PBI 2026-11-07-13) — function-moved verbatim from
// sqliteHistoryPanelView.ts. The View re-exports every name below so existing
// importers (sqliteHistoryPanel.ts, tests) keep working; new code should
// import from this module directly.
// ---------------------------------------------------------------------------

function queryById<T extends Element>(root: ParentNode, id: string): T | null {
  return root.querySelector(`#${id}`) as T | null;
}

/**
 * Inline two-step delete confirm living inside the bulk bar, next to the
 * eye line — the shared modal dialog renders at the document end
 * (bottom-left, easy to miss), so bulk delete confirms here instead.
 */
export function showDeleteConfirm(container: HTMLElement): void {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.deleteConfirm);
  if (!confirm) return;
  confirm.classList.remove('hidden');
  confirm.style.display = '';
  queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.deleteConfirmYes)?.focus();
}

export function hideDeleteConfirm(container: HTMLElement): void {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.deleteConfirm);
  if (!confirm) return;
  confirm.classList.add('hidden');
  confirm.style.display = 'none';
}

export function isDeleteConfirmVisible(container: HTMLElement): boolean {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.deleteConfirm);
  return !!confirm && !confirm.classList.contains('hidden');
}

/**
 * Inline two-step star confirm (PBI 2026-10-23-07), same bulk-bar placement
 * as the delete confirm. The private-judged exclusion branch only appears
 * when the selection actually contains privacy-judged rows — a bulk apply
 * never hides what it would sweep in.
 */
export function showStarConfirm(container: HTMLElement, totalCount: number, privateCount: number): void {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.starConfirm);
  if (!confirm) return;
  const textEl = confirm.querySelector('.sqlite-star-confirm-text');
  if (textEl) textEl.textContent = t('historyStarConfirm', [String(totalCount), String(privateCount)]);
  const excludeBtn = queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.starConfirmExclude);
  if (excludeBtn) {
    excludeBtn.classList.toggle('hidden', privateCount === 0);
    excludeBtn.style.display = privateCount === 0 ? 'none' : '';
  }
  hideStarUndo(container);
  confirm.classList.remove('hidden');
  confirm.style.display = '';
  queryById<HTMLButtonElement>(container, SQLITE_HISTORY_IDS.starConfirmAll)?.focus();
}

export function hideStarConfirm(container: HTMLElement): void {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.starConfirm);
  if (!confirm) return;
  confirm.classList.add('hidden');
  confirm.style.display = 'none';
}

export function isStarConfirmVisible(container: HTMLElement): boolean {
  const confirm = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.starConfirm);
  return !!confirm && !confirm.classList.contains('hidden');
}

/**
 * Inline undo for the applied star batch (PBI 2026-10-23-07). Panel-owned:
 * unlike the confirms, the undo survives state changes until the panel
 * invalidates it (selection change, navigation, or the undo itself).
 */
export function showStarUndo(container: HTMLElement, starredCount: number): void {
  const undo = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.starUndo);
  if (!undo) return;
  const textEl = undo.querySelector('.sqlite-star-undo-text');
  if (textEl) textEl.textContent = t('historyStarResult', [String(starredCount)]);
  undo.classList.remove('hidden');
  undo.style.display = '';
}

export function hideStarUndo(container: HTMLElement): void {
  const undo = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.starUndo);
  if (!undo) return;
  undo.classList.add('hidden');
  undo.style.display = 'none';
}

/**
 * Handoff reason line (PBI 2026-11-02-03): in-panel refusal or confirmation
 * for "send to collection". The panel owns the message choice; these only
 * paint it. No-op when the calendar region is absent.
 */
export function setHandoffReason(container: HTMLElement, message: string): void {
  const reason = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.handoffReason);
  if (!reason) return;
  reason.textContent = message;
}

export function clearHandoffReason(container: HTMLElement): void {
  const reason = queryById<HTMLElement>(container, SQLITE_HISTORY_IDS.handoffReason);
  if (!reason) return;
  reason.textContent = '';
}
