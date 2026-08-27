/**
 * scrollMonitor.ts
 * Pure scroll-depth computation extracted from extractor.ts.
 * ContentKernel owns the instance; tests exercise the pure function without DOM.
 */

/**
 * Pure computation of new max scroll percentage.
 * No DOM access, no global mutation — returns the updated max.
 * @param currentMax - previously recorded max (0..100)
 * @param scrollY - window.scrollY
 * @param docHeight - document.documentElement.scrollHeight - window.innerHeight
 * @returns new max scroll percentage
 */
export function computeMaxScroll(currentMax: number, scrollY: number, docHeight: number): number {
    if (docHeight <= 0) return currentMax;
    const pct = (scrollY / docHeight) * 100;
    return pct > currentMax ? pct : currentMax;
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
     */
    updateFromWindow(): number {
        const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
        const docHeight =
            typeof document !== 'undefined'
                ? document.documentElement.scrollHeight - window.innerHeight
                : 0;
        return this.update(scrollY, docHeight);
    }
}
