export interface VisitGateThresholds {
    minDuration: number;
    minScroll: number;
}

export interface VisitState {
    startTime: number;
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
}

export class VisitGate {
    constructor(
        private thresholds: VisitGateThresholds,
        private clock: () => number = () => Date.now(),
    ) {}

    shouldRecord(duration: number, scroll: number): boolean {
        return duration >= this.thresholds.minDuration && scroll >= this.thresholds.minScroll;
    }

    isReportable(state: VisitState): boolean {
        if (state.isValidVisitReported) return false;
        const elapsed = (this.clock() - state.startTime) / 1000;
        return elapsed >= this.thresholds.minDuration && state.maxScrollPercentage >= this.thresholds.minScroll;
    }
}

/**
 * Backward-compatible helper mirroring the historic `shouldRecordVisit` signature.
 * Delegates to VisitGate internally so existing tests can keep importing a function.
 */
export function shouldRecordVisit(
    duration: number,
    scroll: number,
    minDuration: number = 5,
    minScroll: number = 50,
): boolean {
    return new VisitGate({ minDuration, minScroll }).shouldRecord(duration, scroll);
}
