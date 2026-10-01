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
 * - runCleanseAndExtract: single owner of the clone → cleanse → pre-AI bytes
 *   → AI step → extract → fallback orchestration, shared by the candidate
 *   path and the body path.
 * - applyFallback: THE single copy of the fallback policy previously
 *   duplicated in two blocks (candidate path vs body path): short content or
 *   over-cleansed content falls back to the pre-AI text or the body text.
 */

import { cleanseContent, type CleanseResult } from '../contentCleaner.js';
import { cleanseAISummaryContent, type AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { deriveCleansedReason, removedRecordToMap } from './cleansedReason.js';
import { extractTextFromElement } from './textExtraction.js';
import type { ExtractionReportBuilder } from './extractionReport.js';
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
    /**
     * PBI 05 ② pair — supplied ONLY when Content Cleansing ran on a
     * candidate source (the caller gates on cleanseGuardEnabled too).
     * Chars, never bytes: the hot path must not encode (Ask Q3B).
     */
    preCleanseText?: string | undefined;
    preCleanseChars?: number | undefined;
    postCleanseChars?: number | undefined;
    /** Measured pre-② size — reused for diagnostics when ② restores. */
    preCleanseBytes?: number | undefined;
    /** Absolute floor in CHARS for the ② arm (Ask Q3B; default 100 mirrors isTooShort). */
    fallbackMinChars?: number | undefined;
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
 * Winner priority (PBI 05): ② content_overcut > ③ over_cleansed > 短文 body.
 * Each arm only fires when its inputs are present, so omitting the new ②
 * fields reproduces the legacy decision exactly (byte-identical pins).
 *
 * ② arm notes:
 * - Gated by the caller to candidate sources only — a body-source restore
 *   would ship raw `document.body.textContent` (script pollution), and the
 *   live-body safety net already exists via the short_content arm.
 * - The restore must itself reach the floor (`preCleanseChars >= minChars`),
 *   otherwise restoring helps nothing and the body fallback is strictly better.
 * - `usePreAiText: false` on the ② winner deliberately discards BOTH the ②
 *   and ③ diagnostics (settleFallback's reset branch) — the restore undoes
 *   everything after the pre-② text (binding: ② winner invalidates the ③ pair).
 */
export function applyFallback(input: FallbackInput): FallbackDecision {
    const isTooShort = input.content.trim().length < 100;
    const overCleansed = input.aiSummaryOriginalBytes !== undefined
        && input.aiSummaryOriginalBytes > 0
        && (
            (input.contentBytes / input.aiSummaryOriginalBytes) < input.fallbackRatio
            || input.contentBytes < input.fallbackMinBytes
        );

    const minChars = input.fallbackMinChars ?? 100;
    const preChars = input.preCleanseChars;
    const postChars = input.postCleanseChars;
    const overcut = input.preCleanseText !== undefined
        && input.preCleanseText.length > 0
        && preChars !== undefined
        && postChars !== undefined
        && preChars >= minChars
        && (
            postChars / preChars < input.fallbackRatio
            || postChars < minChars
        );

    if (!isTooShort && !overCleansed && !overcut) {
        return { content: input.content, fallbackTriggered: false, usePreAiText: false };
    }
    if (overcut) {
        // `overcut` implies preCleanseText is a non-empty string (checked above).
        const restore = input.preCleanseText!;
        return {
            content: restore,
            fallbackTriggered: true,
            fallbackReason: 'content_overcut',
            usePreAiText: false,
            fallbackBytes: input.preCleanseBytes,
        };
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

/**
 * Source descriptor for runCleanseAndExtract. The difference between the
 * candidate route and the body route folds into this input: the caller picks
 * the source element (top candidate / document.body) and the preBytes origin
 * (candidateBytes / pageBytes).
 */
export interface CleanseAndExtractSource {
    sourceElement: Element;
    preCleanseText: string;
    preBytes: number;
    cleanse: boolean;
    /** Candidate-source only — gates the ② restore (a body-source restore would ship raw textContent). */
    candidateSource?: boolean;
}

/**
 * Input to runCleanseAndExtract. The builder owns the diagnostic policy;
 * the caller passes its already-resolved cleanse/AI values through unchanged.
 */
export interface RunCleanseAndExtractInput {
    source: CleanseAndExtractSource;
    builder: ExtractionReportBuilder;
    meter: ByteMeter;
    hardStripEnabled: boolean;
    keywordStripEnabled: boolean;
    keywords: string[];
    aiSummaryCleanseEnabled: boolean;
    fallbackRatio: number;
    fallbackMinBytes: number;
    fallbackMinChars: number;
    cleanseGuardEnabled: boolean;
    resolvedAiSummaryOptions: AiSummaryCleanseOptions;
    readBodyText: () => string;
}

/**
 * Single owner of the clone → cleanse → pre-AI bytes → AI step → extract →
 * fallback orchestration, shared by the candidate path and the body path.
 * The body-plain policy (innerText, no fallback/AI) is inherently different
 * and stays inlined at the call site.
 *
 * Hidden constraint: the meter call order is part of the c1 bench baseline —
 * diagnostic reuse first, conditional measure only; do not reorder.
 * Returns the settled content: the extracted text, or the fallback decision's
 * content when a fallback won (builder.settleFallback already ran).
 */
export function runCleanseAndExtract(input: RunCleanseAndExtractInput): string {
    const {
        source,
        builder,
        meter,
        hardStripEnabled,
        keywordStripEnabled,
        keywords,
        aiSummaryCleanseEnabled,
        fallbackRatio,
        fallbackMinBytes,
        fallbackMinChars,
        cleanseGuardEnabled,
        resolvedAiSummaryOptions,
        readBodyText,
    } = input;
    let content = '';

    // Dual payload — retain the source text before any cleansing mutation.
    builder.retainSourceOriginal(source.sourceElement.textContent || '');

    let targetElement: Element;

    if (source.cleanse) {
        // Clone keeps the live DOM untouched.
        const clone = source.sourceElement.cloneNode(true) as Element;

        // preCleanseText is the same string as preBytes — reuse, no re-encode.
        builder.noteCleanseStart(source.preBytes);

        const cleanseResult: CleanseResult = cleanseContent(clone, {
            hardStripEnabled,
            keywordStripEnabled,
            keywords
        });

        // AI-fallback ratio input. Nothing removed + identical string → reuse
        // instead of re-encoding; diagnostics reuse cleansedBytes as-is.
        const cloneText = clone.textContent || '';
        builder.notePostCleanseChars(cloneText.length);
        const resolvedPreAi = resolvePreAiBytes(meter, cloneText, { text: source.preCleanseText, bytes: builder.originalBytes }, aiSummaryCleanseEnabled);
        builder.noteCleansedBytes(resolvedPreAi.cleansedBytes);
        const preAiBytes = resolvedPreAi.preAiBytes;

        builder.noteCleanseOutcome(
            cleanseResult,
            {
                keywords: keywords.join(', '),
                mode: hardStripEnabled ? (keywordStripEnabled ? 'both' : 'hard') : 'keyword',
            },
            { aiSummaryCleanseEnabled, aiSummaryOptions: resolvedAiSummaryOptions },
        );

        targetElement = clone;

        // AI-summary cleansing runs independently of cleanseEnabled.
        if (aiSummaryCleanseEnabled) {
            const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytes);
            builder.noteAiApplied(applied);
        }
    } else {
        targetElement = source.sourceElement;
        // A disabled meter keeps no diagnostic values; one encode for the AI fallback.
        let preAiBytesElse = 0;
        if (meter.enabled) {
            builder.noteUncleansedBytes(source.preBytes);
            preAiBytesElse = builder.cleansedBytes;
        } else if (aiSummaryCleanseEnabled) {
            preAiBytesElse = getByteSize(targetElement.textContent || '');
        }

        // AI-only path (cleanseEnabled=false, aiSummaryCleanseEnabled=true)
        // still clones so the AI step never mutates live DOM.
        if (aiSummaryCleanseEnabled) {
            const clone = source.sourceElement.cloneNode(true) as Element;

            const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytesElse);
            builder.noteAiApplied(applied);

            targetElement = clone;
        }
    }

    content = extractTextFromElement(targetElement);

    // The ② pair is supplied only when Content Cleansing ran on a candidate
    // source AND the ② guard flag is on — omitted otherwise, which reproduces
    // the legacy decision byte-for-byte.
    const supplyCleansePair = cleanseGuardEnabled
        && source.candidateSource === true
        && builder.postCleanseChars !== undefined;
    const fallbackDecision = applyFallback({
        content,
        contentBytes: getByteSize(content),
        preAiCleanseText: builder.preAiCleanseText,
        aiSummaryOriginalBytes: builder.aiSummaryOriginalBytes,
        fallbackRatio,
        fallbackMinBytes,
        readBodyText,
        ...(supplyCleansePair
            ? {
                preCleanseText: source.preCleanseText,
                preCleanseChars: source.preCleanseText.length,
                postCleanseChars: builder.postCleanseChars,
                preCleanseBytes: source.preBytes,
                fallbackMinChars,
            }
            : {}),
    });
    if (fallbackDecision.fallbackTriggered) {
        builder.settleFallback(fallbackDecision);
        return fallbackDecision.content;
    }
    return content;
}
