// @layer 0 — Foundation (no imports)
/**
 * visitThresholds.ts
 *
 * Single home for visit-gating default thresholds. DEFAULT_SETTINGS carries
 * the same numbers, but content scripts cannot run the repository read path —
 * these constants are the static fallback shared by content, dashboard, and
 * background instead of restated literals (PBI 2026-09-28-28).
 */
export const DEFAULT_MIN_VISIT_DURATION = 5; // seconds
export const DEFAULT_MIN_SCROLL_DEPTH = 50; // scroll percentage
