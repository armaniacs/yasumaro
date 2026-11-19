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
import { errorMessage } from '../utils/errorUtils.js';
import { logWarn } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
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
     * PBI 1116b: async — the candidate scan yields to the renderer.
     */
    extractAndCommit: (config?: CleansingConfig) => Promise<ExtractResult>;
    pageState: PageState;
    runtimeId: string | undefined;
}

/**
 * Synchronous gate for the chrome message listener: only when this returns
 * true does the listener take the message (and keep the port open for the
 * async reply). Keeps the type/sender guard in one place so the async
 * handler below never duplicates it.
 */
export function shouldHandleGetContentMessage(
    message: unknown,
    sender: GetContentSender,
    deps: GetContentHandlerDeps,
): boolean {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false;
    const msg = message as GetContentMessage;
    if (msg.type !== 'GET_CONTENT') return false;
    return sender.id === deps.runtimeId;
}

export async function handleGetContentMessage(
    message: unknown,
    sender: GetContentSender,
    sendResponse: (response?: unknown) => void,
    deps: GetContentHandlerDeps,
): Promise<void> {
    if (!shouldHandleGetContentMessage(message, sender, deps)) return;
    const msg = message as GetContentMessage;
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
    const extractResult = await tryExtractAndCommit(deps, config);
    if (extractResult.ok) {
        // PBI 2026-09-15-14: field selection shared with the VALID_VISIT payload
        // via the single visitPayload module — one builder, no per-path drift.
        sendResponse(toGetContentReply(deps.pageState, extractResult.content));
        return;
    }
    // PBI 2026-11-08-05: extraction threw — still answer so the popup never
    // hangs. The fallback channel (popup/regenerate already understand it)
    // carries the failure signal with empty content.
    // Review S1: the wire code is a fixed code only ('extract-failed') — the
    // raw error text never leaves the content script and lives in the log
    // side, so popup/regenerate can branch on a stable value and no error
    // internals (paths, selectors, DOM excerpts) leak over the message port.
    try {
        void logWarn(
            'GET_CONTENT extract failed',
            { error: extractResult.error },
            ErrorCode.INTERNAL_ERROR,
            'getContentHandler',
        ).catch(() => {
            // Logging must never cost the caller its answer.
        });
        sendResponse({
            ...toGetContentReply(deps.pageState, ''),
            fallbackTriggered: true,
            fallbackReason: 'extract-failed',
        });
    } catch {
        // The reply builder itself must never cost the caller its answer.
        sendResponse({ content: '' });
    }
}

/**
 * PBI 2026-11-08-05: extract+commit never throws to the caller — a failure
 * becomes a value so handleGetContentMessage always reaches sendResponse.
 */
async function tryExtractAndCommit(
    deps: GetContentHandlerDeps,
    config: CleansingConfig | undefined,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
    try {
        return { ok: true, content: (await deps.extractAndCommit(config)).content };
    } catch (e: unknown) {
        return { ok: false, error: errorMessage(e) };
    }
}
