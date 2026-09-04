/**
 * deadlineTimer.ts
 * Single one-shot deadline timer + threshold/gate/startTime cache ownership.
 * Extracted from ContentKernel (PBI 15 pure-extraction refactor) so scheduling
 * policy changes no longer touch visit-state evaluation.
 */

import type { Scheduler } from './contentKernel.js';
import type { Clock } from './domainPolicyPort.js';
import type { PageState } from './pageState.js';
import { VisitGate } from './visitGate.js';
import type { VisitGateThresholds } from './visitGate.js';

export interface DeadlineTimerDeps {
    scheduler: Scheduler;
    clock: Clock;
    getPageState: () => PageState;
    isE2ETest: () => boolean;
    onDeadlineEvaluate: () => void;
}

export class DeadlineTimer {
    private cachedThresholds: VisitGateThresholds | null = null;
    private cachedGate: VisitGate | null = null;
    private isE2ECached: boolean | null = null;
    private deadlineMs: number | null = null;
    private cachedStartTime: number | null = null;

    constructor(private readonly deps: DeadlineTimerDeps) {}

    /** Build caches fresh — called once from kernel init. */
    initialize(): void {
        const pageState = this.deps.getPageState();
        this.cachedThresholds = pageState.toVisitGateThresholds();
        this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
        this.isE2ECached = this.deps.isE2ETest();
        this.deadlineMs = pageState.startTime + this.cachedThresholds.minDuration * 1000;
        this.cachedStartTime = pageState.startTime;
    }

    /**
     * Rebuild the cached gate/thresholds/deadline when pageState values drift
     * (settings reload or startTime reset after init). Cached snapshots frozen
     * at init would otherwise silently evaluate against dead values.
     */
    refreshCachesIfStale(): void {
        const pageState = this.deps.getPageState();
        // Compare the source primitives directly — building the thresholds
        // object on every call would defeat the PBI 02 single-construction goal.
        const stale =
            !this.cachedThresholds ||
            this.cachedThresholds.minDuration !== pageState.minVisitDuration ||
            this.cachedThresholds.minScroll !== pageState.minScrollDepth ||
            this.cachedStartTime !== pageState.startTime;
        if (stale) {
            this.cachedThresholds = pageState.toVisitGateThresholds();
            this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
            this.deadlineMs = null;
            this.cachedStartTime = pageState.startTime;
        }
        if (this.isE2ECached === null) this.isE2ECached = this.deps.isE2ETest();
    }

    scheduleNextCheck(): void {
        const pageState = this.deps.getPageState();
        if (pageState.isValidVisitReported || (typeof document !== 'undefined' && document.hidden)) return;
        this.stop(); // idempotent: a stray direct call must not leak a second timer
        this.refreshCachesIfStale();
        if (this.deadlineMs === null) {
            this.deadlineMs = pageState.startTime + this.cachedThresholds!.minDuration * 1000;
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

    get thresholds(): VisitGateThresholds {
        return this.cachedThresholds!;
    }

    get gate(): VisitGate | null {
        return this.cachedGate;
    }

    get isE2E(): boolean | null {
        return this.isE2ECached;
    }
}
