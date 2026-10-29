/**
 * visitReporter.ts
 * Single VALID_VISIT sender — extracted from extractor.reportValidVisit (80 lines, 4 branches).
 * ContentKernel owns one instance; tests inject a fake sender and extractor.
 */

import type { PageState, CleansingConfig } from './pageState.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessageOr } from '../utils/i18n.js';
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import { legacyReasonMessageKey } from '../utils/reasonLabel.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logInfo, logWarn, logError, logDebug } from '../utils/logger/api.js';
import type { SleepFn } from '../utils/retryPredicate.js';
import { toValidVisitPayload, buildVisitStats } from './visitPayload.js';
import type { VisitByteStats, VisitAiStats, VisitStats } from './visitPayload.js';
import type { RecordingResult } from '../messaging/types.js';
import {
  deriveOutcomeCode,
  persistLastCaptureOutcome,
  type LastCaptureOutcome,
} from '../utils/captureOutcome.js';

/**
 * Single-owner re-export: stat selection lives in the visitPayload wire
 * adapter (PBI 2026-10-24-05). Kept here so existing importers keep working
 * without carrying their own copy.
 */
export { buildVisitStats };
export type { VisitByteStats, VisitAiStats, VisitStats };

/** Emit a Performance Timeline mark, ignoring environments without `performance`. */
function benchMark(name: string): void {
    try {
        (globalThis as { performance?: Performance }).performance?.mark?.(name);
    } catch {
        /* marks are advisory instrumentation only */
    }
}

/** Message shape accepted by the content-script sender seam. */
export interface Message {
    type: string;
    payload?: unknown;
    target?: string;
    protocolVersion?: number;
}

/**
 * Service Worker response — RecordingResult の別名（PBI 2026-10-05-30:
 * 応答契約 SSOT。手書きコピーを置かない）。
 */
export type ServiceWorkerResponse = RecordingResult;

/**
 * transport の unknown 応答を ServiceWorkerResponse に窄める単一ガード。
 * content 側の応答 `as` はここに集約する。
 *
 * Review note (2026-10-06): 意図的な弱ガード — `success: boolean` の有無
 * しか見ない（previewFlow の isRecordingResult と同一方針）。欠落 field
 * は呼び出し側のデフォルトに委ねる。malformed 応答の振る舞いは
 * visitReporter.test.ts の契約で pin する。
 */
export function isServiceWorkerResponse(value: unknown): value is ServiceWorkerResponse {
    if (typeof value !== 'object' || value === null) return false;
    return typeof (value as { success?: unknown }).success === 'boolean';
}

export interface MessageSender {
    sendMessageWithRetry(message: Message): Promise<ServiceWorkerResponse | undefined>;
}

export interface VisitReporterDeps {
    pageState: PageState;
    /**
     * PBI 2026-09-21-30: the ONLY extraction route. The reporter delegates
     * extract+commit atomically and holds no sequencing knowledge — the
     * extract/apply pair fallback was retired, so there is no second path
     * to choose and no commit to forget.
     */
    extractAndCommit: (config?: CleansingConfig) => ExtractResult;
    sender: MessageSender;
    /** Injected for tests; defaults to real privacyDialog */
    confirmDialog?: (statusCode: string, reasonLabel: string) => Promise<boolean>;
    /** Injected for tests; defaults to the chrome.i18n lookup below */
    getReasonLabel?: (messageKey: string, fallbackKey: string, fallback: string) => string;
    /** Injected clock for traceability, not required for send */
    stopPeriodicCheck?: () => void;
    /**
     * PBI 2026-10-17-01 (Task 5): content-side early suppression. When the
     * recording pause is engaged, report() returns before extraction so no
     * content-side trace (extract/send) is produced while paused.
     */
    isPaused?: () => boolean;
    /**
     * Injected inter-attempt wait for the bounded retry (PBI 19 / AGENTS.md
     * wait policy: production waits on purpose, tests never wait in real
     * time). Defaults to the same real setTimeout wrapper the retry used
     * before this seam existed, so the delay is unchanged.
     */
    sleep?: SleepFn;
    /**
     * PBI 2026-10-22-06 slice 2 (diag wiring): where the settled outcome
     * goes. Defaults to the best-effort storage persist; tests inject a
     * recorder. Fire-and-forget at the call site — reporting never awaits
     * telemetry.
     */
    persistOutcome?: (outcome: LastCaptureOutcome) => void;
}

