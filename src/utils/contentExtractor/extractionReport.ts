/**
 * extractionReport.ts
 * Opaque extraction diagnostics behind a narrow seam.
 *
 * WHY: ExtractResult carried ~18 mostly-optional fields that every consumer
 * had to know (kernel hand-copy, sqlite column mirror, whitelist bypass).
 * A byte-column rename therefore touched extractor + kernel + schema +
 * mappers + tests. The report hides ByteMeter, the maxChars*2 dual-payload
 * retention, the byte funnel, and the diagnostic recount here; consumers
 * cross only bytesFunnel() / cleanseCounts() / fallbackCause() /
 * originalText() (+ adapterUsed for the whitelist path), so a rename lands
 * in this module plus the single storage mapper.
 */

import { countCleanseTargets } from '../contentCleaner.js';
import { countAISummaryTargets, type AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import type { AiSummaryCleansedReason } from '../commonTypes.js';
import { logSanitize, logDebug } from '../logger/api.js';
import { deriveCleansedReason, removedRecordToMap, resolveCleanseReason } from './cleansedReason.js';
import { makeByteMeter, type AiCleanseApplied, type ByteMeter, type FallbackDecision } from './extractPipeline.js';
import type { ExtractResult, FallbackReason } from './types.js';

/** Three-stage byte funnel: full-body → candidate → post-cleanse sizes. */
export interface ByteFunnel {
    pageBytes: number;
    candidateBytes: number;
    cleansedBytes: number;
}

/** Content-cleanse + AI-summary removal counts in one struct. */
export interface CleanseCounts {
    cleansedReason: 'hard' | 'keyword' | 'both' | 'none';
    hardStripRemoved: number;
    keywordStripRemoved: number;
    totalRemoved: number;
    cleansingExecuted: boolean;
    aiSummaryOriginalBytes: number;
    aiSummaryCleansedBytes: number;
    aiSummaryCleansedElements: number;
    aiSummaryCleansedReason: AiSummaryCleansedReason;
    aiSummaryCleansedReasons?: string[];
    removedByReason?: Map<string, number>;
}

/** Fallback settlement: whether it fired and why. */
export interface FallbackCause {
    triggered: boolean;
    reason?: FallbackReason;
}

/**
 * Structural target for report commits. Mirrors the PageState diagnostic
 * blocks without importing the content layer (utils -> content edges stay
 * type-only and structural, never a runtime import).
 */
export interface ExtractionReportTarget {
    lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none';
    lastCleanseStats: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number };
    lastByteStats: { pageBytes: number; candidateBytes: number; originalBytes: number; cleansedBytes: number };
    lastAiSummaryCleansedStats: {
        aiSummaryOriginalBytes: number;
        aiSummaryCleansedBytes: number;
        aiSummaryCleansedElements: number;
        aiSummaryCleansedReason: AiSummaryCleansedReason;
        aiSummaryCleansedReasons?: string[];
    };
    lastFallbackTriggered: boolean;
    lastFallbackReason: string | undefined;
}

/**
 * Opaque diagnostics snapshot. All fields are ECMAScript-private so a
 * column rename cannot leak through property access — only the four seam
 * methods (+ adapterUsed + applyTo/toLegacyResult) cross the boundary.
 */
export class ExtractionReport {
    readonly #adapterUsed: string | undefined;
    readonly #whitelisted: boolean;
    readonly #cleansedReason: 'hard' | 'keyword' | 'both' | 'none';
    readonly #hardStripRemoved: number;
    readonly #keywordStripRemoved: number;
    readonly #totalRemoved: number;
    readonly #cleansingExecuted: boolean;
    readonly #pageBytes: number;
    readonly #candidateBytes: number;
    readonly #originalBytes: number;
    readonly #cleansedBytes: number;
    readonly #aiSummaryOriginalBytes: number | undefined;
    readonly #aiSummaryCleansedBytes: number | undefined;
    readonly #aiSummaryCleansedElements: number | undefined;
    readonly #aiSummaryCleansedReason: AiSummaryCleansedReason;
    readonly #aiSummaryCleansedReasons: string[] | undefined;
    readonly #fallbackTriggered: boolean;
    readonly #fallbackReason: FallbackReason | undefined;
    readonly #removedByReason: Map<string, number> | undefined;
    readonly #funnel: ByteFunnel | undefined;
    readonly #originalContent: string | undefined;
    readonly #dualPayloadEnabled: boolean;

