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

  el.textContent = message;
  el.className = `${STATUS_BASE_CLASS} ${type}`;

  if (options.autoClear === false) return;

  const timeout = options.durationMs ?? DEFAULT_CLEAR_DELAY_MS[type];
  setTimeout(() => {
    el.textContent = '';
    el.className = STATUS_BASE_CLASS;
  }, timeout);
}
