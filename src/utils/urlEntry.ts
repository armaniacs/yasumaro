/**
 * urlEntry.ts
 * URLエントリ関連の型定義と定数
 */

import type { RecordType, AiSummaryCleansedReason } from './commonTypes.js';

// URL set size limit constants
export const MAX_URL_SET_SIZE = 10000;
export const URL_WARNING_THRESHOLD = 8000;
export const URL_RETENTION_DAYS = 7;
// contentフィールドを保持するエントリ数（最新N件のみ保持してストレージを節約）
export const MAX_CONTENT_ENTRIES = 10;

/**
 * クレンジング実行理由
 */
export type CleansedReason = 'hard' | 'keyword' | 'both' | 'none';

/**
 * 保存されたURLエントリ
 */
export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: RecordType;
    maskedCount?: number;
    tags?: string[];  // タグリスト（オプション）
    content?: string;  // 抽出されたコンテンツ（クレンジング後）
    cleansedReason?: CleansedReason;  // クレンジング実行理由
    aiSummary?: string;  // AI要約（オプション）
    sentTokens?: number;  // 送信トークン数（オプション）
    receivedTokens?: number;  // 受信トークン数（オプション）
    originalTokens?: number;  // 元のトークン数（オプション）
    cleansedTokens?: number;  // クレンジング後のトークン数（オプション）
    pageBytes?: number;       // findMainContentCandidates() 前のバイト数（オプション）
    candidateBytes?: number;  // findMainContentCandidates() 後のバイト数（オプション）
    originalBytes?: number;   // 元のバイト数（オプション）
    cleansedBytes?: number;   // クレンジング後のバイト数（オプション）
    aiSummaryOriginalBytes?: number;  // AI要約クレンジング前のバイト数（オプション）
    aiSummaryCleansedBytes?: number;  // AI要約クレンジング後のバイト数（オプション）
    aiSummaryCleansedElements?: number;  // AI要約クレンジングで削除した要素数（オプション）
    aiSummaryCleansedReason?: AiSummaryCleansedReason;  // AI要約クレンジング実行理由（オプション）
    aiSummaryCleansedReasons?: string[];  // 複数理由の詳細リスト（multiple時、オプション）
    fallbackTriggered?: boolean;          // NEW: フォールバックが発動したか
    extractedSentencesBytes?: number;  // L0抽出後のバイト数（オプション）
    extractedSentencesOriginalBytes?: number;  // L0抽出前のバイト数（オプション）
    isTrancoDomain?: boolean;  // Tranco信頼ドメインが使用されたか（Phase 1）
    aiProvider?: string;  // 使用したAIプロバイダー名（オプション）
    aiModel?: string;     // 使用したAIモデル名（オプション）
    aiDuration?: number;        // AI処理にかかった時間（ミリ秒、オプション）
    obsidianDuration?: number;  // Obsidian保存にかかった時間（ミリ秒、オプション）
}