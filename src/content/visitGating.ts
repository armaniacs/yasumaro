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
import { DEFAULT_MIN_SCROLL_DEPTH, DEFAULT_MIN_VISIT_DURATION, mediaThresholdsFor } from '../utils/visitThresholds.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../utils/aiSummaryCleaner/rules.js';
import { cleansingFlagProp } from '../utils/cleansingConfig.js';
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
    /**
     * PBI 2026-10-23-02: media-kind detection for adaptive recording.
     * Defaults to a constant-article verdict so existing constructors and
     * tests keep the legacy pair without changes.
     */
    detectMediaKind?: () => string;
    /** Persisted per-media threshold overrides (empty when unreadable). */
    getMediaThresholdOverrides?: () => Record<string, Record<string, number>>;
}

export class VisitGating {
    private cachedThresholds: VisitGateThresholds | null = null;
    private cachedGate: VisitGate | null = null;
    private isE2ECached: boolean | null = null;
    private cachedStartTime: number | null = null;
    /**
     * PBI 2026-11-08-02: the resolved thresholds are a pure function of
     * (pageState pair, media kind, persisted overrides). The kind + a stable
     * overrides snapshot ride beside the caches so a mediaKind transition or
     * an override-only change rebuilds the gate even when the pageState
     * primitives did not move.
     */
    private cachedMediaKind: string | null = null;
    private cachedOverridesKey: string | null = null;

    constructor(private readonly deps: VisitGatingDeps) {}

    /** Build caches fresh — called once from kernel init via the timer. */
    initialize(): void {
        const pageState = this.deps.getPageState();
        this.cachedThresholds = this.resolveThresholds(pageState);
        this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
        this.isE2ECached = this.deps.isE2ETest();
        this.cachedStartTime = pageState.startTime;
        this.cachedMediaKind = this.currentMediaKind();
        this.cachedOverridesKey = this.snapshotOverrides();
    }

    /**
     * PBI 2026-10-23-02: article pages keep the legacy pair verbatim; other
     * media kinds gate on their own metrics. The media pair starts from the
     * media defaults, so a page the detector classifies as video/pdf/code
     * behaves per-kind and a detector blind spot still falls back to today's
     * article condition. Persisted overrides (MEDIA_THRESHOLDS) ride on top
     * of the base when the reader can supply them.
     */
    private resolveThresholds(pageState: PageState): VisitGateThresholds {
        const kind = this.currentMediaKind();
        if (kind === 'article') return pageState.toVisitGateThresholds();
        return mediaThresholdsFor(kind, this.deps.getMediaThresholdOverrides?.() ?? {});
    }

    private currentMediaKind(): string {
        return this.deps.detectMediaKind?.() ?? 'article';
    }

    /**
     * Stable snapshot of the persisted per-media overrides. Key-sorted so
     * the same content always serializes identically; non-finite leaves are
     * dropped so a corrupt entry cannot pin the key forever.
     */
    private snapshotOverrides(): string {
        const raw: Record<string, Record<string, number>> = this.deps.getMediaThresholdOverrides?.() ?? {};
        const sorted: Record<string, Record<string, number>> = {};
        for (const kind of Object.keys(raw).sort()) {
            const inner = raw[kind];
            if (inner === null || typeof inner !== 'object') continue;
            const sortedInner: Record<string, number> = {};
            for (const key of Object.keys(inner).sort()) {
                const value = inner[key];
                if (typeof value === 'number' && Number.isFinite(value)) sortedInner[key] = value;
            }
            sorted[kind] = sortedInner;
        }
        return JSON.stringify(sorted);
    }

