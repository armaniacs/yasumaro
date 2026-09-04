/**
 * contentKernel.ts
 * Unified visit pipeline — owns loadSettings, domainPolicy, scrollMonitor,
 * visitGating and reporting. All side-effectful collaborators are injected
 * so the pipeline is deterministic in tests.
 */

import type { StoragePort } from '../utils/storage/storagePort.js';
import type { DomainPolicyPort } from './domainPolicyPort.js';
import type { Clock } from './domainPolicyPort.js';
import { PageState, type CleansingConfig, DEFAULT_CLEANSING_CONFIG } from './pageState.js';
import { StorageKeys, type StorageKey } from '../utils/storage/types.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../utils/aiSummaryCleaner/rules.js';
import { logInfo, logDebug } from '../utils/logger.js';
import { VisitGate } from './visitGate.js';
import type { VisitState, VisitGateThresholds } from './visitGate.js';
import { preparePageContent } from '../utils/pageContentPipeline.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { ScrollMonitor } from './scrollMonitor.js';
import { VisitReporter, type MessageSender } from './visitReporter.js';
import { createContentMessageSender } from './contentMessageSender.js';
import { getCleansingConfigForDomain } from '../utils/aiSummaryCleaner/perSiteOverride.js';
import { cleanseViaOffscreen as delegateCleanseViaOffscreen } from './cleansingOffscreenDelegate.js';
import { DeadlineTimer } from './deadlineTimer.js';
import { throttle as throttleViaRaf } from './throttle.js';
import { watchDynamicContent as watchDynamicContentImpl } from './watchDynamicContent.js';

export { watchDynamicContent } from './watchDynamicContent.js';

export interface Scheduler {
    schedule(callback: () => void, delayMs?: number): number;
    cancel(id: number): void;
}

export class IdleScheduler implements Scheduler {
    private readonly timeoutIds = new Set<number>();
    private readonly idleIds = new Set<number>();
    private get win(): Window | undefined {
        return typeof globalThis !== 'undefined' ? (globalThis as unknown as { window?: Window }).window ?? (typeof window !== 'undefined' ? window : undefined) : undefined;
    }
    schedule(callback: () => void, delayMs?: number): number {
        if (delayMs !== undefined) {
            const id = globalThis.setTimeout(callback, delayMs) as unknown as number;
            this.timeoutIds.add(id);
            return id;
        }
        const w = this.win as unknown as { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number } | undefined;
        if (w?.requestIdleCallback) {
            const id = w.requestIdleCallback(callback, { timeout: 2000 });
            this.idleIds.add(id);
            return id;
        }
        // Fallback: global setTimeout works in Node/jsdom and browsers
        const id = globalThis.setTimeout(callback, 1000) as unknown as number;
        this.timeoutIds.add(id);
        return id;
    }
    cancel(id: number): void {
        if (this.timeoutIds.has(id)) {
            this.timeoutIds.delete(id);
            globalThis.clearTimeout(id as unknown as NodeJS.Timeout);
            return;
        }
        if (this.idleIds.has(id)) {
            this.idleIds.delete(id);
            const w = this.win as unknown as { cancelIdleCallback?: (id: number) => void } | undefined;
            if (w?.cancelIdleCallback) {
                w.cancelIdleCallback(id);
                return;
            }
        }
        // Fallback: try both
        try {
            globalThis.clearTimeout(id as unknown as NodeJS.Timeout);
        } catch {
            /* ignore */
        }
        const w = this.win as unknown as { cancelIdleCallback?: (id: number) => void } | undefined;
        try {
            w?.cancelIdleCallback?.(id);
        } catch {
            /* ignore */
        }
    }
}

export class FakeScheduler implements Scheduler {
    private nextId = 1;
    private tasks = new Map<number, { cb: () => void; delayMs: number | undefined }>();
    /** All delays passed to schedule (in order) */
    public delays: Array<number | undefined> = [];
    /** Last delay passed to schedule */
    public lastDelay: number | undefined = undefined;
    schedule(callback: () => void, delayMs?: number): number {
        const id = this.nextId++;
        this.tasks.set(id, { cb: callback, delayMs: delayMs });
        this.delays.push(delayMs);
        this.lastDelay = delayMs;
        return id;
    }
    cancel(id: number): void {
        this.tasks.delete(id);
    }
    flush(): void {
        const pending = [...this.tasks.values()];
        this.tasks.clear();
        for (const { cb } of pending) cb();
    }
    pendingCount(): number {
        return this.tasks.size;
    }
    pendingDelays(): Array<number | undefined> {
        return [...this.tasks.values()].map((v) => v.delayMs);
    }
}

