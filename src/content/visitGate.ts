import {
    decideGate,
    isHttpRecordableUrl,
    type GateVerdict,
} from '../utils/recordingGateTable.js';

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

/**
 * Content-side adapter onto the shared recording gate table (PBI 2026-09-23-05).
 * The content script cannot run the service worker's async I/O (storage reads,
 * permissionManager, TrustChecker), so it evaluates only the domainFilter row
 * from the locally known cache verdict — the same row
 * checkDomainFilterStep executes in the pipeline.
 */
export function decideContentDomainAdmission(domainAllowed: boolean): GateVerdict {
    return decideGate('domainFilter', { isAllowed: domainAllowed, force: false });
}

/**
 * Scheme pre-check on the shared vocabulary: popup isRecordable and the
 * content loader skip on the same predicate instead of re-describing it.
 */
export function isContentUrlSchemeRecordable(url: string | null | undefined): boolean {
    return isHttpRecordableUrl(url);
}
