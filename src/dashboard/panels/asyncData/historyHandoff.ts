/**
 * historyHandoff.ts
 *
 * History → collection handoff (PBI 2026-11-02-03).
 *
 * The history panel owns the filter triple (search/tag/selectedDate); the
 * collections panel owns the clause editor + onSaveV2. This module is the
 * single seam between them:
 *
 * - `buildHistoryHandoffQuery` (pure): packs the triple into the stored
 *   query record the editor understands (`editor.loadSaved` accepts the
 *   same v1 shape, so the handoff restores as one clause). Empty triples
 *   fail closed; an active custom range refuses instead of silently
 *   dropping to a single day. `dropped` names conditions the current
 *   state cannot carry yet (today: none — domain/starred style fields
 *   land here when state grows, so they are warned about, never dropped
 *   silently).
 * - Handoff bus: `requestHistoryHandoff` applies immediately when the
 *   collections panel registered its draft applier, otherwise stashes one
 *   pending query that the collections panel consumes on load
 *   (`consumePendingHistoryHandoff`). Single slot, consume-once: no
 *   history-list multi-execution, no per-clause fan-out (PBI 07 stays
 *   deferred by design).
 */

import { serializeCollectionQuery } from './savedCollectionQuery.js';

/** The filter triple the history panel can hold (no in-place save, no naming here). */
export interface HistoryFilterTriple {
  searchQuery: string;
  activeTagFilter: string | null;
  selectedDate: string | null;
}

/** Ephemeral custom range (since/until with no selectedDate) — not capturable. */
export interface HistoryCustomRange {
  since: number;
  until: number;
}

export type HistoryHandoffRefusal = 'empty' | 'custom-range';

export type HistoryHandoffResult =
  | { ok: true; query: Record<string, unknown>; dropped: string[] }
  | { ok: false; reason: HistoryHandoffRefusal; dropped: string[] };

/**
 * Pack the history filter triple into a collection query record.
 *
 * Refusal order is load-bearing: a custom range refuses even when the
 * triple is non-empty, so a range can never silently degrade to a single
 * day (or vanish while a search term crosses over).
 */
export function buildHistoryHandoffQuery(
  triple: HistoryFilterTriple,
  customRange: HistoryCustomRange | null,
): HistoryHandoffResult {
  // Future state fields that have no collection shape yet (domain, starred,
  // ...) are reported here instead of dropped silently. Today state holds
  // only the triple, so this stays empty — the wiring exists before the
  // first such field does.
  const dropped: string[] = [];
  if (customRange !== null) {
    return { ok: false, reason: 'custom-range', dropped };
  }
  const query = serializeCollectionQuery({
    searchQuery: triple.searchQuery,
    activeTagFilter: triple.activeTagFilter,
    selectedDate: triple.selectedDate,
  });
  if (Object.keys(query).length === 0) {
    return { ok: false, reason: 'empty', dropped };
  }
  return { ok: true, query, dropped };
}

// ---------------------------------------------------------------------------
// Handoff bus — the collections panel registers its draft applier on mount
// and consumes one pending query on load. The history panel only calls
// requestHistoryHandoff; it never touches the editor directly.
// ---------------------------------------------------------------------------

export type CollectionDraftApplier = (query: Record<string, unknown>) => void;

let draftApplier: CollectionDraftApplier | null = null;
let pendingQuery: Record<string, unknown> | null = null;

/** Collections panel mount hook: recall and handoff land in the editor draft. */
export function registerCollectionDraftApplier(applier: CollectionDraftApplier): void {
  draftApplier = applier;
}

export function unregisterCollectionDraftApplier(): void {
  draftApplier = null;
}

/**
 * Deliver a handoff query to the collections draft. Applies immediately
 * when the collections panel is mounted; otherwise stashes it for the
 * next collections load. Returns where it went (the history panel shows
 * the same confirmation either way).
 */
export function requestHistoryHandoff(query: Record<string, unknown>): 'applied' | 'pending' {
  if (draftApplier) {
    draftApplier(query);
    return 'applied';
  }
  pendingQuery = query;
  return 'pending';
}

/** Collections panel load hook: take the stashed query once (null when none). */
export function consumePendingHistoryHandoff(): Record<string, unknown> | null {
  const next = pendingQuery;
  pendingQuery = null;
  return next;
}

/** Test-only reset for the module-level bus. */
export function clearHistoryHandoffForTests(): void {
  draftApplier = null;
  pendingQuery = null;
}