const DEFAULT_MIN_VISIT_DURATION = 5;
const DEFAULT_MIN_SCROLL_DEPTH = 50;

export interface ContentKernelOptions {
    pageState?: PageState;
    sender?: MessageSender;
    scheduler?: Scheduler;
    isE2ETest?: () => boolean;
}

export class ContentKernel {
    public readonly pageState: PageState;
    private readonly scrollMonitor: ScrollMonitor;
    private readonly visitReporter: VisitReporter;
    private readonly sender: MessageSender;
    private readonly isE2ETest: () => boolean;
    private readonly deadlineTimer: DeadlineTimer;

    constructor(
        private readonly storage: StoragePort,
        private readonly domainPolicy: DomainPolicyPort,
        private readonly clock: Clock = () => Date.now(),
        private readonly scheduler: Scheduler = new IdleScheduler(),
        opts: ContentKernelOptions = {},
    ) {
        this.pageState = opts.pageState ?? new PageState();
        // Align startTime with injected clock when the default PageState was created with real Date.now
        // Tests that freeze Date.now will construct PageState after stubbing, so this is a no-op in practice,
        // but for explicit clock injection we ensure startTime tracks the fake clock's epoch.
        // Only override if clock is not the default Date.now reference and pageState is fresh.
        this.scrollMonitor = new ScrollMonitor(this.pageState, this.clock);
        this.sender = opts.sender ?? createContentMessageSender(2);
        this.isE2ETest =
            opts.isE2ETest ??
            (() => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ow-e2e-test'));
        this.visitReporter = new VisitReporter({
            pageState: this.pageState,
            extractor: () => this.extractPageContent(),
            applyResult: (r) => this.applyExtractResultToPageState(r),
            sender: this.sender,
            stopPeriodicCheck: () => this.stopPeriodicCheck(),
        });
        this.deadlineTimer = new DeadlineTimer({
            scheduler: this.scheduler,
            clock: this.clock,
            getPageState: () => this.pageState,
            isE2ETest: () => this.isE2ETest(),
            onDeadlineEvaluate: () => this.updateMaxScroll(),
        });
    }

    // -----------------------------------------------------------------------
    // Content extraction (pure delegation to pipeline, SSOT via PageState)
    // -----------------------------------------------------------------------

    extractPageContent(config: CleansingConfig = this.pageState.cleansingConfig): ExtractResult {
        return preparePageContent(config);
    }

    applyExtractResultToPageState(result: ExtractResult): void {
        this.pageState.lastCleansedReason = result.cleansedReason || 'none';
        this.pageState.lastCleanseStats = {
            hardStripRemoved: result.hardStripRemoved ?? 0,
            keywordStripRemoved: result.keywordStripRemoved ?? 0,
            totalRemoved: result.totalRemoved ?? 0,
        };
        this.pageState.lastByteStats = {
            pageBytes: result.pageBytes ?? 0,
            candidateBytes: result.candidateBytes ?? 0,
            originalBytes: result.originalBytes ?? 0,
            cleansedBytes: result.cleansedBytes ?? 0,
        };
        this.pageState.lastAiSummaryCleansedStats = {
            aiSummaryOriginalBytes: result.aiSummaryOriginalBytes ?? 0,
            aiSummaryCleansedBytes: result.aiSummaryCleansedBytes ?? 0,
            aiSummaryCleansedElements: result.aiSummaryCleansedElements ?? 0,
            aiSummaryCleansedReason: result.aiSummaryCleansedReason ?? 'none',
            ...pickDefined({ aiSummaryCleansedReasons: result.aiSummaryCleansedReasons }),
        };
        this.pageState.lastFallbackTriggered = result.fallbackTriggered ?? false;
    }

    // -----------------------------------------------------------------------
    // Settings — single table-driven mapping (SSOT: CLEANSING_RULES + THRESHOLD_RULES + DEFAULT_KEYWORDS via PageState)
    // -----------------------------------------------------------------------

    async loadSettings(): Promise<void> {
        const result = await this.storage.get(['settings']);
        const s: Record<string, unknown> = (result['settings'] as Record<string, unknown> | undefined) ?? {};

        if (s[StorageKeys.MIN_VISIT_DURATION] !== undefined) {
            const parsedDuration = parseInt(String(s[StorageKeys.MIN_VISIT_DURATION]), 10);
            this.pageState.minVisitDuration = Number.isNaN(parsedDuration) ? DEFAULT_MIN_VISIT_DURATION : parsedDuration;
        }
        if (s[StorageKeys.MIN_SCROLL_DEPTH] !== undefined) {
            const parsedDepth = parseInt(String(s[StorageKeys.MIN_SCROLL_DEPTH]), 10);
            this.pageState.minScrollDepth = Number.isNaN(parsedDepth) ? DEFAULT_MIN_SCROLL_DEPTH : parsedDepth;
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
        ];
        for (const [key, prop] of booleanKeys) {
            if (s[key] !== undefined) {
                this.pageState.cleansingConfig[prop] = s[key] === true || s[key] === 'true';
            }
        }

        const stringArrayKeys: Array<[StorageKey, StringArrayCleansingKey]> = [
            [StorageKeys.CONTENT_STRIP_KEYWORDS, 'contentStripKeywords'],
            [StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS, 'aiSummaryCleansingCustomPatterns'],
        ];
        for (const [key, prop] of stringArrayKeys) {
            if (s[key] !== undefined && Array.isArray(s[key])) {
                this.pageState.cleansingConfig[prop] = s[key] as string[];
            }
        }

        for (const t of THRESHOLD_RULES) {
            if (s[t.storageKey] !== undefined) {
                const raw = s[t.storageKey];
                const n = raw != null && raw !== '' ? Number(raw) : NaN;
                const v = Number.isFinite(n) ? n : t.default;
                this.pageState.cleansingConfig[t.prop] = Math.max(t.min, Math.min(t.max, v));
            }
        }

        // Per-site override — hostname に対して完全一致で上書きをマージ
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
                        this.pageState.cleansingConfig as unknown as Record<string, unknown>,
                        rawOverrides as unknown as import('../utils/storage/types.js').DomainCleansingOverride[],
                    ) as unknown as CleansingConfig;
                    this.pageState.cleansingConfig = merged;
                }
            }
        } catch {
            // override 解決の失敗は致命的ではない — グローバル設定で続行
        }

        void logInfo(
            'Settings loaded',
            {
                minVisitDuration: this.pageState.minVisitDuration,
                minScrollDepth: this.pageState.minScrollDepth,
                aiSummaryCleansingEnabled: this.pageState.cleansingConfig.aiSummaryCleansingEnabled,
            },
            'contentKernel',
        ).catch(() => {});
    }

    // -----------------------------------------------------------------------
    // Domain policy — single seam used by both loader and extractor
    // -----------------------------------------------------------------------

    shouldSkipUrl(url: string): boolean {
        return this.domainPolicy.shouldSkip(url);
    }

    async checkDomainAllowedFromCache(url: string): Promise<{ allowed: boolean; useCache: boolean }> {
        return this.domainPolicy.checkDomainAllowedFromCache(url);
    }

    // -----------------------------------------------------------------------
    // Visit gating + scroll
    // -----------------------------------------------------------------------

    shouldRecordVisit(duration: number, scrollPercent: number, minDuration?: number, minScroll?: number): boolean {
        const gate = new VisitGate({
            minDuration: minDuration ?? this.pageState.minVisitDuration,
            minScroll: minScroll ?? this.pageState.minScrollDepth,
        });
        return gate.shouldRecord(duration, scrollPercent);
    }

    createVisitGate(): VisitGate {
        return new VisitGate(this.pageState.toVisitGateThresholds(), this.clock);
    }

    checkVisitConditions(): void {
        this.deadlineTimer.refreshCachesIfStale();
        const visitState: VisitState = this.pageState.toVisitState();
        const thresholds: VisitGateThresholds = this.deadlineTimer.thresholds;
        const gate = this.deadlineTimer.gate;
        const duration = (this.clock() - visitState.startTime) / 1000;

        void logDebug(
            'Visit status',
            { duration, maxScrollPercentage: visitState.maxScrollPercentage, minVisitDuration: thresholds.minDuration, minScrollDepth: thresholds.minScroll },
            'contentKernel',
        );

        if (this.deadlineTimer.isE2E) {
            const state = {
                maxScrollPercentage: visitState.maxScrollPercentage,
                isValidVisitReported: visitState.isValidVisitReported,
                startTime: visitState.startTime,
                minVisitDuration: thresholds.minDuration,
                minScrollDepth: thresholds.minScroll,
                duration,
            };
            if (typeof window !== 'undefined') {
                (window as unknown as { __OW_TEST_STATE?: unknown }).__OW_TEST_STATE = state;
            }
            if (typeof document !== 'undefined') {
                document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(state));
            }
        }

        if (gate!.isReportable(visitState)) {
            console.info(`[OWeave] 自動保存トリガー: 経過${duration.toFixed(1)}s, スクロール${visitState.maxScrollPercentage.toFixed(0)}%`);
            void this.reportValidVisit();
            if (this.deadlineTimer.isE2E) {
                if (typeof window !== 'undefined') {
                    const w = window as unknown as { __OW_TEST_STATE?: { isValidVisitReported: boolean } };
                    if (w.__OW_TEST_STATE) w.__OW_TEST_STATE.isValidVisitReported = true;
                    if (typeof document !== 'undefined' && w.__OW_TEST_STATE) {
                        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(w.__OW_TEST_STATE));
                    }
                }
            }
            this.stopPeriodicCheck();
        }
    }

    updateMaxScroll(): void {
        this.scrollMonitor.updateFromWindow();
        this.checkVisitConditions();
    }

    async reportValidVisit(): Promise<void> {
        await this.visitReporter.report();
    }

    // -----------------------------------------------------------------------
    // Scheduling — thin delegation to DeadlineTimer (owns deadline + caches)
    // -----------------------------------------------------------------------

    scheduleNextCheck(): void {
        this.deadlineTimer.scheduleNextCheck();
    }

    startPeriodicCheck(): void {
        this.deadlineTimer.start();
    }

    stopPeriodicCheck(): void {
        this.deadlineTimer.stop();
    }

    // -----------------------------------------------------------------------
    // Init orchestration — isTrusted guard + E2E hook unified here
    // -----------------------------------------------------------------------

    async init(): Promise<void> {
        await this.loadSettings();

        // Build VisitGate + thresholds and resolve isE2ETest once — reused thereafter
        this.deadlineTimer.initialize();

        // Scroll listener (PBI-02): trusted events evaluate immediately
        // (throttled 100ms). Untrusted (programmatic scrollTo / SPA scroll
        // restoration) events still reflect real position changes — arm a
        // single deferred evaluation so post-deadline crossings are reported,
        // while synthetic event storms stay bounded to one check per second.
        const throttled = this.throttle(() => this.updateMaxScroll());
        let deferredCheckArmed = false;
        if (typeof window !== 'undefined') {
            window.addEventListener(
                'scroll',
                (event: Event) => {
                    if (event.isTrusted) {
                        throttled();
                        return;
                    }
                    if (deferredCheckArmed || this.pageState.isValidVisitReported) return;
                    deferredCheckArmed = true;
                    this.scheduler.schedule(() => {
                        deferredCheckArmed = false;
                        if (!this.pageState.isValidVisitReported) this.updateMaxScroll();
                    }, 1000);
                },
                { passive: true },
            );
            window.addEventListener('beforeunload', () => this.stopPeriodicCheck());
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.stopPeriodicCheck();
                } else if (!this.pageState.isValidVisitReported) {
                    this.startPeriodicCheck();
                }
            });
        }

        this.startPeriodicCheck();

        if (this.deadlineTimer.isE2E && typeof document !== 'undefined') {
            document.documentElement.setAttribute(
                'data-ow-test-state',
                JSON.stringify({
                    maxScrollPercentage: this.pageState.maxScrollPercentage,
                    isValidVisitReported: this.pageState.isValidVisitReported,
                    startTime: this.pageState.startTime,
                    minVisitDuration: this.pageState.minVisitDuration,
                    minScrollDepth: this.pageState.minScrollDepth,
                    duration: 0,
                }),
            );
        }
    }

    /**
     * Throttle via requestAnimationFrame — shared with extractor for backward compat.
     * Implementation lives in ./throttle.js; this stays as the single wiring point.
     */
    throttle<T extends (...args: unknown[]) => void>(fn: T): T {
        return throttleViaRaf(fn);
    }

    // Expose for tests that assert on DEFAULT_CLEANSING_CONFIG SSOT
    getDefaultCleansingConfig(): CleansingConfig {
        return DEFAULT_CLEANSING_CONFIG;
    }

    /**
     * PoC: Offscreen へのクレンジング委譲を試みる。失敗時は同期フォールバック。
     * Content Script のメインスレッド占有を計測するための分岐点。
     */
    async cleanseViaOffscreen(html: string): Promise<string> {
        return delegateCleanseViaOffscreen(html);
    }

    /**
     * 30-13: SPA 動的コンテンツ監視 — implementation lives in
     * ./watchDynamicContent.js; kept as a compat wrapper (tests + callers
     * use kernel.watchDynamicContent, module import also re-exported above).
     */
    watchDynamicContent(onChange: () => void, target?: Element | Document | null, debounceMs = 500): () => void {
        return watchDynamicContentImpl(target ?? null, onChange, debounceMs);
    }
}
