import type { MaskedItem } from '../messaging/types.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';

export interface ContentResponse {
  content: string;
  cleansedReason?: 'hard' | 'keyword' | 'both' | 'none';
  cleanseStats?: {
    hardStripRemoved: number;
    keywordStripRemoved: number;
    totalRemoved: number;
  };
  byteStats?: {
    pageBytes: number;
    candidateBytes: number;
    originalBytes: number;
    cleansedBytes: number;
  };
  aiSummaryCleansedStats?: {
    aiSummaryOriginalBytes: number;
    aiSummaryCleansedBytes: number;
    aiSummaryCleansedElements: number;
    aiSummaryCleansedReason: AiSummaryCleansedReason;
    aiSummaryCleansedReasons?: string[];
  };
}

export interface PreviewResponse {
  success: boolean;
  error?: string;
  reason?: string;
  headerValue?: string;
  processedContent: string;
  maskedItems?: (string | MaskedItem)[];
  maskedCount?: number;
}

export interface PendingSave {
  url: string;
  title: string;
  content: string;
  privacyData: PrivacyInfo | null;
}