/**
 * visitGating.ts
 * Single owner of visit-gate lifetime on the content side
 * (PBI 2026-09-23-08). Previously three construction sites coexisted —
 * per-call construction in the kernel's shouldRecordVisit, the
 * createVisitGate factory, and DeadlineTimer's cache+drift-rebuild — with
 * two fallbacks chained in checkVisitConditions. All of that now funnels
 * through `evaluate(state, now)`; the timer borrows the cached gate and
 * never rebuilds it.
 *
 * The nullable pre-init contract (PBI 2026-09-11-01/2026-09-12-29) is kept
 * as an explicit mode: before initialize() the cached thresholds/gate read
 * null, and evaluate() falls back to the live page-state projection instead
 * of crashing.
 *
 * This module also owns the settings-to-PageState mapping
 * (applySettingsTable) so the kernel's loadSettings is a single call.
 * Content-script safe: no SW-only chrome APIs.
 */

import type { Clock } from './domainPolicyPort.js';
import type { PageState, CleansingConfig } from './pageState.js';
import { VisitGate } from './visitGate.js';
import type { VisitGateThresholds, VisitState } from './visitGate.js';
import { StorageKeys, type StorageKey } from '../utils/storage/types.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../utils/aiSummaryCleaner/rules.js';
import { getCleansingConfigForDomain } from '../utils/aiSummaryCleaner/perSiteOverride.js';

export interface VisitEvaluation {
    reportable: boolean;
    duration: number;
    thresholds: VisitGateThresholds;
    gate: VisitGate;
    visitState: VisitState;
}

export interface VisitGatingDeps {
    getPageState: () => PageState;
    clock: Clock;
    isE2ETest: () => boolean;
}

export class VisitGating {
    private cachedThresholds: VisitGateThresholds | null = null;
    private cachedGate: VisitGate | null = null;
    private isE2ECached: boolean | null = null;
    private cachedStartTime: number | null = null;

    constructor(private readonly deps: VisitGatingDeps) {}

    /** Build caches fresh — called once from kernel init via the timer. */
    initialize(): void {
        const pageState = this.deps.getPageState();
        this.cachedThresholds = pageState.toVisitGateThresholds();
        this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
        this.isE2ECached = this.deps.isE2ETest();
        this.cachedStartTime = pageState.startTime;
    }

    /**
     * Rebuild the cached gate/thresholds when pageState values drift
     * (settings reload or startTime reset after init). Compares the source
     * primitives directly so a fresh-path call never projects thresholds.
     * Returns true when a rebuild happened (lets the timer drop its
     * deadline, which was computed from the old thresholds).
     */
    refreshCachesIfStale(): boolean {
        const pageState = this.deps.getPageState();
        const stale =
            !this.cachedThresholds ||
            this.cachedThresholds.minDuration !== pageState.minVisitDuration ||
            this.cachedThresholds.minScroll !== pageState.minScrollDepth ||
            this.cachedStartTime !== pageState.startTime;
        if (stale) {
            this.cachedThresholds = pageState.toVisitGateThresholds();
            this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
            this.cachedStartTime = pageState.startTime;
        }
        if (this.isE2ECached === null) this.isE2ECached = this.deps.isE2ETest();
        return stale;
    }

    /**
     * The single gate factory (PBI-14). Facade callers pass an explicit
     * clock for tests; otherwise the gating clock applies.
     */
    createGate(clock?: Clock): VisitGate {
        return new VisitGate(this.deps.getPageState().toVisitGateThresholds(), clock ?? this.deps.clock);
    }

    /**
     * Pure threshold check with explicit overrides. Same predicate the
     * former per-call kernel construction evaluated; kept here so gate
     * construction exists in exactly one module.
     */
    shouldRecord(duration: number, scrollPercent: number, minDuration?: number, minScroll?: number): boolean {
        const pageState = this.deps.getPageState();
        const gate = new VisitGate({
            minDuration: minDuration ?? pageState.minVisitDuration,
            minScroll: minScroll ?? pageState.minScrollDepth,
        });
        return gate.shouldRecord(duration, scrollPercent);
    }

    /**
     * The single evaluation seam. Refreshes the cache, resolves the
     * pre-init nullable fallbacks against the live page-state projection,
     * and returns the verdict plus the borrowed gate/thresholds for
     * orchestration (E2E state publishing, reporting).
     *
     * The verdict applies the gate predicate to the explicit `now` rather
     * than re-reading the clock inside the gate, so the timestamp is
     * meaningful to callers. The kernel always passes its own clock value,
     * which makes the verdict identical to the former gate.isReportable
     * path (same clock, same clamped-elapsed predicate).
     */
    evaluate(state: VisitState, now: number): VisitEvaluation {
        this.refreshCachesIfStale();
        // Pre-init edge (PBI 2026-09-11-01/2026-09-12-29): caches are null
        // before initialize() — project from live page state instead of the
        // former non-null assert that crashed direct/pre-init calls.
        const thresholds: VisitGateThresholds =
            this.thresholds ?? this.deps.getPageState().toVisitGateThresholds();
        const gate: VisitGate = this.gate ?? new VisitGate(thresholds, this.deps.clock);
        const duration = (now - state.startTime) / 1000;
        // Clamp negative elapsed caused by NTP correction or clock skew.
        const elapsed = Math.max(0, duration);
        const reportable =
            !state.isValidVisitReported &&
            elapsed >= thresholds.minDuration &&
            state.maxScrollPercentage >= thresholds.minScroll;
        return { reportable, duration, thresholds, gate, visitState: state };
    }