    constructor(init: {
        adapterUsed: string | undefined;
        whitelisted: boolean;
        cleansedReason: 'hard' | 'keyword' | 'both' | 'none';
        hardStripRemoved: number;
        keywordStripRemoved: number;
        totalRemoved: number;
        cleansingExecuted: boolean;
        pageBytes: number;
        candidateBytes: number;
        originalBytes: number;
        cleansedBytes: number;
        aiSummaryOriginalBytes: number | undefined;
        aiSummaryCleansedBytes: number | undefined;
        aiSummaryCleansedElements: number | undefined;
        aiSummaryCleansedReason: AiSummaryCleansedReason;
        aiSummaryCleansedReasons: string[] | undefined;
        fallbackTriggered: boolean;
        fallbackReason: FallbackReason | undefined;
        removedByReason: Map<string, number> | undefined;
        funnel: ByteFunnel | undefined;
        originalContent: string | undefined;
        dualPayloadEnabled: boolean;
    }) {
        this.#adapterUsed = init.adapterUsed;
        this.#whitelisted = init.whitelisted;
        this.#cleansedReason = init.cleansedReason;
        this.#hardStripRemoved = init.hardStripRemoved;
        this.#keywordStripRemoved = init.keywordStripRemoved;
        this.#totalRemoved = init.totalRemoved;
        this.#cleansingExecuted = init.cleansingExecuted;
        this.#pageBytes = init.pageBytes;
        this.#candidateBytes = init.candidateBytes;
        this.#originalBytes = init.originalBytes;
        this.#cleansedBytes = init.cleansedBytes;
        this.#aiSummaryOriginalBytes = init.aiSummaryOriginalBytes;
        this.#aiSummaryCleansedBytes = init.aiSummaryCleansedBytes;
        this.#aiSummaryCleansedElements = init.aiSummaryCleansedElements;
        this.#aiSummaryCleansedReason = init.aiSummaryCleansedReason;
        this.#aiSummaryCleansedReasons = init.aiSummaryCleansedReasons;
        this.#fallbackTriggered = init.fallbackTriggered;
        this.#fallbackReason = init.fallbackReason;
        this.#removedByReason = init.removedByReason;
        this.#funnel = init.funnel;
        this.#originalContent = init.originalContent;
        this.#dualPayloadEnabled = init.dualPayloadEnabled;
    }

    /** Whitelist adapter that produced this extraction, if any. */
    get adapterUsed(): string | undefined {
        return this.#adapterUsed;
    }

