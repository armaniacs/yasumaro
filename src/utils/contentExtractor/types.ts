/**
 * contentExtractor 型定義
 * ExtractResult インターフェースと CleanseCallback 型
 */

/**
 * クレンジング実行時のコールバック関数
 * @param {CleanseResult | null} result - クレンジング結果
 */
import type { CleanseResult } from '../contentCleaner.js';

export type CleanseCallback = (result: CleanseResult | null) => void;

/**
 * 抽出結果の型（コンテンツのみ、またはコンテンツとクレンジング情報）
 */
export interface ExtractResult {
    content: string;
    cleansedReason?: 'hard' | 'keyword' | 'both' | 'none';
    hardStripRemoved?: number;
    keywordStripRemoved?: number;
    totalRemoved?: number;
    pageBytes?: number;        // findMainContentCandidates() 前（body全体）のバイト数
    candidateBytes?: number;   // findMainContentCandidates() 後（候補要素）のバイト数
    originalBytes?: number;    // Content Cleansing前のバイト数
    cleansedBytes?: number;    // Content Cleansing後のバイト数
    aiSummaryOriginalBytes?: number;  // AI要約クレンジング前のバイト数
    aiSummaryCleansedBytes?: number;  // AI要約クレンジング後のバイト数
    aiSummaryCleansedElements?: number;  // AI要約クレンジングで削除した要素数
    aiSummaryCleansedReason?: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';  // AI要約クレンジング実行理由
    aiSummaryCleansedReasons?: string[];  // 複数理由の詳細リスト（multiple時）
    fallbackTriggered?: boolean;          // フォールバックが発動したか
}