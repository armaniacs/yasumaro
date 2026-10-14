export {
  loadSettingsToInputs,
  extractSettingsFromInputs,
} from '../settingsFormBinding.js';

import { setElementHtml } from '../htmlFragment.js';

/**
 * Status kinds. `updating` is the in-progress kind: the dashboard CSS already
 * ships `.status-message.updating`, and using `success` for "testing…" made a
 * progress message look like a green success box (PBI 2026-10-11-07).
 */
export type StatusType = 'success' | 'error' | 'updating';

/**
 * Base class of the status class contract, defined in
 * entrypoints/options/dashboard.css. The type class is always written next to
 * it, and the base class is what carries the box metrics and the toast
 * transition, so it is part of every write the helper makes.
 */
const STATUS_BASE_CLASS = 'status-message';

const DEFAULT_CLEAR_DELAY_MS: Record<StatusType, number> = {
  success: 3000,
  error: 5000,
  // Never read: `showStatus` returns before scheduling a timer for `updating`
  // (a progress message must stay until its result replaces it).
  updating: 0,
};

/**
 * Pending clear timer, owned per element rather than per module.
 *
 * Without element ownership a second render left the first timer running, so a
 * longer-lived message could be blanked by a deadline that belonged to the
 * message before it (3s success followed by 5s error cleared the error at 3s).
 * A WeakMap keeps the bookkeeping per element — a shared handle would let one
 * element's clear cancel another element's — and lets a detached element be
 * collected with its timer entry.
 */
const pendingClearTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function cancelPendingClear(el: HTMLElement): void {
  const pending = pendingClearTimers.get(el);
  if (pending === undefined) return;
  clearTimeout(pending);
  pendingClearTimers.delete(el);
}

export interface ShowStatusOptions {
  /** Milliseconds until the message clears. Defaults to 3000 / 5000 by type. */
  durationMs?: number;
  /**
   * Set false where the original render had no timer (gist/backup panels, the
   * AI-cleansing save error, the connection-test save errors): the message
   * then stays until the next render replaces it.
   */
  autoClear?: boolean;
}

/**
 * Mirrors the bottom status element into the sticky top bar.
 *
 * Lives in this Layer 0 helper (not in dashboard/statusView) because
 * showStatus owns the mirror and utils must not import from dashboard
 * (see dev-docs/LAYERS.md). dashboard/statusView.js re-exports it for
 * existing dashboard importers. The copy is one-shot and idempotent.
 */
export function syncStatusToTop(): void {
  const statusDiv = document.getElementById('status') as HTMLElement | null;
  const statusTopDiv = document.getElementById('statusTop') as HTMLElement | null;
  if (statusTopDiv && statusDiv) {
    setElementHtml(statusTopDiv, statusDiv.innerHTML);
    statusTopDiv.className = statusDiv.className;
  }
}

/**
 * Single implementation of "show a status message" for the settings surfaces.
 *
 * The class list is written whole rather than patched with classList: patching
 * would keep classes the markup declared for other reasons (`hidden` on
 * #export-status would keep the message invisible), and would let a previous
 * type class survive next to the new one. Writing the whole contract also makes
 * a base-class drop on clear structurally impossible.
 */
export function showStatus(
  elementOrId: string | HTMLElement | null,
  message: string,
  type: StatusType,
  options: ShowStatusOptions = {},
): void {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el) return;

  cancelPendingClear(el);

  el.textContent = message;
  el.className = `${STATUS_BASE_CLASS} ${type}`;

  // Owner of the #status -> #statusTop mirror (PBI 2026-10-05-17): callers
  // writing to #status never hand-call syncStatusToTop. Other element IDs
  // are untouched. Idempotent: a leftover hand call changes nothing.
  if (el.id === 'status') {
    try {
      syncStatusToTop();
      // WHY (intentional silence, PBI 2026-09-22-01裁定): the mirror is
      // cosmetic best-effort — a missed mirror self-heals on the next
      // showStatus, and logging every DOM mismatch would spam per status.
    } catch {}
  }

  if (options.autoClear === false) return;
  // Progress messages are replaced by their result, never expired by a timer.
  if (type === 'updating') return;

  const timeout = options.durationMs ?? DEFAULT_CLEAR_DELAY_MS[type];
  pendingClearTimers.set(el, setTimeout(() => {
    pendingClearTimers.delete(el);
    el.textContent = '';
    el.className = STATUS_BASE_CLASS;
  }, timeout));
}

/**
 * Clear a status element without leaving a type class behind.
 *
 * Callers that used `showStatus(el, '', 'success')` to blank a previous message
 * got an empty green success box: `.status-message.success` carries padding,
 * border and background, and `min-height: 20px` keeps it visible even when
 * empty (PBI 2026-10-11-07).
 */
export function clearStatus(elementOrId: string | HTMLElement | null): void {
  const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
  if (!el) return;

  cancelPendingClear(el);
  el.textContent = '';
  el.className = STATUS_BASE_CLASS;

  if (el.id === 'status') {
    try {
      syncStatusToTop();
      // WHY (intentional silence, PBI 2026-09-22-01裁定): same cosmetic
      // best-effort mirror as showStatus above — self-heals next update.
    } catch {}
  }
}
