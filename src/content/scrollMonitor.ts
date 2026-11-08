/**
 * scrollMonitor.ts
 * Pure scroll-depth computation extracted from extractor.ts.
 * ContentKernel owns the instance; tests exercise the pure function without DOM.
 */

/**
 * Pure computation of new max scroll percentage.
 * No DOM access, no global mutation — returns the updated max.
 * PBI 2026-11-08-02: every input is sanitized to a finite number first, so
 * a NaN/undefined leak can never poison the comparison into a silent
 * never-update (NaN > x is always false). A NaN currentMax heals to the
 * freshly computed value instead of sticking forever. Overscroll/zoom
 * percentages clamp to [0, 100].
 * @param currentMax - previously recorded max (0..100)
 * @param scrollY - window.scrollY
 * @param docHeight - document.documentElement.scrollHeight - window.innerHeight
 * @returns new max scroll percentage
 */
export function computeMaxScroll(currentMax: number, scrollY: number, docHeight: number): number {
    const base = toFinite(currentMax, 0);
    const y = toFinite(scrollY, 0);
    const h = toFinite(docHeight, 0);
    if (h <= 0) return base;
    const pct = (y / h) * 100;
    if (!Number.isFinite(pct)) return base;
    const clamped = Math.min(100, Math.max(0, pct));
    return clamped > base ? clamped : base;
}

/** Finite-number guard: non-finite inputs fall back instead of poisoning math. */
function toFinite(value: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A viewport height is usable only when it is a finite positive number. */
function isUsableViewport(height: number): boolean {
    return typeof height === 'number' && Number.isFinite(height) && height > 0;
}

export type Clock = () => number;

import type { PageState } from './pageState.js';

/**
 * ScrollMonitor — thin wrapper that mutates PageState.maxScrollPercentage
 * via the pure computeMaxScroll. Keeps updateMaxScroll testable without
 * global window / PageState coupling.
 */
export class ScrollMonitor {
    constructor(
        private readonly pageState: PageState,
        private readonly clock: Clock = () => Date.now(),
    ) {}

    /**
     * Update max scroll from raw metrics. Returns new max.
     * Pure except for the single PageState write.
     */
    update(scrollY: number, docHeight: number): number {
        const next = computeMaxScroll(this.pageState.maxScrollPercentage, scrollY, docHeight);
        if (next !== this.pageState.maxScrollPercentage) {
            this.pageState.maxScrollPercentage = next;
        }
        return next;
    }

    /**
     * Window-bound helper used by ContentKernel — reads window globals.
     * Separated so tests can call update() directly without jsdom globals.
     * PBI 2026-11-08-02 safe-side policy: innerHeight is validated and falls
     * back to documentElement.clientHeight when it is NaN/0/negative, so one
     * bad viewport read no longer freezes depth silently; the next valid
     * read recovers because every call re-resolves the viewport (no latch).
     * When no viewport is readable at all, docHeight degrades to the raw
     * scrollHeight so real scroll movement still advances the depth instead
     * of maintaining; a fully unreadable DOM keeps the last finite max.
     */
    updateFromWindow(): number {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return toFinite(this.pageState.maxScrollPercentage, 0);
        }
        const scrollY = toFinite(window.scrollY, 0);
        const viewport = isUsableViewport(window.innerHeight)
            ? window.innerHeight
            : isUsableViewport(document.documentElement.clientHeight)
              ? document.documentElement.clientHeight
              : NaN;
        const scrollHeight = toFinite(document.documentElement.scrollHeight, NaN);
        const docHeight =
            Number.isFinite(viewport) && Number.isFinite(scrollHeight)
                ? scrollHeight - viewport
                : Number.isFinite(scrollHeight)
                  ? scrollHeight
                  : NaN;
        return this.update(scrollY, docHeight);
    }
}
