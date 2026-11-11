/**
 * regionAction.ts
 *
 * Shared skeleton for ask/report-style region actions (PBI 2026-11-11-06).
 *
 * The ask-history region and the two research-report regions repeated the
 * same skeleton: click → busy paint → try the gateway action → paint the
 * failure reason (or the translated fallback) → paint the exception message
 * (or the same fallback). Only the success paint differed. This module owns
 * the skeleton; regions own their gateway call and their success paint.
 * The double-execution guard stays unified because every region funnels
 * through `withBusyButton`, which disables the button for the run.
 *
 * The sqliteHistory pending-row in-row paint is intentionally out of scope:
 * it lives under the pendingRowRenderer row contract, not the region
 * skeleton, so it keeps its own markup.
 */

import { escapeHtml } from '../../../utils/htmlEscape.js';
import { withBusyButton } from './busyButton.js';

/** Minimal outcome contract the skeleton branches on. */
export interface RegionActionOutcome {
  ok: boolean;
  error?: string;
}

/** Fixed status labels for one skeleton run (wording owned by the caller). */
export interface RegionActionLabels {
  /** Painted before the action runs (busy line). */
  busy: string;
  /** Fallback when the action fails or throws without its own message. */
  failed: string;
}

/**
 * Runs `action` under the busy-button guard with the shared status
 * transitions: paint `busy`, then on failure paint `error ?? failed`, on
 * exception paint the thrown message `?? failed`, and on success hand the
 * ok result to `onSuccess` for the region-owned paint. `beforeRun` clears
 * region-owned output (e.g. the previous answer) before the busy paint.
 */
export async function runRegionAction<R extends RegionActionOutcome>(
  button: HTMLButtonElement,
  setStatus: (message: string) => void,
  labels: RegionActionLabels,
  action: () => Promise<R>,
  onSuccess: (result: R) => void,
  beforeRun?: () => void,
): Promise<void> {
  await withBusyButton(button, async () => {
    beforeRun?.();
    setStatus(labels.busy);
    try {
      const result = await action();
      if (!result.ok) {
        setStatus(result.error ?? labels.failed);
        return;
      }
      onSuccess(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : labels.failed);
    }
  });
}

/**
 * Builds the shared status-line div both region sections paint into:
 * `<div class role="status" aria-live="polite"></div>`. Byte-identical to
 * the literals it replaces; the class stays caller-owned.
 */
export function buildStatusDivHtml(cssClass: string): string {
  return `<div class="${escapeHtml(cssClass)}" role="status" aria-live="polite"></div>`;
}
