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

/**
 * Per-media-kind visit-gating thresholds (PBI 2026-10-23-02).
 *
 * `article` keeps the legacy pair verbatim, so a page the detector classifies
 * as an article behaves exactly as before (縮退の出口). `video` gates on
 * watched seconds (scroll is meaningless while watching), `pdf` on pages read
 * (vertical scroll percentage does not measure reading), and `code` on one
 * copy event plus dwell time (studying code is not scrolling it).
 */
export interface MediaThresholds {
    /** Seconds of engagement required. Video counts watched time. */
    minDuration: number;
    /** Scroll percentage required (article only). */
    minScroll: number;
    /** Minimum scroll for pdf/code/video: 0 disables the scroll check. */
    minScrollDepth: number;
    /** PDF pages read required. */
    minPdfPages: number;
    /** Copy events on code required. */
    minCodeCopies: number;
}

export const MEDIA_KIND_DEFAULTS: Record<string, MediaThresholds> = {
    article: { minDuration: DEFAULT_MIN_VISIT_DURATION, minScroll: DEFAULT_MIN_SCROLL_DEPTH, minScrollDepth: 0, minPdfPages: 0, minCodeCopies: 0 },
    video: { minDuration: 30, minScroll: 0, minScrollDepth: 0, minPdfPages: 0, minCodeCopies: 0 },
    pdf: { minDuration: 15, minScroll: 0, minScrollDepth: 0, minPdfPages: 2, minCodeCopies: 0 },
    code: { minDuration: 15, minScroll: 0, minScrollDepth: 0, minPdfPages: 0, minCodeCopies: 1 },
};

/** Resolve a persisted or imported media kind defensively to the default pair. */
export function mediaThresholdsFor(kind: string, overrides: Record<string, Partial<MediaThresholds>> = {}): MediaThresholds {
    const base = MEDIA_KIND_DEFAULTS[kind] ?? MEDIA_KIND_DEFAULTS.article;
    return { ...base, ...(overrides[kind] ?? {}) };
}