/** Default retry wait: the real setTimeout wrapper every retry loop uses. */
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Default reason-label lookup (chrome.i18n with graceful fallbacks). */
function defaultGetReasonLabel(messageKey: string, fallbackKey: string, fallback: string): string {
    return typeof chrome !== 'undefined' && chrome.i18n
        ? getMessageOr(messageKey, getMessageOr(fallbackKey, fallback))
        : fallback;
}

export class VisitReporter {
    /**
     * PBI 2026-09-12-18: the commit rule for `pageState.isValidVisitReported`
     * lives here. The flag commits only on success or terminal rejection —
     * never optimistically before the send. A transient transport failure
     * leaves the gate open (one bounded retry), so a busy service worker no
     * longer permanently loses the visit.
     */
    private attemptInFlight = false;

    constructor(private readonly deps: VisitReporterDeps) {}

    /** One bounded retry after a transient transport failure. */
    private static readonly RETRY_DELAY_MS = 1_000;

    /**
     * PBI 2026-10-22-06 slice 2: the single commit point for a settled
     * visit. The reported flag and the persisted diag outcome commit
     * together — a settled visit is never half-recorded. Telemetry is
     * fire-and-forget (persistOutcome must not throw; the default storage
     * write catches internally).
     */
    private commitSettled(contentChars: number, response: ServiceWorkerResponse | undefined): void {
        const { pageState } = this.deps;
        pageState.isValidVisitReported = true;
        // Review fix (P2-3): the late-rescan baseline tracks the content the
        // last SUCCESSFUL recording covers. A settled refusal recorded
        // nothing, so the baseline stays where it was and shouldRearm stays
        // false — otherwise every later growth re-sends a visit the pipeline
        // deterministically rejects (wasted extract + header fetch). The
        // same-day duplicate answers success + skip, so its baseline also
        // advances: another re-send would be a guaranteed skip.
        if (response?.success === true) {
            pageState.reportedContentChars = contentChars;
        }
        const persist = this.deps.persistOutcome
            ?? ((outcome: LastCaptureOutcome): void => {
                void persistLastCaptureOutcome(outcome);
            });
        try {
            persist({ code: deriveOutcomeCode(response), at: Date.now() });
        } catch {
            // Telemetry must never break reporting.
        }
    }

    async report(): Promise<void> {
        if (this.deps.isPaused?.() === true) return;
        if (this.attemptInFlight) return;
        this.attemptInFlight = true;
        try {
            await this.attempt();
        } finally {
            this.attemptInFlight = false;
        }
    }

