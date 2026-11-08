// @layer 1 — Shared pending-row action contract (no chrome.* dependency)
/**
 * Shared pending-row action contract (PBI 2026-11-07-17).
 *
 * Defines the shape of the record / recordWithoutAi / delete actions behind
 * a pending row so the popup and dashboard surfaces share one contract
 * instead of evolving two parallel shapes. Presenters own the firing
 * (checkbox selection, busy buttons, in-row errors); this module owns the
 * action names and the dispatch from a `data-pending-action` value to the
 * matching contract handler.
 */

/** Action names carried by `data-pending-action` on pending-row buttons. */
export type PendingRowAction = 'record' | 'recordWithoutAi' | 'delete';

/** Outcome of a record-type pending action. `delete` resolves `void`. */
export interface PendingRowResult {
  ok: boolean;
  error?: string;
}

/**
 * Per-URL handlers a presenter supplies for one pending row. Implemented by
 * the dashboard panel (`createPendingActions`); consumed through
 * `dispatchPendingRowAction` by the row wiring.
 */
export interface PendingRowActions {
  onRecord: (url: string) => Promise<PendingRowResult>;
  onRecordWithoutAi: (url: string) => Promise<PendingRowResult>;
  onDelete: (url: string) => Promise<void>;
}

/**
 * Route a `data-pending-action` value to its contract handler.
 *
 * Preserves the dashboard wiring's historical fallthrough: any value other
 * than `delete` / `record` (including a missing attribute) takes the
 * `recordWithoutAi` path. Resolves `undefined` for `delete` so callers can
 * treat "no result" as success without branching on the action name.
 */
export function dispatchPendingRowAction(
  action: PendingRowAction | string | undefined,
  url: string,
  actions: PendingRowActions
): Promise<PendingRowResult | undefined> {
  if (action === 'delete') {
    return actions.onDelete(url).then(() => undefined);
  }
  if (action === 'record') {
    return actions.onRecord(url);
  }
  return actions.onRecordWithoutAi(url);
}
