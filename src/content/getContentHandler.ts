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
import {
    resolveRegenerateCleansingConfig,
    REGENERATE_CLEANSE_MODES,
    type RegenerateCleanseMode,
} from '../utils/aiSummaryCleaner/cleanseModeLadder.js';

export interface GetContentMessage {
    type: string;
    /** PBI 04: one-shot cleanse override carried by REGENERATE_SUMMARY's fetcher. */
    payload?: { cleanseMode?: RegenerateCleanseMode };
}

export interface GetContentSender {
    id?: string;
}

export interface GetContentHandlerDeps {
    /**
     * PBI 2026-09-21-30: the ONLY extraction route. The handler delegates
     * extract+commit atomically — the extract/apply pair fallback was
     * retired, so ordering knowledge lives in the kernel alone.
     */
    extractAndCommit: (config?: CleansingConfig) => ExtractResult;
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
    // PBI 2026-09-21-30: single route — no fallback branch.
    // PBI 04: cleanseMode resolves against the live pageState config
    // (utils ladder, one-shot, never persisted). 'current' → no override.
    const mode = msg.payload?.cleanseMode;
    const config =
        mode !== undefined &&
        mode !== 'current' &&
        (REGENERATE_CLEANSE_MODES as readonly string[]).includes(mode)
            ? resolveRegenerateCleansingConfig(deps.pageState.cleansingConfig, mode)
            : undefined;
    const extractResult = deps.extractAndCommit(config);
    // PBI 2026-09-15-14: field selection shared with the VALID_VISIT payload
    // via the single visitPayload module — one builder, no per-path drift.
    sendResponse(toGetContentReply(deps.pageState, extractResult.content));
}
