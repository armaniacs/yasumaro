/**
 * researchReportGateway.ts
 *
 * PBI 2026-10-23-09: 調査レポート一発生成の dashboard 送信路。askHistoryGateway
 * と同じ作法: sendWithPolicy の envelope + timeout + normalize に一任し、
 * このモジュールは transport を知らない。
 *
 * Timeout contract: report generation fetches the selection rows, builds the
 * Markdown and downloads it. One round-trip, no retries — a repeat click shows
 * the failure reason instead of racing the in-flight report.
 */

import { sendWithPolicy } from './sendWithPolicy.js';
import type { ResponseForType } from './types.js';

export const RESEARCH_REPORT_TIMEOUT_MS = 60_000;
/** Sentinel so callers can map the timeout to a localized message. */
export const RESEARCH_REPORT_TIMEOUT_ERROR = 'Research report request timed out';

export interface ResearchReportParams {
  scope?: {
    search?: string;
    tag?: string;
    since?: number;
    until?: number;
  };
  sendToObsidian?: boolean;
}

type ResearchReportResponse = ResponseForType<'EXPORT_RESEARCH_REPORT'>;

export async function exportResearchReport(params: ResearchReportParams): Promise<ResearchReportResponse> {
  return sendWithPolicy(
    {
      type: 'EXPORT_RESEARCH_REPORT',
      payload: params,
    },
    {
      timeoutMs: RESEARCH_REPORT_TIMEOUT_MS,
      timeoutError: new Error(RESEARCH_REPORT_TIMEOUT_ERROR),
      retries: 0,
      normalize: normalizeResearchReportResponse,
    },
  );
}

function normalizeResearchReportResponse(raw: unknown): ResearchReportResponse {
  if (raw && typeof raw === 'object' && 'success' in raw && typeof (raw as { success: unknown }).success === 'boolean') {
    return raw as ResearchReportResponse;
  }
  return { success: false, error: RESEARCH_REPORT_TIMEOUT_ERROR };
}
