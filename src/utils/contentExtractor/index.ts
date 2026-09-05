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

import { cleanseContent, countCleanseTargets, type CleanseOptions, type CleanseResult } from '../contentCleaner.js';
import { logSanitize, logDebug } from '../logger.js';
import { countAISummaryTargets, type AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { THRESHOLD_DEFAULTS } from '../aiSummaryCleaner/rules.js';
import { deriveCleansedReason, removedRecordToMap, resolveCleanseReason } from './cleansedReason.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import type { ExtractResult } from './types.js';
import { applyAiCleanseStep, applyFallback, getByteSize, makeByteMeter, resolvePreAiBytes, type FallbackDecision } from './extractPipeline.js';
import { findMainContentCandidates } from './scoring.js';
import { extractTextFromElement } from './textExtraction.js';
import { matchWhitelistAdapter, extractWhitelistedContent } from './whitelistAdapters.js';
import { pickDefined } from '../objectUtils.js';

// パブリックAPIを再エクスポート
export type { ExtractResult } from './types.js';
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
 * Extract the page main content WITH full diagnostics (always ExtractResult).
 * Diagnostic byte measurement is enabled on this path only.
 * 本番経路（contentKernel → preparePageContent が使用する唯一の entry）。
 */
export function extractMainContentWithInfo(
    maxChars: number = 10000,
    cleanseOptions: ExtractCleanseOptions = { cleanseEnabled: false },
    aiSummaryCleanseOptions: ExtractAiSummaryOptions = { aiSummaryCleanseEnabled: false },
    dedupOptions: ExtractDedupOptions = {}
): ExtractResult {
    return extractInternal(maxChars, cleanseOptions, aiSummaryCleanseOptions, dedupOptions, true);
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
    return extractInternal(maxChars, cleanseOptions, aiSummaryCleanseOptions, dedupOptions, false).content;
}

/**
 * Shared orchestration for both entries. withDiagnostics is internal only:
 * it drives the ByteMeter and the diagnostic recount.
 * clone 以降の抽出工程は runCleanseAndExtract に集約（PBI 13）。candidate/body
 * の経路差分は入力要素の決定（先頭候補 / document.body）のみ。
 */
function extractInternal(
    maxChars: number = 10000,
    cleanseOptions: ExtractCleanseOptions = { cleanseEnabled: false },
    aiSummaryCleanseOptions: ExtractAiSummaryOptions = { aiSummaryCleanseEnabled: false },
    dedupOptions: ExtractDedupOptions = {},
    withDiagnostics: boolean
): ExtractResult {
    let content = '';
    const { cleanseEnabled = false, hardStripEnabled = true, keywordStripEnabled = true, keywords = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'] } = cleanseOptions;
    const { aiSummaryCleanseEnabled = false, fallbackRatio = 0.20, fallbackMinBytes = 300 } = aiSummaryCleanseOptions;
    // Diagnostic-only measurement seam: enabled exactly when the caller asked
    // for ExtractResult diagnostics (extractMainContentWithInfo entry).
    const meter = makeByteMeter(withDiagnostics);
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
    let cleansedReason: ExtractResult['cleansedReason'] = 'none';
    let hardStripRemoved = 0;
    let keywordStripRemoved = 0;
    let totalRemoved = 0;
    let pageBytes = 0;         // findMainContentCandidates() 前（body全体）のバイト数
    let candidateBytes = 0;    // findMainContentCandidates() 後（候補要素）のバイト数
    let originalBytes = 0;     // Content Cleansing前のバイト数
    let cleansedBytes = 0;     // Content Cleansing後のバイト数
    let aiSummaryOriginalBytes: number | undefined = undefined;  // AI要約クレンジング前のバイト数
    let aiSummaryCleansedBytes: number | undefined = undefined;  // AI要約クレンジング後のバイト数
    let aiSummaryCleansedElements: number | undefined = undefined;  // AI要約クレンジングで削除した要素数
    let aiSummaryCleansedReason: ExtractResult['aiSummaryCleansedReason'] = 'none';  // AI要約クレンジング実行理由
     let aiSummaryCleansedReasons: string[] | undefined;  // 複数理由の詳細リスト
     let fallbackTriggered = false;
     let preAiCleanseText: string | undefined;            // AI要約クレンジング前のテキスト（フォールバック用）
     let fallbackReason: ExtractResult['fallbackReason'] = undefined; // フォールバック理由（triggered時のみ設定）
    let removedByReason: Map<string, number> | undefined; // 30-14: ルール別削除件数
    let funnel: { pageBytes: number; candidateBytes: number; cleansedBytes: number } | undefined; // 30-14: ファネル
    let originalContent: string | undefined; // 30-11: 二重ペイロード — クレンジング前原文
    let dualPayloadEnabled: boolean | undefined; // 30-11: 二重ペイロード有効フラグ
    // 実際に要素を削除した Content Cleansing が走った場合のみ true。
    // 診断 recount ブロックではセットしない（recount は totalRemoved を埋めるだけ）。
    let cleansingExecuted: boolean | undefined = undefined;

    // Unified fallback settlement shared by the candidate path and the body
    // path (previously two duplicated blocks). The policy decision itself
    // comes from applyFallback; this applies the decision to local state.
    const settleFallback = (decision: FallbackDecision): void => {
        content = decision.content;
        fallbackTriggered = true;
        fallbackReason = decision.fallbackReason;
        if (!decision.usePreAiText) {
            // 短すぎるコンテンツの場合、body全体を使用
            // フォールバックしたため、適用したクレンジングの結果を破棄
            aiSummaryOriginalBytes = undefined;
            aiSummaryCleansedBytes = undefined;
            aiSummaryCleansedElements = undefined;
            aiSummaryCleansedReason = 'none';
            aiSummaryCleansedReasons = undefined;
            removedByReason = undefined;
        }
        // NOTE: over_cleansed path keeps aiSummaryCleansedElements etc.
        // (the cleanse actually ran — only the text is restored).
        cleansedReason = 'none';
        hardStripRemoved = 0;
        keywordStripRemoved = 0;
        totalRemoved = 0;

        // フォールバック後のバイト数を再計算（診断専用）
        if (meter.enabled) {
            originalBytes = decision.fallbackBytes ?? meter.measure(content);
            cleansedBytes = originalBytes;
        }
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
     * 旧両 path の歴史的非対称性はフラグで保存する（統一しない。振る舞い同一が優先）:
     * - dualPayloadFirst: candidate は clone 前に originalContent を登録し、
     *   body は AI step 後に登録する。現行順序を維持。
     * - emitSanitizeLog: console.log / logSanitize / AI Summary デバッグログは
     *   candidate path のみが発行していた。body path では出さない。
     * cleanse=false は candidate の no-cleanse ポリシー（live 要素＋任意の AI-only
     * clone）を再現する。body-plain ポリシー（innerText・fallback/AI なし）は本質的に
     * 異なるため呼び出し側にインラインで残す。
     */
    const runCleanseAndExtract = (source: {
        sourceElement: Element;
        preCleanseText: string;
        preBytes: number;
        cleanse: boolean;
        dualPayloadFirst: boolean;
        emitSanitizeLog: boolean;
    }): void => {
        // 30-11: 二重ペイロード — candidate path はクレンジング前に原文を保持
        if (source.dualPayloadFirst && !originalContent) {
            const rawDual = (source.sourceElement.textContent || '').trim();
            if (rawDual) {
                originalContent = rawDual.slice(0, maxChars * 2);
                dualPayloadEnabled = true;
            }
        }

        let targetElement: Element;

        if (source.cleanse) {
            // DOMを直接操作しないようにクローンを作成
            const clone = source.sourceElement.cloneNode(true) as Element;

            // クレンジング前のバイト数（textContentベースで統一）
            // preCleanseText は preBytes と同一文字列のため再利用し、重複エンコードしない
            if (meter.enabled) {
                originalBytes = source.preBytes;
            }

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
            const resolvedPreAi = resolvePreAiBytes(meter, cloneText, { text: source.preCleanseText, bytes: originalBytes }, aiSummaryCleanseEnabled);
            if (meter.enabled) {
                cleansedBytes = resolvedPreAi.cleansedBytes;
            }
            const preAiBytes = resolvedPreAi.preAiBytes;

            if (cleanseResult.totalRemoved > 0) {
                // クレンジング理由を決定（実際に要素が削除された場合のみ）
                cleansedReason = resolveCleanseReason(cleanseResult.hardStripRemoved, cleanseResult.keywordStripRemoved);
                hardStripRemoved = cleanseResult.hardStripRemoved;
                keywordStripRemoved = cleanseResult.keywordStripRemoved;
                totalRemoved = cleanseResult.totalRemoved;
                cleansingExecuted = true;

                if (source.emitSanitizeLog) {
                    console.log(`[ContentExtractor] Cleansed ${cleanseResult.totalRemoved} elements `
                        + `(Hard: ${cleanseResult.hardStripRemoved}, Keyword: ${cleanseResult.keywordStripRemoved})`);

                    // サニタイズログに記録（非同期で実行）
                    void logSanitize(
                        'Content cleansing executed',
                        {
                            hardStripRemoved: cleanseResult.hardStripRemoved,
                            keywordStripRemoved: cleanseResult.keywordStripRemoved,
                            totalRemoved: cleanseResult.totalRemoved,
                            keywords: keywords.join(', '),
                            mode: hardStripEnabled ? (keywordStripEnabled ? 'both' : 'hard') : 'keyword'
                        },
                        undefined,
                        'contentExtractor'
                    );
                }
            }

            targetElement = clone;

            // AI要約クレンジングを実行（cleanseEnabledとは独立して動作）
            if (source.emitSanitizeLog) {
                logDebug('AI Summary Cleansing check', { aiSummaryCleanseEnabled, ...resolvedAiSummaryOptions });
            }
            if (aiSummaryCleanseEnabled) {
                const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytes);
                aiSummaryOriginalBytes = applied.aiSummaryOriginalBytes;
                aiSummaryCleansedBytes = applied.aiSummaryCleansedBytes;
                aiSummaryCleansedReason = applied.aiSummaryCleansedReason;
                aiSummaryCleansedReasons = applied.aiSummaryCleansedReasons;
                aiSummaryCleansedElements = applied.aiSummaryCleansedElements;
                preAiCleanseText = applied.preAiCleanseText;
                removedByReason = applied.removedByReason;
            }
        } else {
            targetElement = source.sourceElement;
            // バイト数（クレンジングなし、textContentベースで統一）
            // targetElement.textContent は preBytes と同一文字列のため再利用する
            // meter無効では診断値を残さず、AIフォールバック用に1回だけ計測する
            let preAiBytesElse = 0;
            if (meter.enabled) {
                originalBytes = source.preBytes;
                cleansedBytes = originalBytes;
                preAiBytesElse = cleansedBytes;
            } else if (aiSummaryCleanseEnabled) {
                preAiBytesElse = getByteSize(targetElement.textContent || '');
            }

            // AI要約クレンジングのみ有効な場合（cleanseEnabled=false, aiSummaryCleanseEnabled=true）
            // クローンを作成してAI要約クレンジングを実行
            if (aiSummaryCleanseEnabled) {
                // DOMを直接操作しないようにクローンを作成
                const clone = source.sourceElement.cloneNode(true) as Element;

                const applied = applyAiCleanseStep(clone, resolvedAiSummaryOptions, preAiBytesElse);
                aiSummaryOriginalBytes = applied.aiSummaryOriginalBytes;
                aiSummaryCleansedBytes = applied.aiSummaryCleansedBytes;
                aiSummaryCleansedReason = applied.aiSummaryCleansedReason;
                aiSummaryCleansedReasons = applied.aiSummaryCleansedReasons;
                aiSummaryCleansedElements = applied.aiSummaryCleansedElements;
                preAiCleanseText = applied.preAiCleanseText;
                removedByReason = applied.removedByReason;

                // クレンジング後のクローンからテキストを抽出
                targetElement = clone;
            }
        }

        // 30-11: body path は AI step 後に原文を保持（登録順序を維持）
        if (!source.dualPayloadFirst && !originalContent && document.body) {
            const rawBody = (document.body.textContent || '').trim();
            if (rawBody) {
                originalContent = rawBody.slice(0, maxChars * 2);
                dualPayloadEnabled = true;
            }
        }

        // 要素からテキストを抽出
        content = extractTextFromElement(targetElement);

        // フォールバック判定: 短すぎるコンテンツまたは過剰削減
        // (single policy via applyFallback — shared by both paths)
        const fallbackDecision = applyFallback({
            content,
            contentBytes: getByteSize(content),
            preAiCleanseText,
            aiSummaryOriginalBytes,
            fallbackRatio,
            fallbackMinBytes,
            readBodyText,
        });
        if (fallbackDecision.fallbackTriggered) {
            settleFallback(fallbackDecision);
        }
    };

    try {
        // ホワイトリスト抽出モード判定: ドメイン一致 or DOM構造検知
        if (document.body && cleanseOptions.whitelistExtractionEnabled !== false) {
            const adapter = matchWhitelistAdapter(window.location.hostname, document.body);
            if (adapter) {
                const whitelistedText = extractWhitelistedContent(document.body, adapter);
                if (whitelistedText.length > 0) {
                    const truncated = whitelistedText.length > maxChars
                        ? whitelistedText.slice(0, maxChars)
                        : whitelistedText;
                    if (withDiagnostics) {
    // String path callers never reach here (extractMainContent takes .content);
    // extractInternal always returns the full ExtractResult.
    return {
                            content: truncated,
                            whitelistAdapterUsed: adapter.name,
                        };
                    }
                    return { content: truncated };
                }
                // 0件抽出 — 通常のブラックリスト方式へフォールバック
            }
        }

        // findMainContentCandidates() 前のbody全体のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: meter無効の通常経路では body 全体の文字列化もエンコードも行わない
        if (meter.enabled && document.body) {
            pageBytes = meter.measure(document.body.textContent || '');
        }

        const candidates = findMainContentCandidates();

        // findMainContentCandidates() 後の候補要素のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: meter無効では計測しない
        if (meter.enabled && candidates.length > 0) {
            candidateBytes = meter.measure(candidates[0]!.textContent || '');
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
                preBytes: candidateBytes,
                cleanse: cleanseEnabled,
                dualPayloadFirst: true,
                emitSanitizeLog: true,
            });
        } else {
            // 候補がない場合、body全体をクレンジング対象としてフォールバック
            // clone 以降の全工程は runCleanseAndExtract に集約（PBI 13）。
            // 経路差分は入力要素（document.body）と preBytes の出所（pageBytes）のみ。
            // dual payload 登録は AI step 後・sanitize ログなしの現行順序を維持。
            if (cleanseEnabled && document.body) {
                runCleanseAndExtract({
                    sourceElement: document.body,
                    preCleanseText: document.body.textContent || '',
                    preBytes: pageBytes,
                    cleanse: true,
                    dualPayloadFirst: false,
                    emitSanitizeLog: false,
                });
              } else {
                  content = document.body?.innerText || '';
                  // バイト数（クレンジングなし、診断専用）
                  if (meter.enabled) {
                      originalBytes = meter.measure(content);
                      cleansedBytes = originalBytes;
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

    // 30-14: ファネル集計 — 3段階バイトをまとめる（診断専用）
    if (meter.enabled && (pageBytes || candidateBytes || cleansedBytes)) {
        funnel = { pageBytes, candidateBytes, cleansedBytes };
    }
    // 30-11: originalContent が未設定なら body からフォールバック（jsdomでも取得可能に）
    if (!originalContent && document.body) {
        const fallbackRaw = (document.body.textContent || '').trim();
        if (fallbackRaw) {
            originalContent = fallbackRaw.slice(0, maxChars * 2);
            if (!dualPayloadEnabled) dualPayloadEnabled = !!originalContent;
        }
    }

    // 診断時の対象候補カウント: withDiagnostics の WithInfo path でのみ実行
    // (string path では DOM スキャンをスキップする)
    if (withDiagnostics) {
        // クレンジングが実行されなかった場合（または0件だった場合）、
        // body全体をスキャンして対象候補数をカウント（削除はしない）
        if (totalRemoved === 0 && document.body) {
            const countResult = countCleanseTargets(document.body, {
                hardStripEnabled,
                keywordStripEnabled,
                keywords
            });
            hardStripRemoved = countResult.hardStripRemoved;
            keywordStripRemoved = countResult.keywordStripRemoved;
            totalRemoved = countResult.totalRemoved;
            if (totalRemoved > 0) {
                // クレンジング理由を決定（実際に要素が削除された場合のみ）
                cleansedReason = resolveCleanseReason(hardStripRemoved, keywordStripRemoved);
            }
        }

        // AI要約クレンジングが実行されなかった場合（または0件だった場合）、
        // body全体をスキャンして対象候補数をカウント（削除はしない）
        // ただしフォールバック発動時は実際の処理が行われなかったためカウント対象外とする
        if (!fallbackTriggered && aiSummaryCleanseEnabled && document.body) {
            const aiSummaryCountResult = countAISummaryTargets(document.body, resolvedAiSummaryOptions);
            aiSummaryCleansedElements = aiSummaryCountResult.totalRemoved;
            if (!removedByReason) {
                removedByReason = removedRecordToMap(aiSummaryCountResult.removed);
            }
            // カウント結果に応じて理由を設定（0件の場合は'none'のまま）
            if (aiSummaryCountResult.totalRemoved > 0 && aiSummaryCleansedReason === 'none') {
                const derived = deriveCleansedReason(aiSummaryCountResult);
                aiSummaryCleansedReason = derived.reason;
                aiSummaryCleansedReasons = derived.reasons.length > 0 ? derived.reasons : undefined;
            }
        }
    }

    return {
        content,
        ...pickDefined({
            cleansedReason,
            hardStripRemoved,
            keywordStripRemoved,
            totalRemoved,
            pageBytes,
            candidateBytes,
            originalBytes,
            cleansedBytes,
            aiSummaryOriginalBytes,
            aiSummaryCleansedBytes,
            aiSummaryCleansedElements,
            aiSummaryCleansedReason,
            aiSummaryCleansedReasons,
            fallbackTriggered,
            fallbackReason,
            removedByReason,
            funnel,
            originalContent,
            dualPayloadEnabled,
            cleansingExecuted,
        }),
    };
}