    private async attempt(retryLeft = 1): Promise<void> {
        const { pageState, sender } = this.deps;
        void logInfo('Sending VALID_VISIT', {}, 'visitReporter');

        // Benchmark instrumentation: the window between these two marks is the
        // content-script's synchronous extract + cleanse cost, which bench/e2e
        // reads via performance.getEntriesByName. No-op when Performance is
        // unavailable (some test doubles).
        benchMark('ow-extract-start');
        // PBI 2026-09-21-30: single route — extract+commit is atomic inside
        // the kernel, so no fallback branch and no sequencing knowledge here.
        const extractResult = this.deps.extractAndCommit();
        const content = extractResult.content;
        benchMark('ow-send-ready');

        try {
            const response = await sender.sendMessageWithRetry({
                type: 'VALID_VISIT',
                // PBI 2026-10-23-02: engagement metrics ride the payload so the
                // saved row's visit_duration/scroll_ratio are no longer NULL.
                payload: toValidVisitPayload(pageState, content, {
                    metrics: {
                        visitDurationSeconds: Math.max(0, (Date.now() - pageState.startTime) / 1000),
                        scrollRatioPercent: pageState.maxScrollPercentage,
                    },
                }),
            });
            void logDebug('VALID_VISIT response', { response }, 'visitReporter');

            if (response && !response.success) {
                if (response.error === 'DOMAIN_BLOCKED') {
                    this.commitSettled(extractResult.content.length, response);
                    return;
                }
                if (response.error === 'PRIVATE_PAGE_DETECTED') {
                    if (!response.confirmationRequired) {
                        // PBI 2026-10-22-06: the settled refusal commits through
                        // the same single point as every other settled visit.
                        // Without this persist the diagnostics panel kept
                        // showing the previous outcome - a silent failure
                        // (沈黙の失敗) for a page the worker refused to record.
                        this.commitSettled(extractResult.content.length, response);
                        return;
                    }
                    const statusCode = reasonToStatusCode(response.reason);
                    const messageKey = statusCodeToMessageKey(statusCode);
                    const getReasonLabel = this.deps.getReasonLabel ?? defaultGetReasonLabel;
                    const reasonLabel = getReasonLabel(
                        messageKey,
                        legacyReasonMessageKey(response.reason),
                        response.reason || 'unknown',
                    );
                    // showPrivacyConfirmDialog shares the confirmDialog seam's
                    // signature, so no cast is needed to unify the two.
                    const confirm = this.deps.confirmDialog
                        ?? (await import('./privacyDialog.js')).showPrivacyConfirmDialog;
                    const userConfirmed = await confirm(statusCode, reasonLabel);
                    if (userConfirmed) {
                        let resendResponse: ServiceWorkerResponse | undefined;
                        try {
                            // PBI 2026-09-15-14: the force re-send uses the same
                            // payload builder — the stats-drop drift (force
                            // re-sends omitting byte/ai fields) is structurally
                            // impossible now.
                            resendResponse = await sender.sendMessageWithRetry({
                                type: 'VALID_VISIT',
                                payload: toValidVisitPayload(pageState, content, {
                                    force: true,
                                    metrics: {
                                        visitDurationSeconds: Math.max(0, (Date.now() - pageState.startTime) / 1000),
                                        scrollRatioPercent: pageState.maxScrollPercentage,
                                    },
                                }),
                            });
                        } catch (retryError: unknown) {
                            await logError('Failed to force save private page', { error: errorMessage(retryError) }, ErrorCode.INTERNAL_ERROR, 'visitReporter');
                        }
                        // Review fix (P1-1): the force re-send records the page
                        // (force=true bypasses the privacy gate in
                        // checkPrivacyHeadersStep), so the settled outcome
                        // normalizes to the re-send's verdict instead of the
                        // original refusal — otherwise the diagnostics panel
                        // shows PRIVATE_PAGE_DETECTED with a fresh timestamp
                        // for a page that IS recorded. A failed or unanswered
                        // re-send keeps the original refusal: the pending page
                        // stays and the panel keeps showing the refusal.
                        if (resendResponse?.success === true) {
                            this.commitSettled(extractResult.content.length, resendResponse);
                            return;
                        }
                    }
                    // A user-declined or answered confirmation is terminal for
                    // this page view — the gate closes either way.
                    this.commitSettled(extractResult.content.length, response);
                    return;
                }
                // Any other non-success is a worker-side failure the retry
                // cannot fix by re-sending now — treat as terminal (gate
                // closes) but log for diagnosis.
                this.commitSettled(extractResult.content.length, response);
                await logError('Background worker error', { error: response.error }, ErrorCode.INTERNAL_ERROR, 'visitReporter');
            } else {
                this.commitSettled(extractResult.content.length, response);
            }
        } catch (error: unknown) {
            // Transient transport failure: leave the flag false so the gate
            // stays open, and schedule one bounded retry.
            const msg = errorMessage(error);
            if (msg && (msg.includes('Extension context invalidated') || msg.includes('sendMessage'))) {
                this.deps.stopPeriodicCheck?.();
                await logInfo('Extension reloaded - page refresh needed', {}, 'visitReporter');
                return;
            }
            await logWarn('Failed to report valid visit', { error: msg }, ErrorCode.API_REQUEST_FAILURE, 'visitReporter');
            if (retryLeft > 0) {
                retryLeft -= 1;
                await (this.deps.sleep ?? defaultSleep)(VisitReporter.RETRY_DELAY_MS);
                await this.attempt(retryLeft);
            }
        }
    }
}
