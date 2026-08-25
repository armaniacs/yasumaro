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
        // Clamp negative elapsed caused by NTP correction or clock skew
        const elapsed = Math.max(0, (this.clock() - state.startTime) / 1000);
        return elapsed >= this.thresholds.minDuration && state.maxScrollPercentage >= this.thresholds.minScroll;
    }
}
