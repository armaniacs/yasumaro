/**
 * contentExtractor internal orchestrator
 * Extracts the main content of a web page and removes noise (navigation,
 * headers, etc.).
 *
 * Seam map: the ONLY external seam is pageContentPipeline.preparePageContent()
 * (config in → ExtractResult out). The production route is
 * contentKernel.extractPageContent() → preparePageContent() →
 * extractMainContentWithInfo(). Every export in this file is an internal seam:
 * - extractMainContentWithInfo — legacy-compat adapter (the entry
 *   preparePageContent calls; diagnostics expanded to the flat ExtractResult).
 * - extractMainContent — bench-measurement adapter ONLY (bench/micro
 *   c1-bytesize and c4-clonenode measure this non-diagnostic path). Zero
 *   production callers. Do not delete: removal would break the bench baseline
 *   continuity; entry reduction is re-evaluated at the next bench
 *   re-measurement.
 * - extract — internal seam for consumers that need the opaque ExtractionReport.
 */

import { INITIAL_KEYWORDS, type CleanseOptions } from '../contentCleaner.js';
import type { AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { THRESHOLD_DEFAULTS } from '../aiSummaryCleaner/rules.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import type { ExtractResult } from './types.js';
import { runCleanseAndExtract } from './extractPipeline.js';
import { createReportBuilder, ExtractionReport, type ExtractionReportBuilder } from './extractionReport.js';
import { scanMainContentCandidates } from './scoring.js';
import { matchWhitelistAdapter, extractWhitelistedContent } from './whitelistAdapters.js';

// パブリックAPIを再エクスポート
export type { ExtractResult } from './types.js';
export { ExtractionReport } from './extractionReport.js';
export type { ByteFunnel, CleanseCounts, FallbackCause, ExtractionReportTarget } from './extractionReport.js';
export { isExcludedElement, isAsianContentElement } from './classifier.js';
export { calculateTextScore } from './scoring.js';

/**
 * Shared encoder for UTF-8 byte measurement lives in extractPipeline.ts.
 * Diagnostic-only measurement goes through ByteMeter; fallback-critical
 * encodes use getByteSize directly.
 */

/**
 * Internal seam family. The positional options mirror the CleansingConfig
 * mapping built by buildExtractionOptions; the external seam
 * (preparePageContent) is the only caller that resolves a config into them.
 */
/**
 * Cleanse options accepted by the extractor entries.
 */
export type ExtractCleanseOptions = CleanseOptions & {
    cleanseEnabled?: boolean;
    whitelistExtractionEnabled?: boolean;
};

export type ExtractAiSummaryOptions = AiSummaryCleanseOptions & { aiSummaryCleanseEnabled?: boolean };
export type ExtractDedupOptions = { dedupEnabled?: boolean; dedupThreshold?: number };

/**
 * Config for the internal report-path entry. Mirrors the positional options of
 * the legacy entries in one struct.
 */
export interface ExtractConfig {
    maxChars?: number;
    cleanseOptions?: ExtractCleanseOptions;
    aiSummaryCleanseOptions?: ExtractAiSummaryOptions;
    dedupOptions?: ExtractDedupOptions;
}

/** Internal report-path output: extracted text plus the opaque diagnostics report. */
export interface ExtractOutput {
    content: string;
    report: ExtractionReport;
}

/**
 * Internal seam: extract the page main content WITH full diagnostics behind
 * an opaque ExtractionReport. Consumers cross only the narrow seam
 * (bytesFunnel / cleanseCounts / fallbackCause / originalText).
 */
export function extract(config: ExtractConfig = {}): ExtractOutput {
    const {
        maxChars = 10000,
        cleanseOptions = { cleanseEnabled: false },
        aiSummaryCleanseOptions = { aiSummaryCleanseEnabled: false },
        dedupOptions = {},
    } = config;
    const builder = createReportBuilder(maxChars, true);
    const content = extractInternal(maxChars, cleanseOptions, aiSummaryCleanseOptions, dedupOptions, builder);
    return { content, report: builder.build() };
}

/**
 * Legacy-compat adapter: full diagnostics expanded to the flat ExtractResult
 * shape. The only entry the external seam (preparePageContent) calls.
 */
export function extractMainContentWithInfo(
    maxChars: number = 10000,
    cleanseOptions: ExtractCleanseOptions = { cleanseEnabled: false },
    aiSummaryCleanseOptions: ExtractAiSummaryOptions = { aiSummaryCleanseEnabled: false },
    dedupOptions: ExtractDedupOptions = {}
): ExtractResult {
    const builder = createReportBuilder(maxChars, true);
    const content = extractInternal(maxChars, cleanseOptions, aiSummaryCleanseOptions, dedupOptions, builder);
    return builder.build().toLegacyResult(content);
}

/**
 * Bench-measurement adapter: thin string wrapper with diagnostic byte
 * measurement disabled (only fallback-critical encodes run). Zero production
 * callers — kept only as the c1/c4 micro-bench measurement surface. Do not
 * delete: removal would break the bench baseline continuity; entry reduction
 * is re-evaluated at the next bench re-measurement.
 */
export function extractMainContent(
    maxChars: number = 10000,
    cleanseOptions: ExtractCleanseOptions = { cleanseEnabled: false },
    aiSummaryCleanseOptions: ExtractAiSummaryOptions = { aiSummaryCleanseEnabled: false },
    dedupOptions: ExtractDedupOptions = {}
): string {
    const builder = createReportBuilder(maxChars, false);
    return extractInternal(maxChars, cleanseOptions, aiSummaryCleanseOptions, dedupOptions, builder);
}

/**
 * Shared orchestration for all entries. Diagnostic policy (measurement,
 * retention, funnel, recount) is owned by the builder — no boolean threads
 * through this function. The clone→cleanse→AI→fallback orchestration lives in
 * extractPipeline.runCleanseAndExtract; the candidate/body path difference
 * folds into the source element (top candidate / document.body) and the
 * preBytes origin (candidateBytes / pageBytes).
 */
function extractInternal(
    maxChars: number = 10000,
    cleanseOptions: ExtractCleanseOptions = { cleanseEnabled: false },
    aiSummaryCleanseOptions: ExtractAiSummaryOptions = { aiSummaryCleanseEnabled: false },
    dedupOptions: ExtractDedupOptions = {},
    builder: ExtractionReportBuilder
): string {
    let content = '';
    const { cleanseEnabled = false, hardStripEnabled = true, keywordStripEnabled = true, keywords = [...INITIAL_KEYWORDS] } = cleanseOptions;
    const { aiSummaryCleanseEnabled = false, fallbackRatio = 0.20, fallbackMinBytes = 300, fallbackMinChars = 100, cleanseGuardEnabled = true, candidateGuardEnabled = true } = aiSummaryCleanseOptions;
    // Diagnostic-only measurement seam lives in the builder: enabled exactly
    // when the caller asked for report diagnostics (extract / WithInfo).
    const meter = builder.meter;
    // Defaults for the 32 per-rule flags + thresholds come from CLEANSING_RULES /
    // THRESHOLD_DEFAULTS via isRuleEnabled()/resolveThresholds(), which
    // cleanseAISummaryContent already applies — so the options object built
    // here only needs to carry the caller's overrides through unchanged. This
    // replaces a 37-name destructure that had to restate every rule's default.
    const resolvedAiSummaryOptions: AiSummaryCleanseOptions = {
        ...aiSummaryCleanseOptions,
        linkRatioThreshold: aiSummaryCleanseOptions.linkRatioThreshold ?? THRESHOLD_DEFAULTS.linkRatioThreshold,
        shortTextThreshold: aiSummaryCleanseOptions.shortTextThreshold ?? THRESHOLD_DEFAULTS.shortTextThreshold,
        shortSeqCount: aiSummaryCleanseOptions.shortSeqCount ?? THRESHOLD_DEFAULTS.shortSeqCount,
        linkParaThreshold: aiSummaryCleanseOptions.linkParaThreshold ?? THRESHOLD_DEFAULTS.linkParaThreshold,
        customPatterns: aiSummaryCleanseOptions.customPatterns ?? THRESHOLD_DEFAULTS.customPatterns,
        // The cleaner skips its two outerHTML Blob serializations on this
        // path (a caller-supplied measureBytes is ignored): the extractor
        // recomputes its own bytes via TextEncoder (pre-AI bytes,
        // post-cleanse size, fallback-critical content size), so the Blob
        // work would be discarded.
        measureBytes: false,
    };
    const readBodyText = (): string => document.body?.innerText || '';

    try {
        // ホワイトリスト抽出モード判定: ドメイン一致 or DOM構造検知
        // Every path produces a report: the whitelist early-return carries
        // adapterUsed with a zero byte-funnel, so callers never assume fields.
        if (document.body && cleanseOptions.whitelistExtractionEnabled !== false) {
            const adapter = matchWhitelistAdapter(window.location.hostname, document.body);
            if (adapter) {
                const whitelistedText = extractWhitelistedContent(document.body, adapter);
                if (whitelistedText.length > 0) {
                    const truncated = whitelistedText.length > maxChars
                        ? whitelistedText.slice(0, maxChars)
                        : whitelistedText;
                    builder.noteWhitelistAdapter(adapter.name);
                    return truncated;
                }
                // 0件抽出 — 通常のブラックリスト方式へフォールバック
            }
        }

        // findMainContentCandidates() 前のbody全体のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: meter無効の通常経路では body 全体の文字列化もエンコードも行わない
        if (meter.enabled && document.body) {
            builder.notePageBytes(meter.measure(document.body.textContent || ''));
        }

        const scan = scanMainContentCandidates(candidateGuardEnabled ? fallbackMinChars : undefined);
        const candidates = scan.candidates;
        // PBI 05 ① all-miss: body join below; rejectedTop stays measurable so
        // diagnostics show what was discarded (transparent discard, why-G).
        builder.noteCandidateFloorMissed(candidates.length === 0 && scan.rejectedTop !== undefined);

        // findMainContentCandidates() 後の候補要素のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: meter無効では計測しない。①棄却時は棄却トップを対象にする。
        if (meter.enabled) {
            const measureTarget = candidates.length > 0 ? candidates[0]! : scan.rejectedTop;
            if (measureTarget) {
                builder.noteCandidateBytes(meter.measure(measureTarget.textContent || ''));
            }
        }

        if (candidates.length > 0) {
            // The funnel's candidate bytes are already measured; everything
            // after the clone lives in the pipeline.
            const firstCandidate = candidates[0]!;
            content = runCleanseAndExtract({
                source: {
                    sourceElement: firstCandidate,
                    preCleanseText: firstCandidate.textContent || '',
                    preBytes: builder.candidateBytes,
                    cleanse: cleanseEnabled,
                    candidateSource: true,
                },
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
            });
        } else {
            // No candidate: the body itself becomes the cleanse source.
            if (cleanseEnabled && document.body) {
                content = runCleanseAndExtract({
                    source: {
                        sourceElement: document.body,
                        preCleanseText: document.body.textContent || '',
                        preBytes: builder.pageBytes,
                        cleanse: true,
                    },
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
                });
            } else {
                content = document.body?.innerText || '';
                // Diagnostic-only byte measurement.
                if (meter.enabled) {
                    builder.noteUncleansedBytes(meter.measure(content));
                }
            }
        }
     } catch (_error) {
         // エラー時は安全なフォールバック
         content = document.body?.innerText || '';
     }

    // 空白文字の正規化（改行圧縮 → スペース統一 → トリム）
    content = content
        .replace(/\n{3,}/g, '\n\n')   // 3行以上の連続空白行を2行に圧縮
        .replace(/\s+/g, ' ')          // 残りの空白を単一スペースに
        .trim();

    // センテンスレベル冗長除去（MMR的Redundancy Reduction）
    const { dedupEnabled = false, dedupThreshold = 0.7 } = dedupOptions;
    if (dedupEnabled) {
        content = deduplicateContent(content, { threshold: dedupThreshold });
    }

    // 最大文字数で切り詰め
    if (content.length > maxChars) {
        content = content.substring(0, maxChars);
    }

    // PBI 05 ① candidate-floor guard: the body branch already produced the
    // content — annotate only. A real applyFallback decision keeps its own
    // reason (restore sources win over the annotation).
    builder.annotateCandidateFloorMiss();

    // 30-11: originalContent が未設定なら body からフォールバック（jsdomでも取得可能に）
    // The body read is skipped when the source retention already filled it,
    // so the hot string path never touches document.body.textContent here.
    if (document.body && !builder.hasOriginalText) {
        builder.ensureBodyOriginal(document.body.textContent || '');
    }

    // 診断時の対象候補カウント: report path でのみ実行
    // (string path では DOM スキャンをスキップする — builder が no-op 化)
    if (document.body) {
        builder.recount(document.body, {
            hardStripEnabled,
            keywordStripEnabled,
            keywords,
            aiSummaryCleanseEnabled,
            aiSummaryOptions: resolvedAiSummaryOptions,
        });
    }

    // Funnel assembly + report freeze happen in builder.build() at the
    // public entries; extractInternal returns the content string only.
    return content;
}