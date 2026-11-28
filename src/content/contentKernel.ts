/**
 * contentKernel.ts
 * Unified visit pipeline — owns loadSettings, domainPolicy, scrollMonitor,
 * visitGating and reporting. All side-effectful collaborators are injected
 * so the pipeline is deterministic in tests.
 */

import type { StoragePort } from '../utils/storage/storagePort.js';
import { readSettingsSnapshot } from '../utils/storage/settingsSnapshot.js';
import type { DomainPolicyPort } from './domainPolicyPort.js';
import type { Clock } from './domainPolicyPort.js';
import { PageState, type CleansingConfig, DEFAULT_CLEANSING_CONFIG } from './pageState.js';
import { logInfo, logDebug } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';
import type { VisitGate } from './visitGate.js';
import { detectMediaKind } from './mediaKind.js';
import { preparePageContent } from '../utils/pageContentPipeline.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { ExtractionReport } from '../utils/contentExtractor/extractionReport.js';
import { ScrollMonitor } from './scrollMonitor.js';
import { VisitReporter, type MessageSender } from './visitReporter.js';
import { createContentMessageSender } from './contentMessageSender.js';
import { cleanseViaOffscreen as delegateCleanseViaOffscreen } from './cleansingOffscreenDelegate.js';
import { DeadlineTimer } from './deadlineTimer.js';
import { throttle as createThrottle } from './throttle.js';
import { IdleScheduler, type Scheduler } from './scheduler.js';
import { VisitGating, applySettingsTable } from './visitGating.js';
import { shouldRearmForLateContent, readVisibleChars as defaultReadVisibleChars } from './lateContentRescan.js';
import { StorageKeys } from '../utils/storage/types.js';
// Probe relay (PBI 2026-10-11-08 follow-up): content scripts cannot reach
// chrome.storage.session, so arming/state travel as runtime messages via the
// service worker. Only the state shape is imported (type-only, erased).
// PBI 2026-10-20-21: the OWTestState field mapping is owned by
// buildProbeState in e2eProbeRelay.js — the two literals here were merged.
import { queryProbeArmed, relayProbeState, markProbeVisitReported, buildProbeState } from './e2eProbeRelay.js';

// Compat re-exports (PBI 2026-09-23-08): the implementation lives in
// scheduler.js; existing import paths keep working unmodified.
export type { Scheduler } from './scheduler.js';
export { IdleScheduler } from './scheduler.js';
import { SpaNavigationMonitor, defaultSpaPollTimer, type SpaPollTimer } from './spaNavigationMonitor.js';


export interface ContentKernelOptions {    pageState?: PageState;
    sender?: MessageSender;
    scheduler?: Scheduler;
    isE2ETest?: () => boolean;
    /**
     * PBI 2026-10-22-06 slice 2 (SPA late-content re-scan): visible-length
     * reader for the re-arm verdict. Defaults to the live DOM read; tests
     * inject a fake length sequence.
     */
    readVisibleChars?: () => number;
}

export class ContentKernel {
    public readonly pageState: PageState;
    private readonly scrollMonitor: ScrollMonitor;
    private readonly visitReporter: VisitReporter;
    private readonly sender: MessageSender;
    private readonly isE2ETest: () => boolean;
    /**
     * Extension-side probe arming. Resolved once in init() via the service
     * worker relay — never from page DOM, so a page-set `data-ow-e2e-test`
     * attribute cannot enable the probe.
     */
    private e2eSessionEnabled = false;
    /** True when no explicit isE2ETest was injected (relay resolve needed). */
    private readonly e2eSessionResolveNeeded: boolean;
    private readonly gating: VisitGating;
    private readonly deadlineTimer: DeadlineTimer;
    /**
     * PBI 2026-10-22-06 slice 2: visible-length reader for the re-arm
     * verdict (injected in tests, live DOM in production).
     */
    private readonly readVisibleChars: () => number;
    /**
     * PBI 2026-10-17-01 (Task 5): content-side early suppression cache. True
     * while the recording pause is engaged. Read once in init() from
     * chrome.storage.local and kept fresh via storage.onChanged. Both
     * checkVisitConditions() and VisitReporter (via isPaused) consult it.
     */
    private pausedCache = false;

