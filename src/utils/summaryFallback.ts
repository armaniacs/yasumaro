// @layer 0 — Foundation: AI summary empty-fallback literal (SSOT)
/**
 * Single source of truth for the fallback literal stored/displayed when an AI
 * summary is unavailable ("Summary not available.").
 *
 * Every consumer must import this constant — not re-declare the literal —
 * because AI-failure detection (word-cluster exclusion, golden pins) relies on
 * byte-equality against it. A duplicated copy could silently drift apart and
 * let AI-failure summaries leak into downstream processing.
 *
 * Pure constant: no imports, no chrome API, no side effects (Layer 0).
 */
export const SUMMARY_EMPTY_FALLBACK = 'Summary not available.';
