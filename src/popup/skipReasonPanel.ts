/**
 * skipReasonPanel.ts
 *
 * Popup last-skip-reason panel (PBI 2026-10-31-01). The popup answers "why
 * was this page not recorded" from the latest skip reason, so it reads the
 * persisted record from chrome.storage.session on open and shows the reason
 * type with its consecutive count. With no record the panel stays hidden so
 * a normal popup is not cluttered, and a stale reason never claims a skip the
 * worker accepted.
 *
 * Storage discipline: the record carries the reason type and the count only
 * (SSOT: src/utils/skipReason.ts) — no URL, no title, no content. 軸3「収集を増やさない」整合.
 *
 * Badge consistency: the panel is a status surface, not a success signal —
 * the styles keep it neutral/warning (styles.css .skip-reason-panel), so a
 * skip reason never renders like the recorded ◎.
 */

import { readLastSkipReason, type LastSkipReason, type SkipReasonCode } from '../utils/skipReason.js';
import { getMessageOr, getMessage } from '../utils/i18n.js';
import { getPluralKey } from '../utils/i18nPlural.js';

/** i18n keys for the reason text, per code. */
const REASON_MESSAGE_KEYS: Record<SkipReasonCode, string> = {
  'condition-not-met': 'skipReasonConditionNotMet',
  duplicate: 'skipReasonDuplicate',
  'private-page': 'skipReasonPrivatePage',
  'pipeline-error': 'skipReasonPipelineError',
};

/** Locale-neutral fallback literals when the bundle has no entry (test DOMs). */
const REASON_FALLBACKS: Record<SkipReasonCode, string> = {
  'condition-not-met': 'Condition not met',
  duplicate: 'Duplicate',
  'private-page': 'Private page',
  'pipeline-error': 'Pipeline error',
};

/** Reason text for a persisted record. */
export function skipReasonText(reason: SkipReasonCode): string {
  const key = REASON_MESSAGE_KEYS[reason];
  if (!key) return '';
  return getMessageOr(key, REASON_FALLBACKS[reason] || '');
}

/**
 * Count detail for the panel — "連続2回" (ja) / "2 times in a row" (en) via
 * the conventional plural key helper. Substitutions go as an array — the
 * getMessage wrapper only expands positional placeholders for array form.
 * Falls back to the locale-neutral "×2" when the bundle has no entry.
 */
export function skipReasonCountText(count: number): string {
  return getMessage(getPluralKey('skipReasonTimes', count), [String(count)]) || `×${count}`;
}

/**
 * Read the persisted record and render the panel. Called once from
 * initPopup (the single entry point) — the popup is opened after the skip
 * settles, so a one-shot read is the contract.
 */
export async function initSkipReasonPanel(): Promise<void> {
  const panel = document.getElementById('skipReasonPanel');
  if (!panel) return;

  let outcome: LastSkipReason | null = null;
  try {
    outcome = await readLastSkipReason();
  } catch {
    outcome = null;
  }

  if (!outcome) {
    panel.classList.add('hidden');
    return;
  }

  const textEl = document.getElementById('skipReasonText');
  const countEl = document.getElementById('skipReasonCount');
  if (textEl) textEl.textContent = skipReasonText(outcome.reason);
  if (countEl) countEl.textContent = skipReasonCountText(outcome.count);
  panel.classList.remove('hidden');
}
