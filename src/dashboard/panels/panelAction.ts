/**
 * panelAction.ts
 * Shared scaffold for dashboard panel buttons: disable the trigger, show the
 * panel's busy state, run the operation, render, and restore the controls —
 * including when the call returns `{ error }` or rejects.
 *
 * Each operation keeps its own service call and its own result formatting; only
 * the ordering and the failure safety belong here, because a handler that
 * hand-writes the scaffold is where "re-enable in finally" goes missing.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { isServiceError, type ServiceResult } from '../dashboardSqliteService.js';

/** Which failure path produced the message handed to `onError`. */
export type PanelActionErrorKind = 'service' | 'thrown';

const ABORTED = Symbol('panelActionAborted');

export type PanelActionAbort = typeof ABORTED;

/**
 * Leave an action without rendering anything — a cancelled confirm dialog.
 * Still restores the controls, the way an early `return` from the handler body
 * always ran its `finally`.
 */
export function abortPanelAction(): PanelActionAbort {
  return ABORTED;
}

/**
 * Carries a `{ error }` reason so `onError` receives it verbatim instead of
 * re-deriving it. It extends Error because nested helpers (the archive session
 * list, the edit modal) still catch this and render through `errorMessage`.
 */
class PanelActionFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PanelActionFailure';
  }
}

/** The one unwrap: `{ data }` becomes the data, `{ error }` becomes a failure. */
export function unwrapServiceResult<T>(result: ServiceResult<T>): T {
  if (isServiceError(result)) throw new PanelActionFailure(result.error);
  return result.data;
}

export interface PanelActionSpec<TData> {
  /** Controls disabled for the duration and restored in `finally`. */
  buttons?: readonly (HTMLButtonElement | null | undefined)[];
  /** Busy bookkeeping beyond the buttons (`aria-busy` on a status element, …). */
  onBusy?: (busy: boolean) => void;
  /** Swaps the first button's label while the action runs, and puts it back. */
  busyLabel?: string;
  /** Renders the panel's own in-progress message. */
  onStart?: () => void;
  /** Performs the operation; return `abortPanelAction()` to exit silently. */
  run: () => Promise<TData | PanelActionAbort>;
  /** Renders the resolved data. */
  onSuccess?: (data: TData) => void;
  /**
   * `kind` is 'service' for a `{ error }` result and 'thrown' for a rejection;
   * the two render differently wherever the reason is optional. `cause` is the
   * value that was thrown, for callers that format it themselves.
   */
  onError?: (message: string, kind: PanelActionErrorKind, cause: unknown) => void;
}

export async function runPanelAction<TData>(spec: PanelActionSpec<TData>): Promise<void> {
  const { buttons = [], onBusy, busyLabel, onStart, run, onSuccess, onError } = spec;
  const trigger = buttons.find((button) => button != null) ?? null;
  const restoreLabel = trigger && busyLabel !== undefined ? trigger.textContent : null;

  try {
    for (const button of buttons) if (button) button.disabled = true;
    if (trigger && restoreLabel !== null) trigger.textContent = busyLabel as string;
    onBusy?.(true);
    onStart?.();

    const data = await run();
    if (data === ABORTED) return;
    onSuccess?.(data as TData);
  } catch (err) {
    // A failing onError must not replace the original failure with a new
    // rejection: most callers `void` this promise, so a broken error handler
    // is logged and swallowed instead of being rethrown.
    try {
      if (err instanceof PanelActionFailure) onError?.(err.reason, 'service', err.reason);
      else onError?.(errorMessage(err), 'thrown', err);
    } catch (handlerError) {
      console.error('runPanelAction: onError handler threw', handlerError);
    }
  } finally {
    for (const button of buttons) if (button) button.disabled = false;
    if (trigger && restoreLabel !== null) trigger.textContent = restoreLabel;
    onBusy?.(false);
  }
}