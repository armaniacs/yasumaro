/**
 * entryByteDelta.ts — single owner of the byte-delta display policy (PBI
 * 2026-09-12-21).
 *
 * `sqliteHistoryPanelView` used to spell the sent→ratio→percent→label math
 * five times with two `formatBytes` variants, a `||` chain that dropped
 * legitimate 0-byte values, and one branch without a zero guard rendering
 * `Infinity%`/`NaN%` when `page_bytes` was 0. All of that policy lives here
 * once; the HTML builders become thin adapters.
 *
 * The byte *sizing* policy itself is not owned here: it belongs to
 * `src/dashboard/byteFormat.ts` (PBI 2026-09-25-07), the dashboard-wide SSOT
 * that replaced the three competing definitions.
 */

import { formatBytes } from '../../byteFormat.js';

export interface ByteDelta {
  /** Human-readable "X → Y" bytes label. */
  label: string;
  /** Reduction percent, capped at 99.9 (already fixed to 1 decimal). */
  percent: string;
  /** Ratio of the cleansed/sent size against the original, clamped to [0,1]. */
  ratio: number;
  /** Raw byte numbers, for callers that render the numbers themselves. */
  original: number;
  cleansed: number;
}

/**
 * Describe a reduction from `original` to `cleansed`.
 *
 * Returns null when either side is missing or the original is 0 (nothing to
 * reduce against — the historical Infinity%/NaN% bug). The `??`-friendly
 * contract: pass raw nullable numbers; a legitimate 0 is honored (never
 * treated as missing).
 */
export function describeDelta(
  original: number | null | undefined,
  cleansed: number | null | undefined,
): ByteDelta | null {
  if (original == null || cleansed == null || original <= 0) return null;

  const ratio = Math.min(cleansed / original, 1);
  const percent = Math.min((1 - ratio) * 100, 99.9);

  return {
    label: `${formatBytes(original)} → ${formatBytes(cleansed)}`,
    percent: percent.toFixed(1),
    ratio,
    original,
    cleansed,
  };
}
