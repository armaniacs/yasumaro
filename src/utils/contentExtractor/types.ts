/**
 * contentExtractor 型定義
 * ExtractResult インターフェースと CleanseCallback 型
 */

/**
 * クレンジング実行時のコールバック関数
 * @param {CleanseResult | null} result - クレンジング結果
 */
import type { CleanseResult } from '../contentCleaner.js';
import type { AiSummaryCleansedReason } from '../commonTypes.js';

export type CleanseCallback = (result: CleanseResult | null) => void;

/**
 * フォールバック発動理由
 */
export type FallbackReason = 'short_content' | 'over_cleansed';

/**
 * AI要約クレンジング実行結果
 */
export interface AiSummaryCleanseRunResult {
    originalBytes: number;     // AI要約クレンジング前のバイト数
    cleansedBytes: number;     // AI要約クレンジング後のバイト数
    reason: ExtractResult['aiSummaryCleansedReason'];  // 実行理由
    reasons: string[];         // 複数理由の詳細リスト
    elements: number;          // 削除した要素数
    preCleanseText: string;    // クレンジング前のテキスト（フォールバック用）
    removed?: Record<string, number>; // ルール別削除数（30-14）
}

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
    aiSummaryCleansedReason?: AiSummaryCleansedReason;  // AI要約クレンジング実行理由
    aiSummaryCleansedReasons?: string[];  // 複数理由の詳細リスト（multiple時）
    fallbackTriggered?: boolean;          // フォールバックが発動したか
    fallbackReason?: FallbackReason;      // フォールバック発動理由（triggered 時のみ）
    whitelistAdapterUsed?: string;       // 発動したホワイトリストアダプタ名（未発動時はundefined）
    whitelistFallbackTriggered?: boolean; // ホワイトリスト抽出0件によりブラックリスト方式にフォールバックしたか
    // 30-14: 観測性ファネル — ルール別削除件数と3段階バイトファネル
    removedByReason?: Map<string, number>;
    funnel?: { pageBytes: number; candidateBytes: number; cleansedBytes: number };
    // 30-11: 二重ペイロード — クレンジング前の原文保持と有効フラグ
    originalContent?: string;
    dualPayloadEnabled?: boolean;
    /**
     * 実際に要素を削除した Content Cleansing が実行されたか。
     * 診断 recount（countCleanseTargets が totalRemoved を埋めるだけ）では
     * セットされない — badge 通知の発火条件として kernel が参照する。
     */
    cleansingExecuted?: boolean;
}