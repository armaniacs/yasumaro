/**
 * responseRepack.ts — seam repack of wire responses into view models.
 *
 * The panel used to repack ASK_HISTORY / EXPORT_RESEARCH_REPORT results
 * into view shapes with inline spreads in `sqliteHistoryPanel.ts`
 * (askQuestion / generateReport), while each view defined its own copy of
 * the result types. This module is the single repack site on the seam:
 * the panel delegates to it, and the views receive its types directly.
 * Pure mapping only — message translation (i18n) stays with the caller,
 * which passes its own `translateError` for the ask path (the report path
 * surfaces the raw reason, as before).
 */

import type {
  AskHistoryCitation,
  AskHistoryResponse,
  ResearchReportResponse,
} from './responseCanonical.js';
import type { SendFailure } from './sendWithPolicy.js';

/** Outcome of one ask run, as the view paints it. */
export interface AskRunResult {
  ok: boolean;
  error?: string;
  status?: 'answered' | 'no_evidence';
  answer?: string;
  suggestion?: string;
  citations?: AskHistoryCitation[];
}

/** Outcome of one report run, as the view paints it. */
export interface ReportRunResult {
  ok: boolean;
  error?: string;
  recordCount?: number;
  deliveredTo?: Array<'download' | 'obsidian'>;
}

/**
 * Repack an ask wire result into the view model: a failure early-returns,
 * no_evidence reads only the suggestion, answered reads only answer plus
 * citations. Field access narrows on the canonical union, so a shape drift
 * fails to compile here first.
 */
export function toAskRunResult(
  result: AskHistoryResponse | SendFailure,
  translateError: (error: string) => string,
): AskRunResult {
  if (result.success === false) {
    return { ok: false, error: translateError(result.error ?? '') };
  }
  if (result.status === 'no_evidence') {
    return result.suggestion !== undefined
      ? { ok: true, status: 'no_evidence', suggestion: result.suggestion }
      : { ok: true, status: 'no_evidence' };
  }
  const citations = result.citations;
  return {
    ok: true,
    status: 'answered',
    ...(result.answer !== undefined ? { answer: result.answer } : {}),
    ...(citations !== undefined ? { citations } : {}),
  };
}

/**
 * Repack a report wire result into the view model: a failure carries the
 * raw reason (no translation, as before), a success carries the count and
 * the delivery paths that actually completed.
 */
export function toReportRunResult(result: ResearchReportResponse | SendFailure): ReportRunResult {
  if (result.success === false) {
    return { ok: false, error: result.error ?? '' };
  }
  const recordCount = result.recordCount;
  const deliveredTo = result.deliveredTo;
  return {
    ok: true,
    ...(recordCount !== undefined ? { recordCount } : {}),
    ...(deliveredTo !== undefined ? { deliveredTo } : {}),
  };
}
