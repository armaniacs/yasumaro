/**
 * extractPipeline.ts
 * Shared extraction pipeline for contentExtractor (PBI 12).
 *
 * Unifies the three extraction paths (cleanse+AI / AI-only / body fallback)
 * behind one fallback policy and one byte-measurement seam.
 *
 * - ByteMeter: diagnostic-only byte measurement. Disabled on the hot string
 *   path (no TextEncoder work); enabled when the caller requested full
 *   diagnostics via extractMainContentWithInfo.
 * - runAiSummaryCleanse / applyAiCleanseStep: single copy of the AI-cleanse
 *   invocation previously repeated at three call sites.
 * - resolvePreAiBytes: single copy of the pre-AI byte computation previously
 *   repeated at three sites (same-string reuse on the diagnostic path,
 *   fallback-critical single encode otherwise).
 * - applyFallback: THE single copy of the fallback policy previously
 *   duplicated in two blocks (candidate path vs body path): short content or
 *   over-cleansed content falls back to the pre-AI text or the body text.
 */

import { cleanseAISummaryContent, type AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { deriveCleansedReason, removedRecordToMap } from './cleansedReason.js';
import type { AiSummaryCleanseRunResult, ExtractResult, FallbackReason } from './types.js';

/**
 * Shared encoder for UTF-8 byte measurement. TextEncoder.encode allocates a
 * fresh Uint8Array per call, so reusing one instance avoids repeated setup.
 */
const ENCODER = new TextEncoder();

/**
 * UTF-8 byte length of a string (no Blob allocation).
 */
export function getByteSize(str: string): number {
    return ENCODER.encode(str).length;
}

/**
 * Diagnostic-only byte measurement seam.
 * Disabled meters must not encode: measure() returns 0 without touching
 * TextEncoder, so the hot string path performs only fallback-critical encodes.
 */
export interface ByteMeter {
    readonly enabled: boolean;
    measure(text: string): number;
}

/**
 * Build a ByteMeter. Pass true only when the caller consumes diagnostics
 * (extractMainContentWithInfo); the plain string path passes false.
 */
export function makeByteMeter(enabled: boolean): ByteMeter {
    return {
        enabled,
        measure: (text: string): number => (enabled ? getByteSize(text) : 0),
    };
}

/**
 * Run the AI-summary cleanse on an orchestrator-owned scratch clone and
 * aggregate the outcome. The clone is mutated in place; preCleanseText is
 * captured first, before any mutation.
 *
 * @param clone - scratch copy owned by the orchestrator (never live DOM)
 * @param options - AI-summary cleanse options (measureBytes gates post-cleanse encode)
 * @param originalBytes - pre-cleanse byte size (fallback-critical, always measured by caller)
 */
export function runAiSummaryCleanse(
    clone: Element,
    options: AiSummaryCleanseOptions,
    originalBytes: number
): AiSummaryCleanseRunResult {
    const preCleanseText = clone.textContent || '';
    const aiSummaryCleanseResult = cleanseAISummaryContent(clone, options);
    // Fallback ratio uses originalBytes; the post-cleanse size is diagnostic
    // only, so skip the encode unless the caller opted into measurement.
    // Attribute-only removals leave textContent unchanged — reuse the
    // pre-cleanse size instead of encoding the identical string twice.
    const postCleanseText = clone.textContent || '';
    const cleansedBytes = !options.measureBytes
        ? 0
        : postCleanseText === preCleanseText
            ? originalBytes
            : getByteSize(postCleanseText);

    // Reasons come from the rule table via the removal map, so every rule that
    // ran can become a reason.
    const { reason, reasons } = deriveCleansedReason(aiSummaryCleanseResult);
    const elements = aiSummaryCleanseResult.totalRemoved > 0 ? aiSummaryCleanseResult.totalRemoved : 0;

    return { originalBytes, cleansedBytes, reason, reasons, elements, preCleanseText, removed: aiSummaryCleanseResult.removed };
}

/**
 * Aggregated AI-cleanse outcome in orchestrator field shape. Lets the three
 * extraction paths share one assignment block instead of repeating the same
 * eight field copies.
 */
export interface AiCleanseApplied {
    aiSummaryOriginalBytes: number;
    aiSummaryCleansedBytes: number;
    aiSummaryCleansedReason: ExtractResult['aiSummaryCleansedReason'];
    aiSummaryCleansedReasons: string[] | undefined;
    aiSummaryCleansedElements: number;
    preAiCleanseText: string;
    removedByReason: Map<string, number> | undefined;
}

/**
 * Single shared AI-cleanse invocation for all three extraction paths.
 */
export function applyAiCleanseStep(
    clone: Element,
    options: AiSummaryCleanseOptions,
    preAiBytes: number
): AiCleanseApplied {
    const run = runAiSummaryCleanse(clone, options, preAiBytes);
    return {
        aiSummaryOriginalBytes: run.originalBytes,
        aiSummaryCleansedBytes: run.cleansedBytes,
        aiSummaryCleansedReason: run.reason,
        aiSummaryCleansedReasons: run.reasons.length > 0 ? run.reasons : undefined,
        aiSummaryCleansedElements: run.elements,
        preAiCleanseText: run.preCleanseText,
        removedByReason: removedRecordToMap(run.removed),
    };
}

/**
 * Single shared pre-AI byte computation for all three extraction paths.
 *
 * Diagnostic path (meter enabled): reuses the already-measured size when the
 * post-cleanse string is identical, avoiding a duplicate encode.
 * Hot path (meter disabled): exactly one fallback-critical encode, and only
 * when AI cleanse is enabled (the value feeds the over-cleansed ratio).
 */
export function resolvePreAiBytes(
    meter: ByteMeter,
    text: string,
    known: { text: string; bytes: number },
    aiEnabled: boolean
): { cleansedBytes: number; preAiBytes: number } {
    if (meter.enabled) {
        const cleansedBytes = text === known.text ? known.bytes : meter.measure(text);
        return { cleansedBytes, preAiBytes: cleansedBytes };
    }
    return { cleansedBytes: 0, preAiBytes: aiEnabled ? getByteSize(text) : 0 };
}

/**
 * Input to the unified fallback policy. contentBytes is always measured by
 * the caller (fallback-critical); aiSummaryOriginalBytes is defined only when
 * the AI cleanse ran.
 */
export interface FallbackInput {
    content: string;
    contentBytes: number;
    preAiCleanseText?: string | undefined;
    aiSummaryOriginalBytes?: number | undefined;
    fallbackRatio: number;
    fallbackMinBytes: number;
    /** Reads the live body text lazily — invoked only when body fallback wins. */
    readBodyText: () => string;
}

/**
 * Outcome of the unified fallback policy. When fallbackTriggered is true the
 * caller replaces its content, resets the cleanse counters, and (on the
 * short-content path) discards the AI-cleanse diagnostics.
 */
export interface FallbackDecision {
    content: string;
    fallbackTriggered: boolean;
    fallbackReason?: FallbackReason | undefined;
    /** True when falling back to the pre-AI text (keeps AI diagnostics). */
    usePreAiText: boolean;
    /** Reuses the already-measured pre-AI size; undefined for body fallback. */
    fallbackBytes?: number | undefined;
}

/**
 * THE single copy of the fallback policy shared by all extraction paths.
 * Short content (<100 non-blank chars) or over-cleansed content (below the
 * fallback ratio or absolute floor) falls back to the pre-AI text when
 * available, else to the live body text.
 */
export function applyFallback(input: FallbackInput): FallbackDecision {
    const isTooShort = input.content.trim().length < 100;
    const overCleansed = input.aiSummaryOriginalBytes !== undefined
        && input.aiSummaryOriginalBytes > 0
        && (
            (input.contentBytes / input.aiSummaryOriginalBytes) < input.fallbackRatio
            || input.contentBytes < input.fallbackMinBytes
        );

    if (!isTooShort && !overCleansed) {
        return { content: input.content, fallbackTriggered: false, usePreAiText: false };
    }
    if (overCleansed && input.preAiCleanseText) {
        return {
            content: input.preAiCleanseText,
            fallbackTriggered: true,
            fallbackReason: 'over_cleansed',
            usePreAiText: true,
            fallbackBytes: input.aiSummaryOriginalBytes,
        };
    }
    return {
        content: input.readBodyText(),
        fallbackTriggered: true,
        fallbackReason: 'short_content',
        usePreAiText: false,
    };
}
