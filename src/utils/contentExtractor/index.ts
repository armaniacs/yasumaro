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
import { cleanseAISummaryContent, countAISummaryTargets, type AiSummaryCleanseOptions, type AiSummaryCleanseResult } from '../aiSummaryCleaner.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import type { ExtractResult } from './types.js';
import { findMainContentCandidates } from './scoring.js';
import { extractTextFromElement } from './textExtraction.js';

// パブリックAPIを再エクスポート
export type { ExtractResult } from './types.js';
export { isExcludedElement, isAsianContentElement } from './classifier.js';
export { calculateTextScore } from './scoring.js';
export { EXCLUDED_ROLES, EXCLUDED_TAGS, EXCLUDED_CLASS_PATTERNS, ASIA_CONTENT_CLASS_PATTERNS, ASIA_CONTENT_ID_PATTERNS } from './classifier.js';

/**
 * 文字列のUTF-8バイト数を計算（Blob生成を避けて効率化）
 * @param str - バイト数を計算する文字列
 * @returns UTF-8バイト数
 */
function getByteSize(str: string): number {
    return new TextEncoder().encode(str).length;
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
    cleanseOptions: CleanseOptions & { cleanseEnabled?: boolean; returnInfo?: boolean } = { cleanseEnabled: false },
    aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled?: boolean } = { aiSummaryCleanseEnabled: false },
    dedupOptions: { dedupEnabled?: boolean; dedupThreshold?: number } = {}
): ExtractResult | string {
    let content = '';
    const { cleanseEnabled = false, hardStripEnabled = true, keywordStripEnabled = true, keywords = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'], returnInfo = false } = cleanseOptions;
    const { aiSummaryCleanseEnabled = false, altEnabled = true, metadataEnabled = true, adsEnabled = true, navEnabled = true, socialEnabled = true, deepEnabled = false, jsonLdEnabled = false, lazyLoadEnabled = false, skipLinkEnabled = false, cardEnabled = false, linkDensityEnabled = false, fixedEnabled = false, recommendEnabled = true, paginationEnabled = false, snsPromoEnabled = false, popupEnabled = true, platformEnabled = false, textDensityEnabled = false, shortSeqEnabled = false, symbolLineEnabled = false, linkParaEnabled = false, enhancedHiddenEnabled = true, emptyElemEnabled = true, jpLayoutEnabled = false, jpNavigationEnabled = false, authorEnabled = false, linkRatioThreshold = 70, shortTextThreshold = 30, shortSeqCount = 5, linkParaThreshold = 50, customPatterns = [] } = aiSummaryCleanseOptions;
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

    try {
        // findMainContentCandidates() 前のbody全体のバイト数を計測（textContentベース、全バイト数と単位統一）
        if (document.body) {
            pageBytes = getByteSize(document.body.textContent || '');
        }

        const candidates = findMainContentCandidates();

        // findMainContentCandidates() 後の候補要素のバイト数を計測（textContentベース、全バイト数と単位統一）
        if (candidates.length > 0) {
            candidateBytes = getByteSize(candidates[0].textContent || '');
        }

        if (candidates.length > 0) {
            // クレンジングまたはAI要約クレンジングが有効な場合、クローンを作成してから実行
            let targetElement: Element;

            if (cleanseEnabled) {
                // DOMを直接操作しないようにクローンを作成
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const clone = candidates[0].cloneNode(true) as Element;

                // クレンジング前のバイト数を計算（textContentベースで統一）
                originalBytes = getByteSize(candidates[0].textContent || '');

                // クローンに対してコンテンツクレンジングを実行
                const cleanseResult: CleanseResult = cleanseContent(clone, {
                    hardStripEnabled,
                    keywordStripEnabled,
                    keywords
                });

                // クレンジング後のバイト数を計算（textContentベースで統一）
                cleansedBytes = getByteSize(clone.textContent || '');

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
                logDebug('AI Summary Cleansing check', { aiSummaryCleanseEnabled, altEnabled, metadataEnabled, adsEnabled, navEnabled, socialEnabled });
                if (aiSummaryCleanseEnabled) {
                    // AI要約クレンジング**前**のバイト数を計算（テキストベース）
                    // Content Cleansing後のcloneの状態がAI要約クレンジングの開始点
                    aiSummaryOriginalBytes = cleansedBytes;

                    // AI要約クレンジングを実行
                    const aiSummaryCleanseResult: AiSummaryCleanseResult = cleanseAISummaryContent(clone, {
                        altEnabled,
                        metadataEnabled,
                        adsEnabled,
                        navEnabled,
                        socialEnabled,
                        deepEnabled,
                        jsonLdEnabled,
                        lazyLoadEnabled,
                        skipLinkEnabled,
                        cardEnabled,
                        linkDensityEnabled,
                        // NEW: 6つの新しいオプション
                        fixedEnabled,
                        recommendEnabled,
                        paginationEnabled,
                        snsPromoEnabled,
                        popupEnabled,
                        platformEnabled,
                        // NEW: 9つの追加オプション
                        textDensityEnabled,
                        shortSeqEnabled,
                        symbolLineEnabled,
                        linkParaEnabled,
                        enhancedHiddenEnabled,
                        emptyElemEnabled,
                        jpLayoutEnabled,
                        jpNavigationEnabled,
                        authorEnabled,
                        // Threshold settings
                        linkRatioThreshold,
                        shortTextThreshold,
                        shortSeqCount,
                        linkParaThreshold,
                        // Custom patterns
                        customPatterns,
                    });

                    logDebug('AI Summary Cleansing result', aiSummaryCleanseResult);

                    // AI要約クレンジング**後**のバイト数を計算（textContentベースで統一）
                    aiSummaryCleansedBytes = getByteSize(clone.textContent || '');

                    if (aiSummaryCleanseResult.totalRemoved > 0) {
                        // AI要約クレンジング理由を決定
                        const removedTypes: string[] = [];
                        if (aiSummaryCleanseResult.altRemoved > 0) removedTypes.push('alt');
                        if (aiSummaryCleanseResult.metadataRemoved > 0) removedTypes.push('metadata');
                        if (aiSummaryCleanseResult.adsRemoved > 0) removedTypes.push('ads');
                        if (aiSummaryCleanseResult.navRemoved > 0) removedTypes.push('nav');
                        if (aiSummaryCleanseResult.socialRemoved > 0) removedTypes.push('social');
                        if (aiSummaryCleanseResult.deepRemoved > 0) removedTypes.push('deep');

                        if (removedTypes.length === 1) {
                            aiSummaryCleansedReason = removedTypes[0] as ExtractResult['aiSummaryCleansedReason'];
                        } else if (removedTypes.length > 1) {
                            aiSummaryCleansedReason = 'multiple';
                            aiSummaryCleansedReasons = removedTypes;
                        }

                        aiSummaryCleansedElements = aiSummaryCleanseResult.totalRemoved;
                    }
                }
            } else {
                targetElement = candidates[0];
                // バイト数を計算（クレンジングなし、textContentベースで統一）
                originalBytes = getByteSize(targetElement.textContent || '');
                cleansedBytes = originalBytes;

                // AI要約クレンジングのみ有効な場合（cleanseEnabled=false, aiSummaryCleanseEnabled=true）
                // クローンを作成してAI要約クレンジングを実行
                if (aiSummaryCleanseEnabled) {
                    // DOMを直接操作しないようにクローンを作成
                    const clone = candidates[0].cloneNode(true) as Element;

                    // AI要約クレンジング**前**のバイト数を計算
                    aiSummaryOriginalBytes = cleansedBytes;

                    // AI要約クレンジングを実行
                    const aiSummaryCleanseResult: AiSummaryCleanseResult = cleanseAISummaryContent(clone, {
                        altEnabled,
                        metadataEnabled,
                        adsEnabled,
                        navEnabled,
                        socialEnabled,
                        deepEnabled,
                        jsonLdEnabled,
                        lazyLoadEnabled,
                        skipLinkEnabled,
                        cardEnabled,
                        linkDensityEnabled,
                        fixedEnabled,
                        recommendEnabled,
                        paginationEnabled,
                        snsPromoEnabled,
                        popupEnabled,
                        platformEnabled,
                        textDensityEnabled,
                        shortSeqEnabled,
                        symbolLineEnabled,
                        linkParaEnabled,
                        enhancedHiddenEnabled,
                        emptyElemEnabled,
                        jpLayoutEnabled,
                        jpNavigationEnabled,
                        authorEnabled,
                        linkRatioThreshold,
                        shortTextThreshold,
                        shortSeqCount,
                        linkParaThreshold,
                        customPatterns,
                    });

                    logDebug('AI Summary Cleansing result (cleanseEnabled=false)', aiSummaryCleanseResult);

                    // AI要約クレンジング**後**のバイト数を計算
                    aiSummaryCleansedBytes = getByteSize(clone.textContent || '');

                    if (aiSummaryCleanseResult.totalRemoved > 0) {
                        const removedTypes: string[] = [];
                        if (aiSummaryCleanseResult.altRemoved > 0) removedTypes.push('alt');
                        if (aiSummaryCleanseResult.metadataRemoved > 0) removedTypes.push('metadata');
                        if (aiSummaryCleanseResult.adsRemoved > 0) removedTypes.push('ads');
                        if (aiSummaryCleanseResult.navRemoved > 0) removedTypes.push('nav');
                        if (aiSummaryCleanseResult.socialRemoved > 0) removedTypes.push('social');
                        if (aiSummaryCleanseResult.deepRemoved > 0) removedTypes.push('deep');

                        if (removedTypes.length === 1) {
                            aiSummaryCleansedReason = removedTypes[0] as ExtractResult['aiSummaryCleansedReason'];
                        } else if (removedTypes.length > 1) {
                            aiSummaryCleansedReason = 'multiple';
                            aiSummaryCleansedReasons = removedTypes;
                        }

                        aiSummaryCleansedElements = aiSummaryCleanseResult.totalRemoved;
                    }

                    // クレンジング後のクローンからテキストを抽出
                    targetElement = clone;
                }
            }

            // 要素からテキストを抽出
            content = extractTextFromElement(targetElement);

            // 抽出テキストが短すぎる場合、または過剰削減された場合、body全体でフォールバック
            const _contentBytes2 = getByteSize(content);
            const _overCleansed2 = aiSummaryOriginalBytes !== undefined
                && aiSummaryOriginalBytes > 0
                && (_contentBytes2 / aiSummaryOriginalBytes) < 0.10
                && _contentBytes2 < 2000;
            if (content.trim().length < 100 || _overCleansed2) {
                fallbackTriggered = true;
                content = document.body?.innerText || '';
                // フォールバック後のバイト数を再計算
                originalBytes = getByteSize(content);
                cleansedBytes = originalBytes; // クレンジングなしなので同じ値
                
                // フォールバックしたため、適用したクレンジングの結果を破棄
                aiSummaryOriginalBytes = undefined;
                aiSummaryCleansedBytes = undefined;
                aiSummaryCleansedElements = undefined;
                aiSummaryCleansedReason = 'none';
                aiSummaryCleansedReasons = undefined;
                cleansedReason = 'none';
                hardStripRemoved = 0;
                keywordStripRemoved = 0;
                totalRemoved = 0;
            }
        } else {
            // 候補がない場合、body全体をクレンジング対象としてフォールバック
            if (cleanseEnabled && document.body) {
                const clone = document.body.cloneNode(true) as Element;

                // クレンジング前のバイト数を計算（textContentベースで統一）
                originalBytes = getByteSize(document.body.textContent || '');

                const cleanseResult: CleanseResult = cleanseContent(clone, {
                    hardStripEnabled,
                    keywordStripEnabled,
                    keywords
                });

                // クレンジング後のバイト数を計算（textContentベースで統一）
                cleansedBytes = getByteSize(clone.textContent || '');

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
                    // AI要約クレンジング**前**のバイト数を計算（テキストベース）
                    // Content Cleansing後のcloneの状態がAI要約クレンジングの開始点
                    aiSummaryOriginalBytes = cleansedBytes;

                    // AI要約クレンジングを実行
                    const aiSummaryCleanseResult: AiSummaryCleanseResult = cleanseAISummaryContent(clone, {
                        altEnabled,
                        metadataEnabled,
                        adsEnabled,
                        navEnabled,
                        socialEnabled,
                        deepEnabled,
                        jsonLdEnabled,
                        lazyLoadEnabled,
                        skipLinkEnabled,
                        cardEnabled,
                        linkDensityEnabled,
                        // NEW: 6つの新しいオプション
                        fixedEnabled,
                        recommendEnabled,
                        paginationEnabled,
                        snsPromoEnabled,
                        popupEnabled,
                        platformEnabled,
                        // NEW: 9つの追加オプション
                        textDensityEnabled,
                        shortSeqEnabled,
                        symbolLineEnabled,
                        linkParaEnabled,
                        enhancedHiddenEnabled,
                        emptyElemEnabled,
                        jpLayoutEnabled,
                        jpNavigationEnabled,
                        authorEnabled,
                        // Threshold settings
                        linkRatioThreshold,
                        shortTextThreshold,
                        shortSeqCount,
                        linkParaThreshold,
                        // Custom patterns
                        customPatterns,
                    });

                    logDebug('AI Summary Cleansing result', aiSummaryCleanseResult);

                    // AI要約クレンジング**後**のバイト数を計算（textContentベースで統一）
                    aiSummaryCleansedBytes = getByteSize(clone.textContent || '');

                    if (aiSummaryCleanseResult.totalRemoved > 0) {
                        // AI要約クレンジング理由を決定
                        const removedTypes: string[] = [];
                        if (aiSummaryCleanseResult.altRemoved > 0) removedTypes.push('alt');
                        if (aiSummaryCleanseResult.metadataRemoved > 0) removedTypes.push('metadata');
                        if (aiSummaryCleanseResult.adsRemoved > 0) removedTypes.push('ads');
                        if (aiSummaryCleanseResult.navRemoved > 0) removedTypes.push('nav');
                        if (aiSummaryCleanseResult.socialRemoved > 0) removedTypes.push('social');
                        if (aiSummaryCleanseResult.deepRemoved > 0) removedTypes.push('deep');

                        if (removedTypes.length === 1) {
                            aiSummaryCleansedReason = removedTypes[0] as ExtractResult['aiSummaryCleansedReason'];
                        } else if (removedTypes.length > 1) {
                            aiSummaryCleansedReason = 'multiple';
                            aiSummaryCleansedReasons = removedTypes;
                        }

                        aiSummaryCleansedElements = aiSummaryCleanseResult.totalRemoved;
                    }
                }

                content = extractTextFromElement(clone);

                // 抽出テキストが短すぎる場合、または過剰削減された場合、body全体でフォールバック
                const _contentBytes = getByteSize(content);
                const _overCleansed = aiSummaryOriginalBytes !== undefined
                    && aiSummaryOriginalBytes > 0
                    && (_contentBytes / aiSummaryOriginalBytes) < 0.10
                    && _contentBytes < 2000;
                if (content.trim().length < 100 || _overCleansed) {
                    fallbackTriggered = true;
                    content = document.body?.innerText || '';
                    originalBytes = getByteSize(content);
                    cleansedBytes = originalBytes;
                    
                    // フォールバックしたため、適用したクレンジングの結果を破棄
                    aiSummaryOriginalBytes = undefined;
                    aiSummaryCleansedBytes = undefined;
                    aiSummaryCleansedElements = undefined;
                    aiSummaryCleansedReason = 'none';
                    aiSummaryCleansedReasons = undefined;
                    cleansedReason = 'none';
                    hardStripRemoved = 0;
                    keywordStripRemoved = 0;
                    totalRemoved = 0;
                }
            } else {
                content = document.body?.innerText || '';
                // バイト数を計算（クレンジングなし）
                originalBytes = getByteSize(content);
                cleansedBytes = originalBytes;
            }
        }
    } catch (error) {
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
        if (!fallbackTriggered && (aiSummaryCleansedElements === undefined || aiSummaryCleansedElements === 0) && aiSummaryCleanseEnabled && document.body) {
            const aiSummaryCountResult = countAISummaryTargets(document.body, {
                altEnabled,
                metadataEnabled,
                adsEnabled,
                navEnabled,
                socialEnabled,
                deepEnabled,
                jsonLdEnabled,
                lazyLoadEnabled,
                skipLinkEnabled,
                cardEnabled,
                linkDensityEnabled,
                // NEW
                fixedEnabled,
                recommendEnabled,
                paginationEnabled,
                snsPromoEnabled,
                popupEnabled,
                platformEnabled
            });
            aiSummaryCleansedElements = aiSummaryCountResult.totalRemoved;
            if (aiSummaryCountResult.totalRemoved > 0) {
                // AI要約クレンジング理由を決定
                const removedTypes: string[] = [];
                if (aiSummaryCountResult.altRemoved > 0) removedTypes.push('alt');
                if (aiSummaryCountResult.metadataRemoved > 0) removedTypes.push('metadata');
                if (aiSummaryCountResult.adsRemoved > 0) removedTypes.push('ads');
                if (aiSummaryCountResult.navRemoved > 0) removedTypes.push('nav');
                if (aiSummaryCountResult.socialRemoved > 0) removedTypes.push('social');
                if (aiSummaryCountResult.deepRemoved > 0) removedTypes.push('deep');

                if (removedTypes.length === 1) {
                    aiSummaryCleansedReason = removedTypes[0] as ExtractResult['aiSummaryCleansedReason'];
                } else if (removedTypes.length > 1) {
                    aiSummaryCleansedReason = 'multiple';
                    aiSummaryCleansedReasons = removedTypes;
                }
            }
        }

        return { content, cleansedReason, hardStripRemoved, keywordStripRemoved, totalRemoved, pageBytes, candidateBytes, originalBytes, cleansedBytes, aiSummaryOriginalBytes, aiSummaryCleansedBytes, aiSummaryCleansedElements, aiSummaryCleansedReason, aiSummaryCleansedReasons, fallbackTriggered };
    }

    return content;
}