    /**
     * PBI 2026-11-28-02 (teardown symmetry): init-success teardown assets —
     * the pause subscription, the SPA navigation subscription and the
     * window/document listeners. Filled by init(), drained by dispose().
     */
    private disposers: Array<() => void> = [];
    private readonly spaMonitor: SpaNavigationMonitor;

    constructor(
        private readonly storage: StoragePort,
        private readonly domainPolicy: DomainPolicyPort,
        private readonly clock: Clock = () => Date.now(),
        private readonly scheduler: Scheduler = new IdleScheduler(),
        opts: ContentKernelOptions = {},
    ) {
        this.pageState = opts.pageState ?? new PageState();
        // No startTime alignment happens here: startTime is owned by PageState
        // and captured with the real wall clock (pageState.ts). Tests that
        // inject a fake clock set pageState.startTime themselves (or pass an
        // explicit PageState); the injected clock only feeds ScrollMonitor,
        // VisitGating and DeadlineTimer below.
        this.scrollMonitor = new ScrollMonitor(this.pageState, this.clock);
        this.sender = opts.sender ?? createContentMessageSender(2);
        this.readVisibleChars = opts.readVisibleChars ?? defaultReadVisibleChars;
        this.e2eSessionResolveNeeded = opts.isE2ETest === undefined;
        // The default no longer reads the page-writable
        // `data-ow-e2e-test` DOM attribute. Arming comes from the
        // extension-side session flag resolved in init() via the service
        // worker relay; explicit injection
        // (unit tests) keeps working unchanged.
        this.isE2ETest = opts.isE2ETest ?? (() => this.e2eSessionEnabled);
        this.visitReporter = new VisitReporter({
            pageState: this.pageState,
            extractAndCommit: (c) => this.extractAndCommit(c),
            sender: this.sender,
            stopPeriodicCheck: () => this.stopPeriodicCheck(),
            isPaused: () => this.pausedCache,
        });
        this.gating = new VisitGating({
            getPageState: () => this.pageState,
            clock: this.clock,
            isE2ETest: () => this.isE2ETest(),
            // PBI 2026-10-23-02: classify the page once at load for adaptive
            // recording; an unknown page still resolves to the article pair.
            detectMediaKind: () => detectMediaKind(document),
        });
        // PBI 2026-11-28-02: SPA detection moves to its coordination class.
        // The monitor owns detection; the kernel owns the reset side
        // (resetForNavigation + best-effort settings reload, deliberately
        // silent per Review S4).
        this.spaMonitor = new SpaNavigationMonitor({
            readUrl: () => {
                try {
                    if (typeof window !== 'undefined' && typeof window.location?.href === 'string') {
                        return window.location.href;
                    }
                } catch {
                    // Location unreadable (non-browser test double) — treated as unknown.
                }
                return null;
            },
            onNavigation: () => {
                this.resetForNavigation();
                void this.loadSettings().catch(() => {
                    // Best-effort reload: the reset above already moved the
                    // startTime, so gating rebuilds with cached thresholds until
                    // the next successful settings read lands. Deliberately
                    // silent (Review S4): warning here would repeat on every
                    // SPA navigation; cached thresholds keep gating and the
                    // next navigation retries.
                });
            },
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
    async extractPageContent(config?: CleansingConfig): Promise<ExtractResult> {
        const resolved: CleansingConfig = config ?? this.pageState.cleansingConfig;
        const result = await preparePageContent(resolved);
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
    async extractAndCommit(config?: CleansingConfig): Promise<ExtractResult> {
        const result = await this.extractPageContent(config);
        this.applyExtractResultToPageState(result);
        return result;
    }

    /**
     * Single-call commit of an extraction report into page state. Field
     * selection lives in the report module; the kernel holds no copy logic.
     */
    applyReport(report: ExtractionReport): void {
        report.applyTo(this.pageState);
    }

    /**
     * Legacy compat: identical mapping via the report intake, so the pinned
     * pair behavior (undefined defaults, unset reasons retention) holds.
     */
    applyExtractResultToPageState(result: ExtractResult): void {
        this.applyReport(ExtractionReport.fromLegacy(result));
    }

    // -----------------------------------------------------------------------
    // Settings — single table-driven mapping (SSOT: CLEANSING_RULES + THRESHOLD_RULES + DEFAULT_KEYWORDS via PageState)
    // -----------------------------------------------------------------------

    async loadSettings(): Promise<void> {
        // Decrypt-free snapshot from the storage side (PBI 2026-09-28-30):
        // migration-folded, no default fill; ciphertext stays opaque.
        const s = await readSettingsSnapshot(this.storage);
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
    // Recording pause — content-side early suppression (PBI 2026-10-17-01)
    // -----------------------------------------------------------------------

    /** Chrome global accessor — undefined outside the extension context (tests). */
    private getChromeApi(): typeof chrome | undefined {
        return (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    }

    /** Pause-deadline fold: a finite ms epoch strictly in the future => paused. */
    private refreshPausedCache(pausedUntil: unknown): void {
        this.pausedCache =
            typeof pausedUntil === 'number' && Number.isFinite(pausedUntil) && this.clock() < pausedUntil;
    }

    /** One-shot read of the pause deadline (content scripts read storage.local directly). */
    private async loadPausedCache(): Promise<void> {
        try {
            const raw = await this.getChromeApi()?.storage?.local?.get(
                StorageKeys.RECORDING_PAUSED_UNTIL,
            );
            this.refreshPausedCache(
                (raw as Record<string, unknown> | undefined)?.[StorageKeys.RECORDING_PAUSED_UNTIL],
            );
        } catch {
            // No chrome in unit tests — stays unpaused.
        }
    }

    /** Keep the cache fresh when the popup/background (un)pauses mid-page. */
    /**
     * Keep the cache fresh when the popup/background (un)pauses mid-page.
     * Returns the unsubscribe so a failed init() can roll the listener
     * back (Review No.3) — a no-op where chrome is unavailable (tests).
     */
    private subscribePauseChanges(): () => void {
        const noop = (): void => {};
        try {
            const onChanged = this.getChromeApi()?.storage?.onChanged;
            if (onChanged === undefined || typeof onChanged.addListener !== 'function') return noop;
            const listener = (
                changes: { [key: string]: chrome.storage.StorageChange },
                areaName: string,
            ): void => {
                if (areaName !== 'local') return;
                const change = changes[StorageKeys.RECORDING_PAUSED_UNTIL];
                if (change) this.refreshPausedCache(change.newValue);
            };
            onChanged.addListener(listener);
            return () => {
                try {
                    onChanged.removeListener(listener);
                } catch {
                    // Best-effort rollback — an init failure must still reject.
                }
            };
        } catch {
            // No chrome — nothing to subscribe.
            return noop;
        }
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

        // Probe relay: state travels to the service worker as a runtime
        // message (content scripts cannot reach chrome.storage.session).
        if (this.gating.isE2E) {
            relayProbeState(this.sender, buildProbeState(visitState, thresholds, duration));
        }

        // PBI 2026-10-17-01 (Task 5): second gate layer — never auto-report
        // while paused. The VisitReporter isPaused backstop covers direct
        // reportValidVisit() callers.
        if (this.pausedCache) return;

        if (evaluation.reportable) {
            void logInfo(`[OWeave] 自動保存トリガー: 経過${duration.toFixed(1)}s, スクロール${visitState.maxScrollPercentage.toFixed(0)}%`, { duration, maxScrollPercentage: visitState.maxScrollPercentage }, 'contentKernel');
            void this.reportValidVisit();
            if (this.gating.isE2E) {
                markProbeVisitReported(this.sender);
            }
            this.stopPeriodicCheck();
            return;
        }

        // PBI 2026-10-22-06 slice 2 (SPA late-content re-scan): the gate
        // closed on the first report, but an infinite-scroll page may have
        // grown a full page since. A bounded re-arm re-opens the gate so the
        // same pipeline re-extracts (with cleansing + PII masking) and
        // re-sends; the worker's admission stays the backstop.
        if (this.pageState.isValidVisitReported && this.maybeRearmForLateContent()) {
            const recheck = this.gating.evaluate(this.pageState.toVisitState(), this.clock());
            if (recheck.reportable) {
                void logInfo('[OWeave] 遅延コンテンツ再記録', { rescanCount: this.pageState.lateRescanCount }, 'contentKernel');
                void this.reportValidVisit();
                if (this.gating.isE2E) {
                    markProbeVisitReported(this.sender);
                }
            }
        }
    }

    /**
     * PBI 2026-10-22-06 slice 2: bounded gate re-arm for late content.
     * Returns true when the gate re-opened. Never throws: the DOM read is
     * fail-closed and the verdict is pure.
     */
    maybeRearmForLateContent(): boolean {
        let current = 0;
        try {
            current = this.readVisibleChars();
        } catch {
            return false;
        }
        if (!shouldRearmForLateContent(this.pageState.reportedContentChars, current, this.pageState.lateRescanCount)) {
            return false;
        }
        this.pageState.isValidVisitReported = false;
        this.pageState.lateRescanCount += 1;
        return true;
    }

    updateMaxScroll(): void {
        this.scrollMonitor.updateFromWindow();
        this.checkVisitConditions();
    }

    /**
     * PBI 2026-11-08-02: SPA navigation entry point. Resets the visit state
     * synchronously so the new page is gated on a fresh startTime and fresh
     * thresholds (settings are reloaded by the history subscriber right
     * after; the gating caches rebuild on the changed startTime even before
     * the reload lands). Restarts the periodic check for the new page view.
     */
    resetForNavigation(now?: number): void {
        this.pageState.resetVisitState(now ?? this.clock());
        this.gating.refreshCachesIfStale();
        this.deadlineTimer.refreshCachesIfStale();
        this.startPeriodicCheck();
    }

    /**
     * PBI 2026-11-08-02: subscribe to SPA navigation. Wraps
     * history.pushState/replaceState and listens to popstate so a navigation
     * without content-script reload resets the visit state and reloads
     * settings for the new page. Idempotent per kernel instance; the
     * returned function unsubscribes (restores the original history methods
     * and drops the listener). No-op without window/history (unit tests).
     *
     * MAIN-world limitation (review No.1): this wrap lives in the content
     * script's isolated world, so a pushState/replaceState executed in the
     * page's MAIN world never passes through these wrappers and never fires
     * this path. MAIN-world coverage comes only from startSpaUrlPolling()
     * below (URL polling, the one content-script-permission-safe backing) —
     * without that polling armed, MAIN-world transitions are missed. The
     * popstate listener is the single path that fires for both worlds.
     * Review No.2: every entry funnels through maybeResetForSpaUrl, which
     * compares fragment-stripped URLs — a same-URL (shallow state update)
     * or hash-only (same-document anchor) pushState/replaceState skips
     * resetForNavigation/loadSettings and only a true URL change resets.
     */
    subscribeSpaNavigation(): () => void {
        return this.spaMonitor.subscribeHistory();
    }

    /**
     * Review No.1: MAIN-world backing for SPA detection (delegates to the
     * SpaNavigationMonitor coordination class, PBI 2026-11-28-02). The timer
     * seam is injectable so tests never wait in real time.
     */
    startSpaUrlPolling(intervalMs = 2000, timer: SpaPollTimer = defaultSpaPollTimer): () => void {
        return this.spaMonitor.startPolling(intervalMs, timer);
    }

    /** Review No.1/No.2: single-shot URL check (delegates to the monitor). */
    pollSpaUrlOnce(): boolean {
        return this.spaMonitor.pollOnce();
    }

    /** Last URL observed by the SPA navigation seam (null before subscribe/poll). */
    getLastSpaUrl(): string | null {
        return this.spaMonitor.getLastUrl();
    }

    async reportValidVisit(): Promise<void> {
        // PBI 2026-10-31-01: mark the attempt so a later page leave does not
        // claim a condition skip for a visit the gate opened (a failed send is
        // not a condition skip). The late-content re-scan resets the settle
        // flag but never this one: every send still counts as an attempt.
        this.pageState.visitReportAttempted = true;
        await this.visitReporter.report();
    }

    /**
     * PBI 2026-10-31-01: the page view is ending without a settled visit —
     * record the skip reason the popup shows. Content scripts cannot reach
     * chrome.storage.session, so the reason travels as a runtime message and
     * the service worker owns the session leg (the pipeline-side reasons are
     * recorded in recordingOutcome.decideStepOutcome, not here).
     *
     * Guards, in order:
     *  - paused: the user paused recording; not a condition skip;
     *  - a settled visit: the outcome policy already recorded the reason;
     *  - an attempted report: a failed send is a transport failure, not a
     *    condition skip.
     *
     * Never throws: the skip reason is advisory and must not break the unload.
     */
    recordSkipIfUnreported(): void {
        if (this.pausedCache) return;
        if (this.pageState.isValidVisitReported) return;
        if (this.pageState.visitReportAttempted) return;
        // PBI 2026-11-08-05: beforeunload delivery is best-effort — a
        // tearing-down page never survives retry backoff sleeps, so the
        // unload path takes one immediate attempt (no sleeps) when the
        // sender offers it. Still fire-and-forget: chrome messaging has no
        // keepalive, and the skip output must not break the unload.
        const sendOnce =
            this.sender.sendMessageWithoutRetry ?? this.sender.sendMessageWithRetry;
        try {
            void Promise.resolve(
                sendOnce.call(this.sender, {
                    type: 'RECORDING_SKIP_REASON',
                    payload: { reason: 'condition-not-met' },
                }),
            ).catch((e: unknown) => {
                void logDebug(
                    'RECORDING_SKIP_REASON send failed',
                    { error: errorMessage(e) },
                    'contentKernel',
                );
            });
        } catch {
            // Skip output must not break the unload.
        }
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
        // Review No.1: symmetric restart of the MAIN-world poll stopped by
        // stopPeriodicCheck(). Re-arms only when a poll was configured via
        // startSpaUrlPolling() and none is running — the config memory and
        // idempotence live inside SpaNavigationMonitor (PBI 2026-11-28-02).
        this.spaMonitor.rearmPolling();
    }

    private scrollThrottles: Array<{ dispose: () => void }> = [];

    stopPeriodicCheck(): void {
        this.deadlineTimer.stop();
        // Review No.1: the MAIN-world URL poll is visit-pipeline traffic —
        // it stops with the periodic check (visibility hide, beforeunload,
        // successful report) and restarts with startPeriodicCheck callers.
        this.spaMonitor.stopPolling();
        // PBI 2026-09-11-07: dispose throttles (cancel pending trailing call
        // + drop from the beforeunload flush registry).
        for (const t of this.scrollThrottles) t.dispose();
        this.scrollThrottles = [];
    }

    // -----------------------------------------------------------------------
    // Init orchestration — isTrusted guard + E2E hook unified here
    // -----------------------------------------------------------------------

    async init(): Promise<void> {
        // Review S6 — half-init policy (fail-closed, no auto-retry): every
        // line below the Promise.all runs only after settings, pause cache
        // and probe flag all resolve. If any rejects, init() rejects with
        // NO scroll listener, NO deadline timer, NO SPA subscription and
        // NO pause listener, so
        // the kernel never gates visits on unloaded thresholds — a
        // half-initialized pipeline stays silent instead of mis-recording.
        // Recovery is a fresh init() (page reload re-runs the entrypoint);
        // there is deliberately no in-page retry loop, because retrying
        // with backoff sleeps inside a tearing-down page is the exact
        // beforeunload hazard the sender seam avoids, and a settings-read
        // failure that persists across reloads must stay visible rather
        // than self-heal into wrong thresholds.
        // PBI 2026-10-17-01 (Task 5): subscribe before the one-shot pause
        // read so a pause change landing mid-init is not missed.
        // Review No.3: the subscription is rolled back when the init below
        // fails, so a rejected init() also leaves NO pause listener behind
        // (the S6 fail-closed claim covers the pause seam too).
        const unsubscribePause = this.subscribePauseChanges();
        // PBI 2026-10-11-12 (NN12): settings load and probe-flag resolve are
        // independent — run them concurrently. loadSettings rejection still
        // rejects init (Promise.all); the flag resolve is fail-safe inside
        // queryProbeArmed (never rejects), so error semantics are unchanged.
        try {
            await Promise.all([
                this.loadSettings(),
                this.loadPausedCache(),
                // Resolve the extension-side probe flag once before the gating caches
                // it — only when the caller did not inject an explicit decision.
                // The service worker reads the session flag on our behalf: content
                // scripts cannot reach chrome.storage.session directly.
                (async () => {
                    if (this.e2eSessionResolveNeeded) {
                        this.e2eSessionEnabled = await queryProbeArmed(this.sender);
                    }
                })(),
            ]);
        } catch (e: unknown) {
            unsubscribePause();
            throw e;
        }

        // Build the owned gate/thresholds and resolve isE2ETest once — reused thereafter
        this.deadlineTimer.initialize();

        // Scroll listener (PBI-02): trusted events evaluate immediately
        // (throttled 100ms). Untrusted (programmatic scrollTo / SPA scroll
        // restoration) events still reflect real position changes — arm a
        // single deferred evaluation so post-deadline crossings are reported,
        // while synthetic event storms stay bounded to one check per second.
        // PBI 2026-11-28-02 (teardown symmetry): every teardown asset the
        // init success path creates is recorded in the disposers list so
        // dispose() can release them all (tests that re-run init stay safe).
        const throttled = this.throttle(() => this.updateMaxScroll());
        let deferredCheckArmed = false;
        if (typeof window !== 'undefined') {
            // PBI 2026-11-08-02: SPA navigation never reloads the content
            // script — without this the previous page's startTime and
            // thresholds gate the new page.
            const unsubscribeSpa = this.subscribeSpaNavigation();
            const onScroll = (event: Event): void => {
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
            };
            const onUnload = (): void => {
                this.stopPeriodicCheck();
                // PBI 2026-10-31-01: the page view is ending — record the
                // skip reason when the visit never settled.
                this.recordSkipIfUnreported();
            };
            // PBI 2026-11-28-02 (teardown symmetry): the named handlers feed
            // both the registration and the disposers, so removeEventListener
            // receives the exact same reference addEventListener registered.
            // The test tsconfig types window as DedicatedWorkerGlobalScope
            // (which lacks scroll/beforeunload removeEventListener overloads);
            // the actual runtime is a browser tab — type it as Window.
            const w = window as unknown as Window;
            w.addEventListener('scroll', onScroll, { passive: true });
            w.addEventListener('beforeunload', onUnload);
            this.disposers.push(
                unsubscribeSpa,
                () => w.removeEventListener('scroll', onScroll),
                () => w.removeEventListener('beforeunload', onUnload),
            );
        }
        if (typeof document !== 'undefined') {
            const onVisibilityChange = (): void => {
                if (document.hidden) {
                    this.stopPeriodicCheck();
                } else if (!this.pageState.isValidVisitReported) {
                    this.startPeriodicCheck();
                }
            };
            document.addEventListener('visibilitychange', onVisibilityChange);
            this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
        }

        this.startPeriodicCheck();

        if (this.gating.isE2E) {
            relayProbeState(
                this.sender,
                buildProbeState(this.pageState.toVisitState(), this.pageState.toVisitGateThresholds(), 0),
            );
        }
    }

    /**
     * PBI 2026-11-28-02 (teardown symmetry): releases every init-success
     * teardown asset — the pause subscription, the SPA navigation
     * subscription, the scroll/beforeunload listeners and the
     * visibilitychange listener. Idempotent (the list drains itself).
     */
    dispose(): void {
        this.stopPeriodicCheck();
        for (const d of this.disposers) d();
        this.disposers = [];
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
