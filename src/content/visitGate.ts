export interface VisitGateThresholds {
    minDuration: number;
    minScroll: number;
    /** PDF pages read required (0 disables the check). */
    minPdfPages?: number | undefined;
    /** Copy events on code required (0 disables the check). */
    minCodeCopies?: number | undefined;
}

export interface VisitState {
    startTime: number;
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
    /** PDF pages read (adaptive recording, PBI 2026-10-23-02). */
    pdfPagesRead?: number | undefined;
    /** Copy events observed on code content. */
    codeCopies?: number | undefined;
    /** Seconds actually watched for video pages. */
    watchedSeconds?: number | undefined;
}

/**
 * Guard NaN and undefined inputs at the boundary: a metric the page never
 * produced must read as "not met", never as NaN poisoning the comparison.
 */
function metricMet(value: number | undefined, min: number | undefined): boolean {
    if (min === undefined || min <= 0) return true;
    if (value === undefined || Number.isNaN(value)) return false;
    return value >= min;
}

export class VisitGate {
    constructor(
        private thresholds: VisitGateThresholds,
        private clock: () => number = () => Date.now(),
    ) {}

    shouldRecord(duration: number, scroll: number): boolean {
        return (
            duration >= this.thresholds.minDuration &&
            metricMet(scroll, this.thresholds.minScroll) &&
            metricMet(undefined, this.thresholds.minPdfPages) &&
            metricMet(undefined, this.thresholds.minCodeCopies)
        );
    }

    /**
     * Adaptive report check (PBI 2026-10-23-02): each optional metric is
     * gated only when its threshold requires it, so an article page never
     * needs PDF pages and a code page never needs scroll.
     */
    isReportable(state: VisitState): boolean {
        if (state.isValidVisitReported) return false;
        // Clamp negative elapsed caused by NTP correction or clock skew
        const elapsed = Math.max(0, (this.clock() - state.startTime) / 1000);
        const duration = state.watchedSeconds ?? elapsed;
        return (
            duration >= this.thresholds.minDuration &&
            metricMet(state.maxScrollPercentage, this.thresholds.minScroll) &&
            metricMet(state.pdfPagesRead, this.thresholds.minPdfPages) &&
            metricMet(state.codeCopies, this.thresholds.minCodeCopies)
        );
    }
}
