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
import { toGetContentReply } from './visitPayload.js';

export interface GetContentMessage {
    type: string;
}

export interface GetContentSender {
    id?: string;
}

export interface GetContentHandlerDeps {
    /**
     * PBI 2026-09-21-25: deep single call (preferred). When present the
     * handler delegates extract+commit atomically. The pair below remains
     * as a compatibility fallback (e.g. extractor.ts wiring, pair-based tests).
     */
    extractAndCommit?: (config?: CleansingConfig) => ExtractResult;
    extractPageContent?: (config?: CleansingConfig) => ExtractResult;
    applyExtractResultToPageState?: (result: ExtractResult) => void;
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
    // PBI 2026-09-21-25: prefer the deep call; the pair is a fallback.
    const extractResult =
        deps.extractAndCommit !== undefined
            ? deps.extractAndCommit()
            : deps.extractPageContent!();
    if (deps.extractAndCommit === undefined) {
        deps.applyExtractResultToPageState!(extractResult);
    }
    // PBI 2026-09-15-14: field selection shared with the VALID_VISIT payload
    // via the single visitPayload module — one builder, no per-path drift.
    sendResponse(toGetContentReply(deps.pageState, extractResult.content));
}
