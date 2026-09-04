/**
 * visitReporter.ts
 * Single VALID_VISIT sender — extracted from extractor.reportValidVisit (80 lines, 4 branches).
 * ContentKernel owns one instance; tests inject a fake sender and extractor.
 */

import type { PageState } from './pageState.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import { errorMessage } from '../utils/errorUtils.js';
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import { logInfo, logWarn, logError, logDebug, ErrorCode } from '../utils/logger.js';

/** Byte-stat subset shared by the VALID_VISIT payload and the GET_CONTENT reply. */
export interface VisitByteStats {
  pageBytes?: number | undefined;
  candidateBytes?: number | undefined;
  originalBytes?: number | undefined;
  cleansedBytes?: number | undefined;
}

/** AI-cleanse stat subset shared by both send paths. */
export interface VisitAiStats {
  aiSummaryOriginalBytes?: number | undefined;
  aiSummaryCleansedBytes?: number | undefined;
  aiSummaryCleansedElements?: number | undefined;
  aiSummaryCleansedReason?: AiSummaryCleansedReason | undefined;
  aiSummaryCleansedReasons?: string[] | undefined;
}

/** One field-selection source for both send paths (auto-visit + manual fetch). */
export interface VisitStats {
  byteStats: VisitByteStats;
  aiStats: VisitAiStats;
  fallbackTriggered: boolean;
}

/**
 * Build the shared stat selection from PageState. The `|| undefined` /
 * `!== 'none'` normalization lives here once — not once per send path.
 */
export function buildVisitStats(pageState: PageState): VisitStats {
  const ai = pageState.lastAiSummaryCleansedStats;
  return {
    byteStats: {
      pageBytes: pageState.lastByteStats.pageBytes || undefined,
      candidateBytes: pageState.lastByteStats.candidateBytes || undefined,
      originalBytes: pageState.lastByteStats.originalBytes || undefined,
      cleansedBytes: pageState.lastByteStats.cleansedBytes || undefined,
    },
    aiStats: {
      aiSummaryOriginalBytes: ai.aiSummaryOriginalBytes || undefined,
      aiSummaryCleansedBytes: ai.aiSummaryCleansedBytes || undefined,
      aiSummaryCleansedElements: ai.aiSummaryCleansedElements || undefined,
      aiSummaryCleansedReason:
        ai.aiSummaryCleansedReason !== 'none' ? ai.aiSummaryCleansedReason : undefined,
      aiSummaryCleansedReasons: ai.aiSummaryCleansedReasons,
    },
    fallbackTriggered: pageState.lastFallbackTriggered,
  };
}

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
 * Service Worker response — the RecordingResult-derived fields a VALID_VISIT /
 * MANUAL_RECORD reply can carry.
 */
export interface ServiceWorkerResponse {
    success: boolean;
    error?: string;
    skipped?: boolean;
    reason?: string;
    summary?: string;
    title?: string;
    url?: string;
    preview?: boolean;
    processedContent?: string;
    mode?: string;
    maskedCount?: number;
    maskedItems?: unknown[];
    aiDuration?: number;
    obsidianDuration?: number;
    confirmationRequired?: boolean;
    headerValue?: string;
}

export interface MessageSender {
    sendMessageWithRetry(message: Message): Promise<ServiceWorkerResponse>;
}

export interface VisitReporterDeps {
    pageState: PageState;
    extractor: () => ExtractResult;
    applyResult: (r: ExtractResult) => void;
    sender: MessageSender;
    /** Injected for tests; defaults to real privacyDialog */
    confirmDialog?: (statusCode: string, reasonLabel: string) => Promise<boolean>;
    /** Injected for tests; defaults to the chrome.i18n lookup below */
    getReasonLabel?: (messageKey: string, fallbackKey: string, fallback: string) => string;
    /** Injected clock for traceability, not required for send */
    stopPeriodicCheck?: () => void;
}

/** Default reason-label lookup (chrome.i18n with graceful fallbacks). */
function defaultGetReasonLabel(messageKey: string, fallbackKey: string, fallback: string): string {
    return typeof chrome !== 'undefined' && chrome.i18n?.getMessage
        ? chrome.i18n.getMessage(messageKey) ||
          chrome.i18n.getMessage(fallbackKey) ||
          fallback
        : fallback;
}

export class VisitReporter {
    constructor(private readonly deps: VisitReporterDeps) {}

    async report(): Promise<void> {
        const { pageState, extractor, applyResult, sender } = this.deps;
        pageState.isValidVisitReported = true;
        void logInfo('Sending VALID_VISIT', {}, 'visitReporter');
        console.info('[OWeave] VALID_VISIT 送信開始');

        // Benchmark instrumentation: the window between these two marks is the
        // content-script's synchronous extract + cleanse cost, which bench/e2e
        // reads via performance.getEntriesByName. No-op when Performance is
        // unavailable (some test doubles).
        benchMark('ow-extract-start');
        const extractResult = extractor();
        applyResult(extractResult);
        const content = extractResult.content;
        benchMark('ow-send-ready');

        try {
            const stats = buildVisitStats(pageState);
            const response = await sender.sendMessageWithRetry({
                type: 'VALID_VISIT',
                payload: {
                    content,
                    ...stats.byteStats,
                    ...stats.aiStats,
                    fallbackTriggered: stats.fallbackTriggered,
                },
            });
            void logDebug('VALID_VISIT response', { response }, 'visitReporter');
            console.info('[OWeave] VALID_VISIT レスポンス:', JSON.stringify(response));

            if (response && !response.success) {
                if (response.error === 'DOMAIN_BLOCKED') {
                    return;
                }
                if (response.error === 'PRIVATE_PAGE_DETECTED') {
                    if (!response.confirmationRequired) {
                        return;
                    }
                    const statusCode = reasonToStatusCode(response.reason);
                    const messageKey = statusCodeToMessageKey(statusCode);
                    const getReasonLabel = this.deps.getReasonLabel ?? defaultGetReasonLabel;
                    const reasonLabel = getReasonLabel(
                        messageKey,
                        `privatePageReason_${(response.reason || '').replace('-', '')}`,
                        response.reason || 'unknown',
                    );
                    const confirm = this.deps.confirmDialog
                        ? this.deps.confirmDialog
                        : (await import('./privacyDialog.js')).showPrivacyConfirmDialog;
                    const userConfirmed = await (confirm as (a: string, b: string) => Promise<boolean>)(statusCode, reasonLabel);
                    if (userConfirmed) {
                        try {
                            await sender.sendMessageWithRetry({
                                type: 'VALID_VISIT',
                                payload: { content, force: true },
                            });
                        } catch (retryError: unknown) {
                            await logError('Failed to force save private page', { error: errorMessage(retryError) }, ErrorCode.INTERNAL_ERROR, 'visitReporter');
                        }
                    }
                    return;
                }
                await logError('Background worker error', { error: response.error }, ErrorCode.INTERNAL_ERROR, 'visitReporter');
            }
        } catch (error: unknown) {
            const msg = errorMessage(error);
            if (msg && (msg.includes('Extension context invalidated') || msg.includes('sendMessage'))) {
                this.deps.stopPeriodicCheck?.();
                await logInfo('Extension reloaded - page refresh needed', {}, 'visitReporter');
            } else {
                await logWarn('Failed to report valid visit', { error: msg }, ErrorCode.API_REQUEST_FAILURE, 'visitReporter');
            }
        }
    }
}