    /**
     * Rebuild the cached gate/thresholds when pageState values drift
     * (settings reload or startTime reset after init). Compares the source
     * primitives directly so a fresh-path call never projects thresholds —
     * the resolve stays behind the cheap key checks (PBI 2026-09-23-08
     * single-gate-lifetime pin). The pageState pair only feeds the article
     * path, so it is compared for article pages only; media pages resolve
     * from kind + overrides, which are compared as their own keys.
     * Returns true when a rebuild happened (lets the timer drop its
     * deadline, which was computed from the old thresholds).
     */
    refreshCachesIfStale(): boolean {
        const pageState = this.deps.getPageState();
        const mediaKind = this.currentMediaKind();
        const overridesKey = this.snapshotOverrides();
        const primitivesStale =
            !this.cachedThresholds ||
            (mediaKind === 'article' &&
                (this.cachedThresholds.minDuration !== pageState.minVisitDuration ||
                    this.cachedThresholds.minScroll !== pageState.minScrollDepth)) ||
            this.cachedStartTime !== pageState.startTime;
        const stale =
            primitivesStale || this.cachedMediaKind !== mediaKind || this.cachedOverridesKey !== overridesKey;
        if (stale) {
            this.cachedThresholds = this.resolveThresholds(pageState);
            this.cachedGate = new VisitGate(this.cachedThresholds, this.deps.clock);
            this.cachedStartTime = pageState.startTime;
            this.cachedMediaKind = mediaKind;
            this.cachedOverridesKey = overridesKey;
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

/**
 * PBI 2026-11-08-02: visit-threshold range policy. 0/negative durations
 * would fire instantly and huge ones never; both are clamped into a sane
 * window instead. minScroll 0 keeps its "scroll gate disabled" meaning, so
 * its floor stays 0 — the duration floor (>= 1s) still prevents instant
 * firing.
 */
export const MIN_VISIT_DURATION_FLOOR = 1;
export const MIN_VISIT_DURATION_CEIL = 3600;
export const MIN_SCROLL_DEPTH_FLOOR = 0;
export const MIN_SCROLL_DEPTH_CEIL = 100;

export function sanitizeVisitThreshold(parsed: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}

/**
 * Table-driven settings mapping (SSOT: CLEANSING_RULES + THRESHOLD_RULES +
 * DEFAULT_KEYWORDS via PageState). Single implementation called by
 * ContentKernel.loadSettings — the only writer of these PageState fields
 * from stored settings.
 */
export function applySettingsTable(pageState: PageState, s: Record<string, unknown>): void {
    if (s[StorageKeys.MIN_VISIT_DURATION] !== undefined) {
        const parsedDuration = parseInt(String(s[StorageKeys.MIN_VISIT_DURATION]), 10);
        pageState.minVisitDuration = sanitizeVisitThreshold(
            parsedDuration,
            MIN_VISIT_DURATION_FLOOR,
            MIN_VISIT_DURATION_CEIL,
            DEFAULT_MIN_VISIT_DURATION,
        );
    }
    if (s[StorageKeys.MIN_SCROLL_DEPTH] !== undefined) {
        const parsedDepth = parseInt(String(s[StorageKeys.MIN_SCROLL_DEPTH]), 10);
        pageState.minScrollDepth = sanitizeVisitThreshold(
            parsedDepth,
            MIN_SCROLL_DEPTH_FLOOR,
            MIN_SCROLL_DEPTH_CEIL,
            DEFAULT_MIN_SCROLL_DEPTH,
        );
    }

    type BooleanCleansingKey = {
        [K in keyof CleansingConfig]: CleansingConfig[K] extends boolean ? K : never;
    }[keyof CleansingConfig];
    type StringArrayCleansingKey = {
        [K in keyof CleansingConfig]: CleansingConfig[K] extends string[] ? K : never;
    }[keyof CleansingConfig];

    const cleansingRuleKeys: Array<[StorageKey, BooleanCleansingKey]> = CLEANSING_RULES.map((rule) => [
        rule.storageKey as StorageKey,
        cleansingFlagProp(rule),
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
                const base = pageState.cleansingConfig as CleansingConfig & Record<string, unknown>;
                const merged = getCleansingConfigForDomain(hostname, base, rawOverrides);
                pageState.cleansingConfig = merged;
            }
        }
    } catch {
        // Override resolution failure is non-fatal — continue with global settings.
    }
}
