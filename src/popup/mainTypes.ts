import type { PrivacyInfo } from '../utils/privacyChecker.js';

// 本体は messaging 層（`../messaging/types.js`）が所有する。ここは既存の
// popup 経由 import を壊さないための type-only 再エクスポートのみ
// （PBI 2026-09-21-11: popup と messaging の型循環を解消）。
// 応答契約 SSOT（PBI 2026-10-05-30）: PreviewResponse は RecordingResult の
// 別名とし、processedContent 必須化などの手書き差分は持たない。
export type { ContentResponse, RecordingResult, RecordingResult as PreviewResponse } from '../messaging/types.js';

export interface PendingSave {
  url: string;
  title: string;
  content: string;
  privacyData: PrivacyInfo | null;
}