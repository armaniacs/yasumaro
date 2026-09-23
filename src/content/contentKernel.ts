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
import { logInfo, logDebug } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';
import type { VisitGate } from './visitGate.js';
import { preparePageContent } from '../utils/pageContentPipeline.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { ScrollMonitor } from './scrollMonitor.js';
import { VisitReporter, type MessageSender } from './visitReporter.js';
import { createContentMessageSender } from './contentMessageSender.js';
import { cleanseViaOffscreen as delegateCleanseViaOffscreen } from './cleansingOffscreenDelegate.js';
import { DeadlineTimer } from './deadlineTimer.js';
import { throttle as createThrottle } from './throttle.js';
import { IdleScheduler, type Scheduler } from './scheduler.js';
import { VisitGating, applySettingsTable } from './visitGating.js';

// Compat re-exports (PBI 2026-09-23-08): the implementation lives in
// scheduler.js; existing import paths keep working unmodified.
export type { Scheduler } from './scheduler.js';
export { IdleScheduler } from './scheduler.js';

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
    private readonly gating: VisitGating;
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
            extractAndCommit: (c) => this.extractAndCommit(c),
            sender: this.sender,
            stopPeriodicCheck: () => this.stopPeriodicCheck(),
        });
        this.gating = new VisitGating({
            getPageState: () => this.pageState,
            clock: this.clock,
            isE2ETest: () => this.isE2ETest(),
        });
        this.deadlineTimer = new DeadlineTimer({
            scheduler: this.scheduler,
            clock: this.clock,
            getPageState: () => this.pageState,
            isE2ETest: () => this.isE2ETest(),
            onDeadlineEvaluate: () => this.updateMaxScroll(),
            gating: this.gating,
        });
    }

    // -----------------------------------------------------------------------
    // Content extraction (pure delegation to pipeline, SSOT via PageState)
    // -----------------------------------------------------------------------

    /**
     * PBI 2026-09-21-30: the SINGLE config-default resolution point in the
     * kernel (`config ?? this.pageState.cleansingConfig`). The signature
     * stays optional for kernel-internal and existing no-arg callers, but
     * carries no default-parameter — the `??` in the body is the only
     * default. The extractor.ts facade forwards with no default of its own.
     */
    extractPageContent(config?: CleansingConfig): ExtractResult {
        const resolved: CleansingConfig = config ?? this.pageState.cleansingConfig;
        const result = preparePageContent(resolved);
        if (result.cleansingExecuted === true) {
            // Badge 通知は fire-and-forget（PBI-22 MessageSender seam 経由）。
            // 送信失敗は抽出フローを壊さない — ログのみ。
            void this.sender
                .sendMessageWithRetry({
                    type: 'CONTENT_CLEANSING_EXECUTED',
                    payload: {
                        hardStripRemoved: result.hardStripRemoved ?? 0,
                        keywordStripRemoved: result.keywordStripRemoved ?? 0,
                        totalRemoved: result.totalRemoved ?? 0,
                    },
                })
                .catch((e: unknown) => {
                    void logDebug(
                        'CONTENT_CLEANSING_EXECUTED send failed',
                        { error: errorMessage(e) },
                        'contentKernel',
                    );
                });
        }
        return result;
    }

    /**
     * PBI 2026-09-21-30: deep single call folding extract + commit — the
     * ONLY extraction route offered to VisitReporter/GetContentHandler.
     * The commit order is guaranteed inside the kernel — callers hold no
     * sequencing knowledge. Config flows through to extractPageContent,
     * which holds the kernel's single default-resolution point, so an
     * omitted config resolves exactly once however this method is entered.
     */
    extractAndCommit(config?: CleansingConfig): ExtractResult {
        const result = this.extractPageContent(config);
        this.applyExtractResultToPageState(result);
        return result;
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
        this.pageState.lastFallbackReason = result.fallbackReason;
    }

    // -----------------------------------------------------------------------
    // Settings — single table-driven mapping (SSOT: CLEANSING_RULES + THRESHOLD_RULES + DEFAULT_KEYWORDS via PageState)
    // -----------------------------------------------------------------------

    async loadSettings(): Promise<void> {
        const result = await this.storage.get(['settings']);
        const s: Record<string, unknown> = (result['settings'] as Record<string, unknown> | undefined) ?? {};
        applySettingsTable(this.pageState, s);

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
        return this.gating.shouldRecord(duration, scrollPercent, minDuration, minScroll);
    }

    /**
     * VisitGate factory — single implementation lives in VisitGating
     * (PBI-14, centralized by PBI 2026-09-23-08). Facade callers pass an
     * explicit clock for tests; otherwise the kernel clock applies.
     */
    createVisitGate(clock?: Clock): VisitGate {
        return this.gating.createGate(clock);
    }

    checkVisitConditions(): void {
        const evaluation = this.gating.evaluate(this.pageState.toVisitState(), this.clock());
        const { visitState, thresholds, duration } = evaluation;

        void logDebug(
            'Visit status',
            { duration, maxScrollPercentage: visitState.maxScrollPercentage, minVisitDuration: thresholds.minDuration, minScrollDepth: thresholds.minScroll },
            'contentKernel',
        );

        if (this.gating.isE2E) {
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

        if (evaluation.reportable) {
            console.info(`[OWeave] 自動保存トリガー: 経過${duration.toFixed(1)}s, スクロール${visitState.maxScrollPercentage.toFixed(0)}%`);
            void this.reportValidVisit();
            if (this.gating.isE2E) {
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
    // Scheduling — thin delegation to DeadlineTimer (owns the deadline;
    // threshold/gate caches are owned by VisitGating)
    // -----------------------------------------------------------------------

    scheduleNextCheck(): void {
        this.deadlineTimer.scheduleNextCheck();
    }

    startPeriodicCheck(): void {
        this.deadlineTimer.start();
    }

    private scrollThrottles: Array<{ dispose: () => void }> = [];

    stopPeriodicCheck(): void {
        this.deadlineTimer.stop();
        // PBI 2026-09-11-07: dispose throttles (cancel pending trailing call
        // + drop from the beforeunload flush registry).
        for (const t of this.scrollThrottles) t.dispose();
        this.scrollThrottles = [];
    }

    // -----------------------------------------------------------------------
    // Init orchestration — isTrusted guard + E2E hook unified here
    // -----------------------------------------------------------------------

    async init(): Promise<void> {
        await this.loadSettings();

        // Build the owned gate/thresholds and resolve isE2ETest once — reused thereafter
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

        if (this.gating.isE2E && typeof document !== 'undefined') {
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
     * Leading+trailing throttle (PBI 2026-09-11-07). Implementation lives in
     * ./throttle.js; this stays as the single wiring point.
     */
    throttle<T extends (...args: unknown[]) => void>(fn: T) {
        const handle = createThrottle(fn);
        this.scrollThrottles.push(handle);
        return handle.fn;
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
}
