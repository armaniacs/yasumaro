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
 * 🟢
 */

import { cleanseContent, countCleanseTargets, type CleanseOptions, type CleanseResult } from '../contentCleaner.js';
import { logSanitize, logDebug } from '../logger.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';
import { cleanseAISummaryContent, countAISummaryTargets, type AiSummaryCleanseOptions } from '../aiSummaryCleaner/index.js';
import { THRESHOLD_DEFAULTS } from '../aiSummaryCleaner/rules.js';
import { deriveCleansedReason, removedRecordToMap } from './cleansedReason.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import type { ExtractResult, AiSummaryCleanseRunResult } from './types.js';
import { findMainContentCandidates } from './scoring.js';
import { extractTextFromElement } from './textExtraction.js';
import { matchWhitelistAdapter, extractWhitelistedContent } from './whitelistAdapters.js';
import { pickDefined } from '../objectUtils.js';

// パブリックAPIを再エクスポート
export type { ExtractResult } from './types.js';
export { isExcludedElement, isAsianContentElement } from './classifier.js';
export { calculateTextScore } from './scoring.js';

/**
 * Shared encoder for UTF-8 byte measurement. TextEncoder.encode allocates a
 * fresh Uint8Array per call, so reusing one instance avoids repeated setup.
 */
const ENCODER = new TextEncoder();

/**
 * 文字列のUTF-8バイト数を計算（Blob生成を避けて効率化）
 * @param str - バイト数を計算する文字列
 * @returns UTF-8バイト数
 */
function getByteSize(str: string): number {
    return ENCODER.encode(str).length;
}

/**
 * AI要約クレンジングを実行し、結果を集約する
 * 3つの重複ブロック（cleanseEnabled有無、候補の有無）から抽出
 * @param clone - クレンジング対象のクローン要素
 * @param options - AI要約クレンジングオプション
 * @param originalBytes - クレンジング前のバイト数
 * @returns 実行結果（バイト数、理由、要素数、フォールバック用テキスト）
 */
