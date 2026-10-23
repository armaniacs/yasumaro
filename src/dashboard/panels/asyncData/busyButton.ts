/**
 * busyButton.ts
 *
 * Shared seam for the busy-button idiom used by the asyncData regions:
 * save the label, disable the button, show the processing text, then restore.
 * Regions own their gateway call and status paint; this module owns only the
 * button lifecycle so a fifth copy cannot forget the restore.
 *
 * Regions whose success path replaces the button wholesale (re-render)
 * pass `{ restoreOnSuccess: false }` to pin the intentional no-restore —
 * failure still restores. Throwing from `run` always restores, then the
 * error propagates so the caller can paint it exactly as before.
 */

import { tOrKey as t } from '../../../utils/i18n.js';

/** Options for {@link withBusyButton}. */
export interface BusyButtonOptions {
  /**
   * Restore label and enabled state when `run` resolves. Set to `false`
   * only when success replaces the button (re-render), making a restore
   * dead code. Defaults to `true`; rejection always restores.
   */
  restoreOnSuccess?: boolean;
}

/**
 * Runs `run` while `button` shows the busy state. Returns `run`'s value on
 * success; on rejection the button is restored first and the error rethrows.
 */
export async function withBusyButton<T>(
  button: HTMLButtonElement,
  run: () => Promise<T>,
  options?: BusyButtonOptions,
): Promise<T> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = t('processing') || '処理中...';
  let completed = false;
  try {
    const result = await run();
    completed = true;
    if (options?.restoreOnSuccess !== false) {
      button.disabled = false;
      button.textContent = label;
    }
    return result;
  } finally {
    if (!completed) {
      button.disabled = false;
      button.textContent = label;
    }
  }
}
