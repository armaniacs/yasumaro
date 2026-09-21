import type { MaskedItem } from '../messaging/types.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';

// 本体は messaging 層（`../messaging/types.js`）が所有する。ここは既存の
// popup 経由 import を壊さないための type-only 再エクスポートのみ
// （PBI 2026-09-21-11: popup と messaging の型循環を解消）。
export type { ContentResponse } from '../messaging/types.js';

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