/**
 * contentExtractor メインエントリーポイント
 * Webページのメインコンテンツを抽出し、ノイズ（ナビゲーション、ヘッダー等）を除去する
 *
 * 【リファクタリング履歴】: 単一ファイル（912行）からモジュール分割へ実装
 * 新しいモジュール構成:
 * - contentExtractor/types.ts              - 型定義（ExtractResult, CleanseCallback）
 * - contentExtractor/classifier.ts         - 要素分類（除外判定・アジアコンテンツ判定）
 * - contentExtractor/scoring.ts            - スコア計算・候補探索
 * - contentExtractor/textExtraction.ts      - テキスト抽出
 * - contentExtractor/index.ts              - オーケストレーター（このファイル）+ 再エクスポート
 *
 * 【entry の実態】(PBI 13 で確定):
 * - 本番の抽出経路は 1 本のみ: contentKernel.extractPageContent()
 *   → preparePageContent() → extractMainContentWithInfo()。string entry
 *   extractMainContent の本番呼び出しはゼロ。
 * - string entry は bench 計測面として維持する: bench/micro/c1-bytesize.bench.mjs
 *   と c4-clonenode.bench.mjs が非診断 path を計測する。削除すると bench baseline
 *   の連続性が切れるため、entry 削減は bench 再計測のタイミングで再評価する。
 * 🟢
 */