    /** Narrow seam: three-stage byte funnel (all zeros on the whitelist path). */
    bytesFunnel(): ByteFunnel {
        if (this.#funnel) return { ...this.#funnel };
        return { pageBytes: this.#pageBytes, candidateBytes: this.#candidateBytes, cleansedBytes: this.#cleansedBytes };
    }

    /** Narrow seam: content-cleanse + AI-summary removal counts. */
    cleanseCounts(): CleanseCounts {
        const counts: CleanseCounts = {
            cleansedReason: this.#cleansedReason,
            hardStripRemoved: this.#hardStripRemoved,
            keywordStripRemoved: this.#keywordStripRemoved,
            totalRemoved: this.#totalRemoved,
            cleansingExecuted: this.#cleansingExecuted,
            aiSummaryOriginalBytes: this.#aiSummaryOriginalBytes ?? 0,
            aiSummaryCleansedBytes: this.#aiSummaryCleansedBytes ?? 0,
            aiSummaryCleansedElements: this.#aiSummaryCleansedElements ?? 0,
            aiSummaryCleansedReason: this.#aiSummaryCleansedReason,
        };
        if (this.#aiSummaryCleansedReasons !== undefined) counts.aiSummaryCleansedReasons = this.#aiSummaryCleansedReasons;
        if (this.#removedByReason !== undefined) counts.removedByReason = this.#removedByReason;
        return counts;
    }

    /** Narrow seam: whether fallback fired and why. */
    fallbackCause(): FallbackCause {
        const cause: FallbackCause = { triggered: this.#fallbackTriggered };
        if (this.#fallbackReason !== undefined) cause.reason = this.#fallbackReason;
        return cause;
    }

    /** Narrow seam: pre-cleanse original text (dual payload), if retained. */
    originalText(): string | undefined {
        return this.#originalContent;
    }

    /**
     * Single commit of every diagnostic block into page state. Replaces the
     * kernel's hand-copy; field selection lives here once.
     */
    applyTo(target: ExtractionReportTarget): void {
        target.lastCleansedReason = this.#whitelisted ? 'none' : this.#cleansedReason;
        target.lastCleanseStats = this.#whitelisted
            ? { hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 }
            : {
                hardStripRemoved: this.#hardStripRemoved,
                keywordStripRemoved: this.#keywordStripRemoved,
                totalRemoved: this.#totalRemoved,
            };
        target.lastByteStats = {
            pageBytes: this.#pageBytes,
            candidateBytes: this.#candidateBytes,
            originalBytes: this.#originalBytes,
            cleansedBytes: this.#cleansedBytes,
        };
        target.lastAiSummaryCleansedStats = {
            aiSummaryOriginalBytes: this.#aiSummaryOriginalBytes ?? 0,
            aiSummaryCleansedBytes: this.#aiSummaryCleansedBytes ?? 0,
            aiSummaryCleansedElements: this.#aiSummaryCleansedElements ?? 0,
            aiSummaryCleansedReason: this.#aiSummaryCleansedReason,
        };
        if (this.#aiSummaryCleansedReasons !== undefined) {
            target.lastAiSummaryCleansedStats.aiSummaryCleansedReasons = this.#aiSummaryCleansedReasons;
        }
        target.lastFallbackTriggered = this.#fallbackTriggered;
        target.lastFallbackReason = this.#fallbackReason;
    }

    /**
     * Legacy expansion for the compat entries (extractMainContentWithInfo,
     * preparePageContent, kernel badge check). New code uses the seam above.
     * Shape parity: the whitelist path yields only adapterUsed, exactly as
     * the legacy early-return did.
     */
    toLegacyResult(content: string): ExtractResult {
        if (this.#whitelisted) {
            const out: ExtractResult = { content };
            if (this.#adapterUsed !== undefined) out.whitelistAdapterUsed = this.#adapterUsed;
            return out;
        }
        const out: ExtractResult = {
            content,
            cleansedReason: this.#cleansedReason,
            hardStripRemoved: this.#hardStripRemoved,
            keywordStripRemoved: this.#keywordStripRemoved,
            totalRemoved: this.#totalRemoved,
            pageBytes: this.#pageBytes,
            candidateBytes: this.#candidateBytes,
            originalBytes: this.#originalBytes,
            cleansedBytes: this.#cleansedBytes,
            aiSummaryCleansedReason: this.#aiSummaryCleansedReason,
            fallbackTriggered: this.#fallbackTriggered,
        };
        if (this.#aiSummaryOriginalBytes !== undefined) out.aiSummaryOriginalBytes = this.#aiSummaryOriginalBytes;
        if (this.#aiSummaryCleansedBytes !== undefined) out.aiSummaryCleansedBytes = this.#aiSummaryCleansedBytes;
        if (this.#aiSummaryCleansedElements !== undefined) out.aiSummaryCleansedElements = this.#aiSummaryCleansedElements;
        if (this.#aiSummaryCleansedReasons !== undefined) out.aiSummaryCleansedReasons = this.#aiSummaryCleansedReasons;
        if (this.#fallbackReason !== undefined) out.fallbackReason = this.#fallbackReason;
        if (this.#removedByReason !== undefined) out.removedByReason = this.#removedByReason;
        if (this.#funnel !== undefined) out.funnel = this.#funnel;
        if (this.#originalContent !== undefined) out.originalContent = this.#originalContent;
        if (this.#dualPayloadEnabled) out.dualPayloadEnabled = true;
        if (this.#cleansingExecuted) out.cleansingExecuted = true;
        return out;
    }

    /**
     * Legacy intake for the kernel compat shim. Defaults mirror the legacy
     * apply's `?? 0 / ?? false / || 'none'` normalization.
     */
    static fromLegacy(result: ExtractResult): ExtractionReport {
        const whitelisted = result.whitelistAdapterUsed !== undefined
            && result.pageBytes === undefined
            && result.candidateBytes === undefined;
        return new ExtractionReport({
            adapterUsed: result.whitelistAdapterUsed,
            whitelisted,
            cleansedReason: result.cleansedReason ?? 'none',
            hardStripRemoved: result.hardStripRemoved ?? 0,
            keywordStripRemoved: result.keywordStripRemoved ?? 0,
            totalRemoved: result.totalRemoved ?? 0,
            cleansingExecuted: result.cleansingExecuted === true,
            pageBytes: result.pageBytes ?? 0,
            candidateBytes: result.candidateBytes ?? 0,
            originalBytes: result.originalBytes ?? 0,
            cleansedBytes: result.cleansedBytes ?? 0,
            aiSummaryOriginalBytes: result.aiSummaryOriginalBytes,
            aiSummaryCleansedBytes: result.aiSummaryCleansedBytes,
            aiSummaryCleansedElements: result.aiSummaryCleansedElements,
            aiSummaryCleansedReason: result.aiSummaryCleansedReason ?? 'none',
            aiSummaryCleansedReasons: result.aiSummaryCleansedReasons,
            fallbackTriggered: result.fallbackTriggered ?? false,
            fallbackReason: result.fallbackReason,
            removedByReason: result.removedByReason,
            funnel: result.funnel,
            originalContent: result.originalContent,
            dualPayloadEnabled: result.dualPayloadEnabled === true,
        });
    }
}

/** Options for the mutable accumulator the orchestrator threads instead of ~15 locals. */
export interface ReportBuilderOptions {
    /** False on the hot string path: measure() encodes nothing, recount is skipped. */
    diagnostics: boolean;
    maxChars: number;
}

/** Options the diagnostic recount needs (count-only scan, never mutates). */
export interface RecountOptions {
    hardStripEnabled: boolean;
    keywordStripEnabled: boolean;
    keywords: string[];
    aiSummaryCleanseEnabled: boolean;
    aiSummaryOptions: AiSummaryCleanseOptions;
}

/**
 * Mutable accumulator owning ByteMeter, dual-payload retention, funnel
 * assembly, fallback settlement, and the diagnostic recount. The
 * orchestrator keeps control flow; every diagnostic policy lives here.
 */
export class ExtractionReportBuilder {
    readonly meter: ByteMeter;
    readonly #diagnostics: boolean;
    readonly #maxChars: number;
    #adapterUsed: string | undefined = undefined;
    #whitelisted = false;
    #cleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
    #hardStripRemoved = 0;
    #keywordStripRemoved = 0;
    #totalRemoved = 0;
    #pageBytes = 0;
    #candidateBytes = 0;
    #originalBytes = 0;
    #cleansedBytes = 0;
    #aiSummaryOriginalBytes: number | undefined = undefined;
    #aiSummaryCleansedBytes: number | undefined = undefined;
    #aiSummaryCleansedElements: number | undefined = undefined;
    #aiSummaryCleansedReason: AiSummaryCleansedReason = 'none';
    #aiSummaryCleansedReasons: string[] | undefined = undefined;
    #fallbackTriggered = false;
    #fallbackReason: FallbackReason | undefined = undefined;
    #removedByReason: Map<string, number> | undefined = undefined;
    #originalContent: string | undefined = undefined;
    #dualPayloadEnabled = false;
    #cleansingExecuted = false;
    #preAiCleanseText: string | undefined = undefined;
    #postCleanseChars: number | undefined = undefined;
    #candidateFloorMissed = false;

    constructor(options: ReportBuilderOptions) {
        this.#diagnostics = options.diagnostics;
        this.#maxChars = options.maxChars;
        this.meter = makeByteMeter(options.diagnostics);
    }

    get pageBytes(): number {
        return this.#pageBytes;
    }

    get candidateBytes(): number {
        return this.#candidateBytes;
    }

    get hasOriginalText(): boolean {
        return this.#originalContent !== undefined;
    }

    get originalBytes(): number {
        return this.#originalBytes;
    }

    get cleansedBytes(): number {
        return this.#cleansedBytes;
    }

    get preAiCleanseText(): string | undefined {
        return this.#preAiCleanseText;
    }

    get aiSummaryOriginalBytes(): number | undefined {
        return this.#aiSummaryOriginalBytes;
    }

    get fallbackTriggered(): boolean {
        return this.#fallbackTriggered;
    }

    /** Whitelist early-return: adapter identity only, zero byte-funnel. */
    noteWhitelistAdapter(name: string): void {
        this.#adapterUsed = name;
        this.#whitelisted = true;
    }

    notePageBytes(bytes: number): void {
        this.#pageBytes = bytes;
    }

    noteCandidateBytes(bytes: number): void {
        this.#candidateBytes = bytes;
    }

    noteCandidateFloorMissed(missed: boolean): void {
        this.#candidateFloorMissed = missed;
    }

    /**
     * Dual-payload retention from the extraction source (both paths share
     * the candidate-first order; the AI step clones, so source text is
     * identical before and after). Caps at maxChars*2.
     */
    retainSourceOriginal(text: string): void {
        if (this.#originalContent) return;
        const raw = text.trim();
        if (raw) {
            this.#originalContent = raw.slice(0, this.#maxChars * 2);
            this.#dualPayloadEnabled = true;
        }
    }

    /** Body fallback fill when no source retention happened. */
    ensureBodyOriginal(text: string): void {
        if (this.#originalContent) return;
        const raw = text.trim();
        if (raw) {
            this.#originalContent = raw.slice(0, this.#maxChars * 2);
            if (!this.#dualPayloadEnabled) this.#dualPayloadEnabled = true;
        }
    }

    /** Pre-cleanse size note on the cleanse path (diagnostic reuse, no re-encode). */
    noteCleanseStart(preBytes: number): void {
        if (this.meter.enabled) {
            this.#originalBytes = preBytes;
        }
    }

    noteCleansedBytes(bytes: number): void {
        if (this.meter.enabled) {
            this.#cleansedBytes = bytes;
        }
    }

    /** Pre-cleanse size note on the no-cleanse path (diagnostic reuse). */
    noteUncleansedBytes(preBytes: number): void {
        if (this.meter.enabled) {
            this.#originalBytes = preBytes;
            this.#cleansedBytes = preBytes;
        }
    }

    notePostCleanseChars(chars: number): void {
        this.#postCleanseChars = chars;
    }

    get postCleanseChars(): number | undefined {
        return this.#postCleanseChars;
    }

    /**
     * Content-cleanse outcome. Logging fires whenever elements were really
     * removed (the legacy candidate-path behavior, now uniform across both
     * paths — the old body-path silence was an untested asymmetry).
     */
    noteCleanseOutcome(
        cleanseResult: { totalRemoved: number; hardStripRemoved: number; keywordStripRemoved: number },
        logContext: { keywords: string; mode: string },
        aiCheck: { aiSummaryCleanseEnabled: boolean; aiSummaryOptions: AiSummaryCleanseOptions },
    ): void {
        if (cleanseResult.totalRemoved > 0) {
            // resolveCleanseReason never yields undefined at runtime; the
            // fallback only satisfies the optional-prop index type.
            this.#cleansedReason = resolveCleanseReason(cleanseResult.hardStripRemoved, cleanseResult.keywordStripRemoved) ?? 'none';
            this.#hardStripRemoved = cleanseResult.hardStripRemoved;
            this.#keywordStripRemoved = cleanseResult.keywordStripRemoved;
            this.#totalRemoved = cleanseResult.totalRemoved;
            this.#cleansingExecuted = true;

            console.log(`[ContentExtractor] Cleansed ${cleanseResult.totalRemoved} elements `
                + `(Hard: ${cleanseResult.hardStripRemoved}, Keyword: ${cleanseResult.keywordStripRemoved})`);

            void logSanitize(
                'Content cleansing executed',
                {
                    hardStripRemoved: cleanseResult.hardStripRemoved,
                    keywordStripRemoved: cleanseResult.keywordStripRemoved,
                    totalRemoved: cleanseResult.totalRemoved,
                    keywords: logContext.keywords,
                    mode: logContext.mode,
                },
                undefined,
                'contentExtractor',
            );
        }

        logDebug('AI Summary Cleansing check', { aiSummaryCleanseEnabled: aiCheck.aiSummaryCleanseEnabled, ...aiCheck.aiSummaryOptions });
    }

    noteAiApplied(applied: AiCleanseApplied): void {
        this.#aiSummaryOriginalBytes = applied.aiSummaryOriginalBytes;
        this.#aiSummaryCleansedBytes = applied.aiSummaryCleansedBytes;
        // The step always carries a reason at runtime; the fallback only
        // satisfies the optional-prop index type.
        this.#aiSummaryCleansedReason = applied.aiSummaryCleansedReason ?? 'none';
        this.#aiSummaryCleansedReasons = applied.aiSummaryCleansedReasons;
        this.#aiSummaryCleansedElements = applied.aiSummaryCleansedElements;
        this.#preAiCleanseText = applied.preAiCleanseText;
        this.#removedByReason = applied.removedByReason;
    }

    /**
     * Shared fallback settlement for the candidate and body paths. Resets
     * the cleanse counters (the shipped text no longer reflects them) and
     * drops AI diagnostics on the short-content arm only.
     */
    settleFallback(decision: FallbackDecision): void {
        this.#fallbackTriggered = true;
        this.#fallbackReason = decision.fallbackReason;
        if (!decision.usePreAiText) {
            this.#aiSummaryOriginalBytes = undefined;
            this.#aiSummaryCleansedBytes = undefined;
            this.#aiSummaryCleansedElements = undefined;
            this.#aiSummaryCleansedReason = 'none';
            this.#aiSummaryCleansedReasons = undefined;
            this.#removedByReason = undefined;
        }
        this.#cleansedReason = 'none';
        this.#hardStripRemoved = 0;
        this.#keywordStripRemoved = 0;
        this.#totalRemoved = 0;
        this.#cleansingExecuted = false;

        if (this.meter.enabled) {
            this.#originalBytes = decision.fallbackBytes ?? this.meter.measure(decision.content);
            this.#cleansedBytes = this.#originalBytes;
        }
    }

    /** Candidate-floor annotation when the body branch already joined the text. */
    annotateCandidateFloorMiss(): void {
        if (this.#candidateFloorMissed && !this.#fallbackTriggered) {
            this.#fallbackTriggered = true;
            this.#fallbackReason = 'candidate_too_small';
        }
    }

    /**
     * Diagnostic recount: fills removal counts without mutating the DOM.
     * Skipped entirely on the hot path (no scan, no encode).
     */
    recount(body: Element, options: RecountOptions): void {
        if (!this.#diagnostics) return;
        if (this.#totalRemoved === 0) {
            const countResult = countCleanseTargets(body, {
                hardStripEnabled: options.hardStripEnabled,
                keywordStripEnabled: options.keywordStripEnabled,
                keywords: options.keywords,
            });
            this.#hardStripRemoved = countResult.hardStripRemoved;
            this.#keywordStripRemoved = countResult.keywordStripRemoved;
            this.#totalRemoved = countResult.totalRemoved;
            if (this.#totalRemoved > 0) {
                this.#cleansedReason = resolveCleanseReason(this.#hardStripRemoved, this.#keywordStripRemoved) ?? 'none';
            }
        }

        if (!this.#fallbackTriggered && options.aiSummaryCleanseEnabled) {
            const aiSummaryCountResult = countAISummaryTargets(body, options.aiSummaryOptions);
            this.#aiSummaryCleansedElements = aiSummaryCountResult.totalRemoved;
            if (!this.#removedByReason) {
                this.#removedByReason = removedRecordToMap(aiSummaryCountResult.removed);
            }
            if (aiSummaryCountResult.totalRemoved > 0 && this.#aiSummaryCleansedReason === 'none') {
                const derived = deriveCleansedReason(aiSummaryCountResult);
                this.#aiSummaryCleansedReason = derived.reason ?? 'none';
                this.#aiSummaryCleansedReasons = derived.reasons.length > 0 ? derived.reasons : undefined;
            }
        }
    }

    /** Assemble the funnel + freeze the immutable snapshot. */
    build(): ExtractionReport {
        let funnel: ByteFunnel | undefined;
        if (this.meter.enabled && (this.#pageBytes || this.#candidateBytes || this.#cleansedBytes)) {
            funnel = { pageBytes: this.#pageBytes, candidateBytes: this.#candidateBytes, cleansedBytes: this.#cleansedBytes };
        }
        return new ExtractionReport({
            adapterUsed: this.#adapterUsed,
            whitelisted: this.#whitelisted,
            cleansedReason: this.#cleansedReason,
            hardStripRemoved: this.#hardStripRemoved,
            keywordStripRemoved: this.#keywordStripRemoved,
            totalRemoved: this.#totalRemoved,
            cleansingExecuted: this.#cleansingExecuted,
            pageBytes: this.#pageBytes,
            candidateBytes: this.#candidateBytes,
            originalBytes: this.#originalBytes,
            cleansedBytes: this.#cleansedBytes,
            aiSummaryOriginalBytes: this.#aiSummaryOriginalBytes,
            aiSummaryCleansedBytes: this.#aiSummaryCleansedBytes,
            aiSummaryCleansedElements: this.#aiSummaryCleansedElements,
            aiSummaryCleansedReason: this.#aiSummaryCleansedReason,
            aiSummaryCleansedReasons: this.#aiSummaryCleansedReasons,
            fallbackTriggered: this.#fallbackTriggered,
            fallbackReason: this.#fallbackReason,
            removedByReason: this.#removedByReason,
            funnel,
            originalContent: this.#originalContent,
            dualPayloadEnabled: this.#dualPayloadEnabled,
        });
    }
}

/** Single creation point so entries never construct the meter directly. */
export function createReportBuilder(maxChars: number, diagnostics: boolean): ExtractionReportBuilder {
    return new ExtractionReportBuilder({ maxChars, diagnostics });
}
