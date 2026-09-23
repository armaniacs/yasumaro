/**
 * deadlineTimer.ts
 * Single one-shot deadline timer. Threshold/gate/startTime cache ownership
 * lives in VisitGating (PBI 2026-09-23-08) — the timer borrows the cached
 * gate via its gating reference and never rebuilds it. A drift rebuild
 * observed through refreshCachesIfStale drops the deadline computed from
 * the old thresholds so the next schedule recomputes it.
 */

import type { Scheduler } from './scheduler.js';
import type { Clock } from './domainPolicyPort.js';
import type { PageState } from './pageState.js';
import type { VisitGate } from './visitGate.js';
import type { VisitGateThresholds } from './visitGate.js';
import type { VisitGating } from './visitGating.js';

export interface DeadlineTimerDeps {
    scheduler: Scheduler;
    clock: Clock;
    getPageState: () => PageState;
    isE2ETest: () => boolean;
    onDeadlineEvaluate: () => void;
    gating: VisitGating;
}

export class DeadlineTimer {
    private deadlineMs: number | null = null;

    constructor(private readonly deps: DeadlineTimerDeps) {}

    /** Build caches fresh — called once from kernel init. */
    initialize(): void {
        this.deps.gating.initialize();
        const pageState = this.deps.getPageState();
        const thresholds = this.deps.gating.thresholds;
        if (thresholds === null) {
            throw new Error('DeadlineTimer: thresholds unavailable after refresh');
        }
        this.deadlineMs = pageState.startTime + thresholds.minDuration * 1000;
    }

    /**
     * Drop the deadline when the borrowed caches drifted (settings reload
     * or startTime reset after init). The gate/threshold rebuild itself is
     * owned by VisitGating.
     */
    refreshCachesIfStale(): void {
        if (this.deps.gating.refreshCachesIfStale()) {
            this.deadlineMs = null;
        }
    }

    scheduleNextCheck(): void {
        const pageState = this.deps.getPageState();
        if (pageState.isValidVisitReported || (typeof document !== 'undefined' && document.hidden)) return;
        this.stop(); // idempotent: a stray direct call must not leak a second timer
        this.refreshCachesIfStale();
        if (this.deadlineMs === null) {
            // PBI 2026-09-11-01 (round 6): refreshCachesIfStale above guarantees
            // cachedThresholds is built (a null forces stale = true). The old
            // non-null assertion hid that contract; this throw states it.
            const thresholds = this.deps.gating.thresholds;
            if (thresholds === null) {
                throw new Error('DeadlineTimer: thresholds unavailable after refresh');
            }
            this.deadlineMs = pageState.startTime + thresholds.minDuration * 1000;
        }
        const remaining = Math.max(0, this.deadlineMs - this.deps.clock());
        pageState.checkIntervalId = this.deps.scheduler.schedule(() => {
            pageState.checkIntervalId = null;
            this.deps.onDeadlineEvaluate();
            // Do NOT reschedule on a fixed loop — after the deadline, trusted
            // scrolls evaluate immediately and untrusted (programmatic) scrolls
            // arm a single deferred check (see init scroll listener), so
            // threshold-crossing visits are still reported without polling.
        }, remaining);
    }

    start(): void {
        this.stop();
        this.scheduleNextCheck();
    }

    stop(): void {
        const pageState = this.deps.getPageState();
        if (pageState.checkIntervalId !== null) {
            this.deps.scheduler.cancel(pageState.checkIntervalId);
            pageState.checkIntervalId = null;
        }
    }

    get thresholds(): VisitGateThresholds | null {
        // PBI 2026-09-11-01 (round 6): mirrors `gate` — pre-init readers get
        // null instead of a crash from the non-null assertion.
        return this.deps.gating.thresholds;
    }

    get gate(): VisitGate | null {
        return this.deps.gating.gate;
    }

    get isE2E(): boolean {
        // PBI 2026-09-11-01 (round 6): non-null contract — until initialize()
        // runs (or refresh caches) the safe default is "not an e2e test".
        return this.deps.gating.isE2E;
    }
}
