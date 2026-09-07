/**
 * getContentHandler.ts
 * GET_CONTENT message handler — extracted from the inline chrome-guard
 * closure in extractor.ts (PBI-14 GET_CONTENT testability).
 *
 * No chrome globals here: the sender check uses an injected runtimeId and
 * extraction/reporting arrive via deps, so unit tests call
 * handleGetContentMessage directly without chrome mocks or module re-imports.
 * The clock travels on the ContentKernel construction path (production
 * entrypoint injects () => Date.now(); tests bind fake-clock kernels whose
 * methods are passed as deps). This handler performs no time reads itself,
 * so deps intentionally carry no clock field.
 */

import type { ExtractResult } from '../utils/contentExtractor/types.js';
import type { CleansingConfig, PageState } from './pageState.js';
import { buildVisitStats } from './visitReporter.js';

export interface GetContentMessage {
    type: string;
}

export interface GetContentSender {
    id?: string;
}

export interface GetContentHandlerDeps {
    extractPageContent: (config?: CleansingConfig) => ExtractResult;
    applyExtractResultToPageState: (result: ExtractResult) => void;
    pageState: PageState;
    runtimeId: string | undefined;
}

export function handleGetContentMessage(
    message: unknown,
    sender: GetContentSender,
    sendResponse: (response?: unknown) => void,
    deps: GetContentHandlerDeps,
): void {
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    const msg = message as GetContentMessage;
    if (msg.type !== 'GET_CONTENT') return;
    if (sender.id !== deps.runtimeId) return;
    const extractResult = deps.extractPageContent();
    deps.applyExtractResultToPageState(extractResult);
    const content = extractResult.content;
    // Field selection shared with the VALID_VISIT payload (VisitReporter):
    // one builder, no per-path drift.
    const stats = buildVisitStats(deps.pageState);
    sendResponse({
        content,
        cleansedReason: deps.pageState.lastCleansedReason,
        cleanseStats: deps.pageState.lastCleanseStats,
        byteStats: stats.byteStats,
        aiSummaryCleansedStats: stats.aiStats,
        fallbackTriggered: stats.fallbackTriggered,
    });
}
