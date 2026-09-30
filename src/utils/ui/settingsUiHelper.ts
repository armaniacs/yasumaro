export {
  loadSettingsToInputs,
  extractSettingsFromInputs,
} from '../settingsFormBinding.js';

export type StatusType = 'success' | 'error';

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

  if (options.autoClear === false) return;

  const timeout = options.durationMs ?? DEFAULT_CLEAR_DELAY_MS[type];
  pendingClearTimers.set(el, setTimeout(() => {
    pendingClearTimers.delete(el);
    el.textContent = '';
    el.className = STATUS_BASE_CLASS;
  }, timeout));
}