function runAiSummaryCleanse(
    clone: Element,
    options: AiSummaryCleanseOptions,
    originalBytes: number
): AiSummaryCleanseRunResult {
    const preCleanseText = clone.textContent || '';
    // Clone dedup: `clone` is the orchestrator-owned scratch copy in all
    // three paths (cleanseEnabled, AI-only, body fallback), so the AI cleanse
    // mutates it in place instead of cloning again. preCleanseText stays
    // captured first, before any mutation, as before.
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
    // ran can become a reason. This block used to list only 6 of the 32 rules.
    const { reason, reasons } = deriveCleansedReason(aiSummaryCleanseResult);
    const elements = aiSummaryCleanseResult.totalRemoved > 0 ? aiSummaryCleanseResult.totalRemoved : 0;

    return { originalBytes, cleansedBytes, reason, reasons, elements, preCleanseText, removed: aiSummaryCleanseResult.removed };
}

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
export function extractMainContent(
    maxChars: number = 10000,
    cleanseOptions: CleanseOptions & { cleanseEnabled?: boolean; returnInfo?: boolean; whitelistExtractionEnabled?: boolean } = { cleanseEnabled: false },
    aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled?: boolean } = { aiSummaryCleanseEnabled: false },
    dedupOptions: { dedupEnabled?: boolean; dedupThreshold?: number } = {}
): ExtractResult | string {
    let content = '';
    const { cleanseEnabled = false, hardStripEnabled = true, keywordStripEnabled = true, keywords = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'], returnInfo = false } = cleanseOptions;
    const { aiSummaryCleanseEnabled = false, fallbackRatio = 0.20, fallbackMinBytes = 300 } = aiSummaryCleanseOptions;
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
        // Byte measurement (TextEncoder + Blob) is diagnostic-only: enable it
        // only when the caller asked for ExtractResult diagnostics.
        measureBytes: aiSummaryCleanseOptions.measureBytes ?? returnInfo,
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
                    if (cleanseOptions.returnInfo) {
                        return {
                            content: truncated,
                            whitelistAdapterUsed: adapter.name,
                        };
                    }
                    return truncated;
                }
                // 0件抽出 — 通常のブラックリスト方式へフォールバック（whitelistFallbackTriggeredは returnInfo 時のみ記録）
            }
        }

        // findMainContentCandidates() 前のbody全体のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: returnInfo=false の通常経路では body 全体の文字列化もエンコードも行わない
        if (returnInfo && document.body) {
            pageBytes = getByteSize(document.body.textContent || '');
        }

        const candidates = findMainContentCandidates();

        // findMainContentCandidates() 後の候補要素のバイト数を計測（textContentベース、全バイト数と単位統一）
        // 診断専用: returnInfo=false では計測しない
        if (returnInfo && candidates.length > 0) {
            candidateBytes = getByteSize(candidates[0]!.textContent || '');
        }

        if (candidates.length > 0) {
            // 30-11: 二重ペイロード — 候補の原文を保持（クレンジング前のテキスト）
            // 30-14: ファネルの候補バイト数は既に candidateBytes で計測済み
            const firstCandidateForDual = candidates[0]!;
            if (!originalContent) {
                const rawDual = (firstCandidateForDual.textContent || '').trim();
                if (rawDual) {
                    originalContent = rawDual.slice(0, maxChars * 2);
                    dualPayloadEnabled = true;
                }
            }
            // クレンジングまたはAI要約クレンジングが有効な場合、クローンを作成してから実行
            const firstCandidate = candidates[0]!;
            let targetElement: Element;

            if (cleanseEnabled) {
                // DOMを直接操作しないようにクローンを作成
                const clone = firstCandidate.cloneNode(true) as Element;

                // クレンジング前のテキストを保持（診断時の重複エンコード排除用）
                const preCleanseText = firstCandidate.textContent || '';
                // クレンジング前のバイト数（textContentベースで統一）
                // preCleanseText は candidateBytes と同一文字列のため再利用し、重複エンコードしない
                if (returnInfo) {
                    originalBytes = candidateBytes;
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
                let preAiBytes = 0;
                if (returnInfo) {
                    cleansedBytes = cloneText === preCleanseText ? originalBytes : getByteSize(cloneText);
                    preAiBytes = cleansedBytes;
                } else if (aiSummaryCleanseEnabled) {
                    preAiBytes = getByteSize(cloneText);
                }

                if (cleanseResult.totalRemoved > 0) {
                    // クレンジング理由を決定（実際に要素が削除された場合のみ）
                    if (cleanseResult.hardStripRemoved > 0 && cleanseResult.keywordStripRemoved > 0) {
                        cleansedReason = 'both';
                    } else if (cleanseResult.hardStripRemoved > 0) {
                        cleansedReason = 'hard';
                    } else if (cleanseResult.keywordStripRemoved > 0) {
                        cleansedReason = 'keyword';
                    }
                    hardStripRemoved = cleanseResult.hardStripRemoved;
                    keywordStripRemoved = cleanseResult.keywordStripRemoved;
                    totalRemoved = cleanseResult.totalRemoved;

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

                    // Chrome Extension 環境の場合のみ、Badge 通知を送信
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                        console.log('[ContentExtractor] Sending CONTENT_CLEANSING_EXECUTED message');
                        void chrome.runtime.sendMessage({
                            type: 'CONTENT_CLEANSING_EXECUTED',
                            protocolVersion: CURRENT_PROTOCOL_VERSION,
                            payload: {
                                hardStripRemoved: cleanseResult.hardStripRemoved,
                                keywordStripRemoved: cleanseResult.keywordStripRemoved,
                                totalRemoved: cleanseResult.totalRemoved
                            }
                        }).then(() => {
                            console.log('[ContentExtractor] CONTENT_CLEANSING_EXECUTED message sent successfully');
                        }).catch((e) => {
                            console.error('[ContentExtractor] Failed to send CONTENT_CLEANSING_EXECUTED message:', e);
                        });
                    }
                }

                targetElement = clone;

                // AI要約クレンジングを実行（cleanseEnabledとは独立して動作）
                logDebug('AI Summary Cleansing check', { aiSummaryCleanseEnabled, ...resolvedAiSummaryOptions });
                if (aiSummaryCleanseEnabled) {
                    const aiSummaryRunResult = runAiSummaryCleanse(clone, resolvedAiSummaryOptions, preAiBytes);
                    aiSummaryOriginalBytes = aiSummaryRunResult.originalBytes;
                    aiSummaryCleansedBytes = aiSummaryRunResult.cleansedBytes;
                    aiSummaryCleansedReason = aiSummaryRunResult.reason;
                    aiSummaryCleansedReasons = aiSummaryRunResult.reasons.length > 0 ? aiSummaryRunResult.reasons : undefined;
                    aiSummaryCleansedElements = aiSummaryRunResult.elements;
                    preAiCleanseText = aiSummaryRunResult.preCleanseText;
                    removedByReason = removedRecordToMap(aiSummaryRunResult.removed);
                }
            } else {
                targetElement = firstCandidate;
                // バイト数（クレンジングなし、textContentベースで統一）
                // targetElement.textContent は candidateBytes と同一文字列のため再利用する
                // returnInfo=false では診断値を残さず、AIフォールバック用に1回だけ計測する
                let preAiBytesElse = 0;
                if (returnInfo) {
                    originalBytes = candidateBytes;
                    cleansedBytes = originalBytes;
                    preAiBytesElse = cleansedBytes;
                } else if (aiSummaryCleanseEnabled) {
                    preAiBytesElse = getByteSize(targetElement.textContent || '');
                }

                // AI要約クレンジングのみ有効な場合（cleanseEnabled=false, aiSummaryCleanseEnabled=true）
                // クローンを作成してAI要約クレンジングを実行
                if (aiSummaryCleanseEnabled) {
                    // DOMを直接操作しないようにクローンを作成
                    const clone = firstCandidate.cloneNode(true) as Element;

                    const aiSummaryRunResult = runAiSummaryCleanse(clone, resolvedAiSummaryOptions, preAiBytesElse);
                    aiSummaryOriginalBytes = aiSummaryRunResult.originalBytes;
                    aiSummaryCleansedBytes = aiSummaryRunResult.cleansedBytes;
                    aiSummaryCleansedReason = aiSummaryRunResult.reason;
                    aiSummaryCleansedReasons = aiSummaryRunResult.reasons.length > 0 ? aiSummaryRunResult.reasons : undefined;
                    aiSummaryCleansedElements = aiSummaryRunResult.elements;
                    preAiCleanseText = aiSummaryRunResult.preCleanseText;
                    removedByReason = removedRecordToMap(aiSummaryRunResult.removed);

                    // クレンジング後のクローンからテキストを抽出
                    targetElement = clone;
                }
            }

            // 要素からテキストを抽出
            content = extractTextFromElement(targetElement);

            // フォールバック判定: 短すぎるコンテンツまたは過剰削減
            const _contentBytes = getByteSize(content);
            const _isTooShort = content.trim().length < 100;
            const _overCleansed = aiSummaryOriginalBytes !== undefined
                && aiSummaryOriginalBytes > 0
                && (
                    (_contentBytes / aiSummaryOriginalBytes) < fallbackRatio
                    || _contentBytes < fallbackMinBytes
                );

            if (_isTooShort || _overCleansed) {
                fallbackTriggered = true;
                // Byte size of the fallback content. Reuses the already-measured
                // AI pre-cleanse size when falling back to that exact string.
                let fallbackBytes: number | undefined;
                if (_overCleansed && preAiCleanseText) {
                    // 過剰削減の場合、AI要約クレンジング前の生テキストに戻す
                    content = preAiCleanseText;
                    fallbackReason = 'over_cleansed';
                    fallbackBytes = aiSummaryOriginalBytes;
                    // NOTE: aiSummaryCleansedElements などは保持する（クレンジングが実際に実行されたため）
                } else {
                    // 短すぎるコンテンツの場合、body全体を使用
                    content = document.body?.innerText || '';
                    fallbackReason = 'short_content';

                    // フォールバックしたため、適用したクレンジングの結果を破棄
                    aiSummaryOriginalBytes = undefined;
                    aiSummaryCleansedBytes = undefined;
                    aiSummaryCleansedElements = undefined;
                    aiSummaryCleansedReason = 'none';
                    aiSummaryCleansedReasons = undefined;
                    removedByReason = undefined;
                }
                cleansedReason = 'none';
                hardStripRemoved = 0;
                keywordStripRemoved = 0;
                totalRemoved = 0;

                // フォールバック後のバイト数を再計算（診断専用）
                if (returnInfo) {
                    originalBytes = fallbackBytes ?? getByteSize(content);
                    cleansedBytes = originalBytes;
                }
            }
        } else {
            // 候補がない場合、body全体をクレンジング対象としてフォールバック
            if (cleanseEnabled && document.body) {
                const clone = document.body.cloneNode(true) as Element;

                // クレンジング前のテキストを保持（診断時の重複エンコード排除用）
                const bodyTextForCleanse = document.body.textContent || '';
                // クレンジング前のバイト数（textContentベースで統一）
                // bodyTextForCleanse は pageBytes と同一文字列のため再利用する
                if (returnInfo) {
                    originalBytes = pageBytes;
                }

                const cleanseResult: CleanseResult = cleanseContent(clone, {
                    hardStripEnabled,
                    keywordStripEnabled,
                    keywords
                });

                // クレンジング後のバイト数（textContentベースで統一）
                // AIフォールバック判定に渡す値。診断時は cleansedBytes をそのまま使い回す
                // 何も削除されず文字列が同一の場合は再エンコードせず使い回す
                const bodyCloneText = clone.textContent || '';
                let preAiBytesBody = 0;
                if (returnInfo) {
                    cleansedBytes = bodyCloneText === bodyTextForCleanse ? originalBytes : getByteSize(bodyCloneText);
                    preAiBytesBody = cleansedBytes;
                } else if (aiSummaryCleanseEnabled) {
                    preAiBytesBody = getByteSize(bodyCloneText);
                }

                if (cleanseResult.totalRemoved > 0) {
                    // クレンジング理由を決定（実際に要素が削除された場合のみ）
                    if (cleanseResult.hardStripRemoved > 0 && cleanseResult.keywordStripRemoved > 0) {
                        cleansedReason = 'both';
                    } else if (cleanseResult.hardStripRemoved > 0) {
                        cleansedReason = 'hard';
                    } else if (cleanseResult.keywordStripRemoved > 0) {
                        cleansedReason = 'keyword';
                    }
                    hardStripRemoved = cleanseResult.hardStripRemoved;
                    keywordStripRemoved = cleanseResult.keywordStripRemoved;
                    totalRemoved = cleanseResult.totalRemoved;
                }

                // AI要約クレンジングを実行
                if (aiSummaryCleanseEnabled) {
                    const aiSummaryRunResult = runAiSummaryCleanse(clone, resolvedAiSummaryOptions, preAiBytesBody);
                    aiSummaryOriginalBytes = aiSummaryRunResult.originalBytes;
                    aiSummaryCleansedBytes = aiSummaryRunResult.cleansedBytes;
                    aiSummaryCleansedReason = aiSummaryRunResult.reason;
                    aiSummaryCleansedReasons = aiSummaryRunResult.reasons.length > 0 ? aiSummaryRunResult.reasons : undefined;
                    aiSummaryCleansedElements = aiSummaryRunResult.elements;
                    preAiCleanseText = aiSummaryRunResult.preCleanseText;
                    removedByReason = removedRecordToMap(aiSummaryRunResult.removed);
                }
                // 30-11: bodyフォールバックでも原文を保持
                if (!originalContent && document.body) {
                    const rawBody = (document.body.textContent || '').trim();
                    if (rawBody) {
                        originalContent = rawBody.slice(0, maxChars * 2);
                        dualPayloadEnabled = true;
                    }
                }

                content = extractTextFromElement(clone);

                // フォールバック判定: 短すぎるコンテンツまたは過剰削減
                const _contentBytes = getByteSize(content);
                const _isTooShort = content.trim().length < 100;
                const _overCleansed = aiSummaryOriginalBytes !== undefined
                    && aiSummaryOriginalBytes > 0
                    && (
                        (_contentBytes / aiSummaryOriginalBytes) < fallbackRatio
                        || _contentBytes < fallbackMinBytes
                    );

                  if (_isTooShort || _overCleansed) {
                      fallbackTriggered = true;
                      // Byte size of the fallback content. Reuses the already-measured
                      // AI pre-cleanse size when falling back to that exact string.
                      let fallbackBytesBody: number | undefined;
                      if (_overCleansed && preAiCleanseText) {
                          // 過剰削減の場合、AI要約クレンジング前の生テキストに戻す
                          content = preAiCleanseText;
                          fallbackReason = 'over_cleansed';
                          fallbackBytesBody = aiSummaryOriginalBytes;
                          // NOTE: aiSummaryCleansedElements などは保持する（クレンジングが実際に実行されたため）
                      } else {
                          // 短すぎるコンテンツの場合、body全体を使用
                          content = document.body?.innerText || '';
                          fallbackReason = 'short_content';

                          // フォールバックしたため、適用したクレンジングの結果を破棄
                          aiSummaryOriginalBytes = undefined;
                          aiSummaryCleansedBytes = undefined;
                          aiSummaryCleansedElements = undefined;
                          aiSummaryCleansedReason = 'none';
                          aiSummaryCleansedReasons = undefined;
                          removedByReason = undefined;
                      }
                      cleansedReason = 'none';
                      hardStripRemoved = 0;
                      keywordStripRemoved = 0;
                      totalRemoved = 0;

                      // フォールバック後のバイト数を再計算（診断専用）
                      if (returnInfo) {
                          originalBytes = fallbackBytesBody ?? getByteSize(content);
                          cleansedBytes = originalBytes;
                      }
                 }
              } else {
                  content = document.body?.innerText || '';
                  // バイト数（クレンジングなし、診断専用）
                  if (returnInfo) {
                      originalBytes = getByteSize(content);
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
    if (returnInfo && (pageBytes || candidateBytes || cleansedBytes)) {
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

    // returnInfoオプションに従って返り値を変える
    if (returnInfo) {
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
                if (hardStripRemoved > 0 && keywordStripRemoved > 0) {
                    cleansedReason = 'both';
                } else if (hardStripRemoved > 0) {
                    cleansedReason = 'hard';
                } else if (keywordStripRemoved > 0) {
                    cleansedReason = 'keyword';
                }
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
            }),
        };
    }

    return content;
}