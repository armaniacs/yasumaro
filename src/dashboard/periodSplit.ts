/**
 * periodSplit.ts
 * Pure helper for the tag-cluster time-compare panel (PBI 2026-09-24-08):
 * splits an inclusive epoch-ms window [since, until] into the first half
 * [since, mid] and the second half [mid, until].
 */

export interface PeriodHalves {
  first: { since: number; until: number };
  second: { since: number; until: number };
}

/**
 * Splits the window at mid = since + floor((until - since) / 2).
 *
 * WHY the halves share the mid instant: since/until are inclusive bounds in
 * queryLogs, so a row stamped exactly at mid belongs to both halves — the
 * alternative (mid ± 1) would drop or duplicate the boundary instant
 * depending on which side owns it. A 1ms overlap at the exact midpoint is
 * the least-surprising seam.
 *
 * Total function: non-finite inputs return null (no window to split);
 * since > until is swapped (the UI auto-corrects inversion before calling,
 * but the pure function must not depend on that). since === until yields two
 * identical zero-length halves — callers that reject empty windows check
 * the window length before splitting.
 */
export function splitPeriodInHalves(since: number, until: number): PeriodHalves | null {
  if (!Number.isFinite(since) || !Number.isFinite(until)) {
    return null;
  }
  const start = since <= until ? since : until;
  const end = since <= until ? until : since;
  const mid = start + Math.floor((end - start) / 2);
  return {
    first: { since: start, until: mid },
    second: { since: mid, until: end },
  };
}