    get thresholds(): VisitGateThresholds | null {
        // Pre-init readers get null instead of a crash from a non-null assert.
        return this.cachedThresholds;
    }

    get gate(): VisitGate | null {
        return this.cachedGate;
    }

    get isE2E(): boolean {
        // Until initialize() runs (or caches refresh) the safe default is
        // "not an e2e test".
        return this.isE2ECached ?? false;
    }
}

const DEFAULT_MIN_VISIT_DURATION = 5;
const DEFAULT_MIN_SCROLL_DEPTH = 50;

/**
 * Table-driven settings mapping (SSOT: CLEANSING_RULES + THRESHOLD_RULES +
 * DEFAULT_KEYWORDS via PageState). Single implementation called by
 * ContentKernel.loadSettings — the only writer of these PageState fields
 * from stored settings.
 */
export function applySettingsTable(pageState: PageState, s: Record<string, unknown>): void {
    if (s[StorageKeys.MIN_VISIT_DURATION] !== undefined) {
        const parsedDuration = parseInt(String(s[StorageKeys.MIN_VISIT_DURATION]), 10);
        pageState.minVisitDuration = Number.isNaN(parsedDuration) ? DEFAULT_MIN_VISIT_DURATION : parsedDuration;
    }
    if (s[StorageKeys.MIN_SCROLL_DEPTH] !== undefined) {
        const parsedDepth = parseInt(String(s[StorageKeys.MIN_SCROLL_DEPTH]), 10);
        pageState.minScrollDepth = Number.isNaN(parsedDepth) ? DEFAULT_MIN_SCROLL_DEPTH : parsedDepth;
    }

    type BooleanCleansingKey = {
        [K in keyof CleansingConfig]: CleansingConfig[K] extends boolean ? K : never;
    }[keyof CleansingConfig];
    type StringArrayCleansingKey = {
        [K in keyof CleansingConfig]: CleansingConfig[K] extends string[] ? K : never;
    }[keyof CleansingConfig];

    const cleansingRuleKeys: Array<[StorageKey, BooleanCleansingKey]> = CLEANSING_RULES.map((rule) => [
        rule.storageKey as StorageKey,
        `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}` as BooleanCleansingKey,
    ]);

    const booleanKeys: Array<[StorageKey, BooleanCleansingKey]> = [
        [StorageKeys.CONTENT_STRIP_HARD_ENABLED, 'contentStripHardEnabled'],
        [StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED, 'contentStripKeywordEnabled'],
        [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED, 'aiSummaryCleansingEnabled'],
        ...cleansingRuleKeys,
        [StorageKeys.WHITELIST_EXTRACTION_ENABLED, 'whitelistExtractionEnabled'],
        [StorageKeys.CONTENT_DEDUP_ENABLED, 'contentDedupEnabled'],
        // PBI 05 overcut guards
        [StorageKeys.EXTRACTION_GUARD_CANDIDATE_ENABLED, 'candidateGuardEnabled'],
        [StorageKeys.EXTRACTION_GUARD_CONTENT_CLEANSE_ENABLED, 'cleanseGuardEnabled'],
    ];
    for (const [key, prop] of booleanKeys) {
        if (s[key] !== undefined) {
            pageState.cleansingConfig[prop] = s[key] === true || s[key] === 'true';
        }
    }

    const stringArrayKeys: Array<[StorageKey, StringArrayCleansingKey]> = [
        [StorageKeys.CONTENT_STRIP_KEYWORDS, 'contentStripKeywords'],
        [StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS, 'aiSummaryCleansingCustomPatterns'],
    ];
    for (const [key, prop] of stringArrayKeys) {
        if (s[key] !== undefined && Array.isArray(s[key])) {
            pageState.cleansingConfig[prop] = s[key] as string[];
        }
    }

    for (const t of THRESHOLD_RULES) {
        if (s[t.storageKey] !== undefined) {
            const raw = s[t.storageKey];
            const n = raw != null && raw !== '' ? Number(raw) : NaN;
            const v = Number.isFinite(n) ? n : t.default;
            pageState.cleansingConfig[t.prop] = Math.max(t.min, Math.min(t.max, v));
        }
    }

    // Per-site override — merged on exact hostname match.
    try {
        const rawOverrides = s[StorageKeys.DOMAIN_CLEANSING_OVERRIDES];
        if (Array.isArray(rawOverrides) && rawOverrides.length > 0) {
            const hostname =
                typeof window !== 'undefined' && window.location?.hostname
                    ? window.location.hostname
                    : '';
            if (hostname) {
                const merged = getCleansingConfigForDomain(
                    hostname,
                    pageState.cleansingConfig as unknown as Record<string, unknown>,
                    rawOverrides as unknown as import('../utils/storage/types.js').DomainCleansingOverride[],
                ) as unknown as CleansingConfig;
                pageState.cleansingConfig = merged;
            }
        }
    } catch {
        // Override resolution failure is non-fatal — continue with global settings.
    }
}
