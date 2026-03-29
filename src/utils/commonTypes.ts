/**
 * commonTypes.ts
 * 共通型定義
 * 複数のモジュールで使用される型定義を集約
 */

/**
 * 記録方式
 * - auto: 自動記録（訪問条件を満たして自動的に記録）
 * - manual: 手動記録（「今すぐ記録」ボタンで記録）
 */
export type RecordType = 'auto' | 'manual';

/**
 * AI要約クレンジング実行理由
 */
export type AiSummaryCleansedReason = 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';