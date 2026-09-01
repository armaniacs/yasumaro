/**
 * visitReporter.ts
 * Single VALID_VISIT sender — extracted from extractor.reportValidVisit (80 lines, 4 branches).
 * ContentKernel owns one instance; tests inject a fake sender and extractor.
 */

import type { PageState } from './pageState.js';
import type { ExtractResult } from '../utils/contentExtractor/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import { logInfo, logWarn, logError, logDebug, ErrorCode } from '../utils/logger.js';

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
    /** Injected clock for traceability, not required for send */
    stopPeriodicCheck?: () => void;
}

export class VisitReporter {
    constructor(private readonly deps: VisitReporterDeps) {}

    async report(): Promise<void> {
        const { pageState, extractor, applyResult, sender } = this.deps;
        pageState.isValidVisitReported = true;
        void logInfo('Sending VALID_VISIT', {}, 'visitReporter');
        console.info('[OWeave] VALID_VISIT 送信開始');

        const extractResult = extractor();
        applyResult(extractResult);
        const content = extractResult.content;

        try {
            const response = await sender.sendMessageWithRetry({
                type: 'VALID_VISIT',
                payload: {
                    content,
                    pageBytes: pageState.lastByteStats.pageBytes || undefined,
                    candidateBytes: pageState.lastByteStats.candidateBytes || undefined,
                    originalBytes: pageState.lastByteStats.originalBytes || undefined,
                    cleansedBytes: pageState.lastByteStats.cleansedBytes || undefined,
                    aiSummaryOriginalBytes: pageState.lastAiSummaryCleansedStats.aiSummaryOriginalBytes || undefined,
                    aiSummaryCleansedBytes: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedBytes || undefined,
                    aiSummaryCleansedElements: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedElements || undefined,
                    aiSummaryCleansedReason:
                        pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason !== 'none'
                            ? pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReason
                            : undefined,
                    aiSummaryCleansedReasons: pageState.lastAiSummaryCleansedStats.aiSummaryCleansedReasons,
                    fallbackTriggered: pageState.lastFallbackTriggered,
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
                    const reasonLabel =
                        (typeof chrome !== 'undefined' && chrome.i18n?.getMessage
                            ? chrome.i18n.getMessage(messageKey) ||
                              chrome.i18n.getMessage(`privatePageReason_${(response.reason || '').replace('-', '')}`) ||
                              response.reason ||
                              'unknown'
                            : response.reason || 'unknown');
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