import { cleanseContent, INITIAL_KEYWORDS, type CleanseOptions, type CleanseResult } from '../contentCleaner.js';
import type { AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { THRESHOLD_DEFAULTS } from '../aiSummaryCleaner/rules.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import type { ExtractResult } from './types.js';
import { applyAiCleanseStep, applyFallback, getByteSize, resolvePreAiBytes, type FallbackDecision } from './extractPipeline.js';
import { createReportBuilder, ExtractionReport, type ExtractionReportBuilder } from './extractionReport.js';
import { scanMainContentCandidates } from './scoring.js';
import { extractTextFromElement } from './textExtraction.js';
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
 * ページのメインコンテンツを抽出する
 * 【機能概要】: メインコンテンツ（記事、本文等）をテキストとして抽出
 * 【処理内容】:
 *   1. article/mainタグを優先的に探索
 *   2. 見出し、段落の多い要素を選択
 *   3. ナビゲーション、ヘッダー等を除外
 *   4. （オプション）コンテンツ・クレンジング（Hard Strip + Keyword Strip）
 *   5. （オプション）AI要約クレンジング（alt属性、メタデータ、広告、ナビゲーション、ソーシャルウィジェット削除）
 *   6. 最大文字数で切り詰め
 * 【フォールバック】: メインコンテンツが見つからない場合は body.innerText を使用
 * 【サイズ制限】: maxChars で指定された最大文字数（デフォルト: 10000）
 * 🟢
 * @param maxChars - 最大文字数（デフォルト: 10000）
 * @param cleanseOptions - クレンジングオプション（デフォルト: クレンジング無効）
 * @param aiSummaryCleanseOptions - AI要約クレンジングオプション（デフォルト: クレンジング無効）
 * @returns 抽出されたテキスト（空白正規化済み、最大文字数制限適用）
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
 * Config for the primary extract() entry. Mirrors the positional options of
 * the legacy entries in one struct.
 */
export interface ExtractConfig {
    maxChars?: number;
    cleanseOptions?: ExtractCleanseOptions;
    aiSummaryCleanseOptions?: ExtractAiSummaryOptions;
    dedupOptions?: ExtractDedupOptions;
}

/** Primary output: extracted text plus the opaque diagnostics report. */
export interface ExtractOutput {
    content: string;
    report: ExtractionReport;
}

/**
 * Primary entry: extract the page main content WITH full diagnostics behind
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
 * Legacy compat: full diagnostics expanded to the flat ExtractResult shape.
 * 本番経路（contentKernel → preparePageContent が使用する唯一の entry）。
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
 * Thin string wrapper for the hot path (every autosave). Diagnostic byte
 * measurement is disabled; only fallback-critical encodes run.
 * 本番未使用 — bench c1/c4 の計測面として維持する（削除すると bench baseline の
 * 連続性が切れる）。将来 bench を再計測するタイミングで entry 削減を再評価する。
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
 * through this function.
 * clone 以降の抽出工程は runCleanseAndExtract に集約（PBI 13）。candidate/body
 * の経路差分は入力要素の決定（先頭候補 / document.body）のみ。
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
    // Unified fallback settlement shared by the candidate path and the body
    // path (previously two duplicated blocks). The policy decision itself
    // comes from applyFallback; diagnostic settlement lives in the builder.
    const settleFallback = (decision: FallbackDecision): void => {
        content = decision.content;
        builder.settleFallback(decision);
    };
    const readBodyText = (): string => document.body?.innerText || '';

    /**
     * runCleanseAndExtract — clone → cleanse → pre-AI bytes → reason → AI step
     * → dual payload → extract → fallback の単一オーケストレーション（PBI 13）。
     * candidate path と body path で共有し、経路差分は呼び出し側が渡す入力要素
     * （先頭候補 / document.body）と preBytes の出所（candidateBytes / pageBytes）
     * のみに畳み込む。meter 呼び出し順は旧両 path と同一（診断 reuse → 条件付き
     * measure のみ。bench c1 の計測対象を動かさない）。
     *
     * 旧両 path の歴史的非対称性は candidate 側に統一して解消した:
     * dual payload は常に抽出元から clone 前に保持し（AI step は clone 上で
     * 動くため source 文字列は前後で同一）、sanitize ログは実際に要素を
     * 削除したときに常時発行する。旧 body-path の沈黙を pin するテストは
     * 存在しない。
     * cleanse=false は candidate の no-cleanse ポリシー（live 要素＋任意の AI-only
     * clone）を再現する。body-plain ポリシー（innerText・fallback/AI なし）は本質的に
     * 異なるため呼び出し側にインラインで残す。
     */
    const runCleanseAndExtract = (source: {
        sourceElement: Element;
        preCleanseText: string;
        preBytes: number;
        cleanse: boolean;
        /** PBI 05: candidate-source only — gates the ② restore (body restore would ship raw textContent). */
        candidateSource?: boolean;
    }): void => {
        // 30-11: 二重ペイロード — 抽出元からクレンジング前に原文を保持
        builder.retainSourceOriginal(source.sourceElement.textContent || '');

        let targetElement: Element;

        if (source.cleanse) {
            // DOMを直接操作しないようにクローンを作成
            const clone = source.sourceElement.cloneNode(true) as Element;

            // クレンジング前のバイト数（textContentベースで統一）
            // preCleanseText は preBytes と同一文字列のため再利用し、重複エンコードしない
            builder.noteCleanseStart(source.preBytes);

            // クローンに対してコンテンツクレンジングを実行
            const cleanseResult: CleanseResult = cleanseContent(clone, {
                hardStripEnabled,
                keywordStripEnabled,
                keywords
            });

            // クレンジング後のバイト数（textContentベースで統一）
            // AIフォールバック判定に渡す値。診断時は cleansedBytes をそのまま使い回す
            // 何も削除されず文字列が同一の場合は再エンコードせず使い回す
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

            // AI要約クレンジングを実行（cleanseEnabledとは独立して動作）
            if (aiSummaryCleanseEnabled) {
                const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytes);
                builder.noteAiApplied(applied);
            }
        } else {
            targetElement = source.sourceElement;
            // バイト数（クレンジングなし、textContentベースで統一）
            // targetElement.textContent は preBytes と同一文字列のため再利用する
            // meter無効では診断値を残さず、AIフォールバック用に1回だけ計測する
            let preAiBytesElse = 0;
            if (meter.enabled) {
                builder.noteUncleansedBytes(source.preBytes);
                preAiBytesElse = builder.cleansedBytes;
            } else if (aiSummaryCleanseEnabled) {
                preAiBytesElse = getByteSize(targetElement.textContent || '');
            }

            // AI要約クレンジングのみ有効な場合（cleanseEnabled=false, aiSummaryCleanseEnabled=true）
            // クローンを作成してAI要約クレンジングを実行
            if (aiSummaryCleanseEnabled) {
                // DOMを直接操作しないようにクローンを作成
                const clone = source.sourceElement.cloneNode(true) as Element;

                const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytesElse);
                builder.noteAiApplied(applied);

                // クレンジング後のクローンからテキストを抽出
                targetElement = clone;
            }
        }

        // 要素からテキストを抽出
        content = extractTextFromElement(targetElement);

        // フォールバック判定: 短すぎるコンテンツまたは過剰削減
        // (single policy via applyFallback — shared by both paths)
        // PBI 05 ② pair is supplied only when Content Cleansing ran on a
        // candidate source AND the ② guard flag is on — omitted otherwise,
        // which reproduces the legacy decision byte-for-byte.
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
            settleFallback(fallbackDecision);
        }
    };

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
            // 30-11: 二重ペイロード — 候補の原文を保持（クレンジング前のテキスト）
            // 30-14: ファネルの候補バイト数は既に candidateBytes で計測済み
            // clone 以降の全工程は runCleanseAndExtract に集約（PBI 13）。
            // 経路差分は入力要素（先頭候補）と preBytes の出所（candidateBytes）のみ。
            const firstCandidate = candidates[0]!;
            runCleanseAndExtract({
                sourceElement: firstCandidate,
                preCleanseText: firstCandidate.textContent || '',
                preBytes: builder.candidateBytes,
                cleanse: cleanseEnabled,
                candidateSource: true,
            });
        } else {
            // 候補がない場合、body全体をクレンジング対象としてフォールバック
            // clone 以降の全工程は runCleanseAndExtract に集約（PBI 13）。
            // 経路差分は入力要素（document.body）と preBytes の出所（pageBytes）のみ。
            if (cleanseEnabled && document.body) {
                runCleanseAndExtract({
                    sourceElement: document.body,
                    preCleanseText: document.body.textContent || '',
                    preBytes: builder.pageBytes,
                    cleanse: true,
                });
              } else {
                  content = document.body?.innerText || '';
                  // バイト数（クレンジングなし、診断専用）
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