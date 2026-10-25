/**
 * askHistoryHandlers.ts — ASK_HISTORY handler (PBI 2026-10-23-08).
 *
 * 履歴に聞く: FTS/LIKE evidence retrieval + local-only answer generation with
 * citations. 外部送信なし (mode 'local_only' forced on the AI seam), consent
 * re-read at admission, per-domain 'no-summary' exclusion at evidence
 * selection, evidence snippets come from the cleansed (already PII-masked)
 * content the recording path stored.
 *
 * BDD: 質問に引用付きで答える / 根拠がないときは作らず分からないと言う.
 */

import type { RecordingAdmit } from '../recordingAdmission.js';
import type { AISummaryOptions, AISummaryResult } from '../ai/AIService.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { AiDomainPolicy } from '../../utils/storage/types.js';
import { resolveAiDomainPolicy } from '../../utils/storage/aiDomainPolicy.js';
import { localDayRangeFromDateString } from '../../utils/localDate.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type {
  AskCollectionScope,
  AskHistoryResponse,
} from '../../messaging/responseCanonical.js';
import { normalizeCollectionScope } from '../../messaging/responseCanonical.js';
import {
  ASK_EVIDENCE_COUNT,
  assembleAskEvidence,
  buildEvidenceContext,
  buildWidenSuggestion,
  nameEvidenceGap,
} from '../askEvidence.js';

export { normalizeCollectionScope };
export { ASK_EVIDENCE_COUNT } from '../askEvidence.js';
export type { AskEvidence } from '../askEvidence.js';

/** Handler outcome: alias of the canonical wire response (single definition). */
export type AskHistoryOutcome = AskHistoryResponse;

/**
 * Search seam the handler reads evidence through (FTS/LIKE dispatching op,
 * same shape as the background SqliteClient's `kind: 'search'` query).
 */
export type AskHistorySearch = (op: {
  kind: 'search';
  text: string;
  limit?: number;
  offset?: number;
  orderBy?: 'rank' | 'created_at';
  orderDir?: 'ASC' | 'DESC';
}) => Promise<{ success: true; data: { rows: BrowsingLogRecord[]; total: number } } | { success: false; error: string }>;

/** AI answer seam — the handler always forces mode 'local_only'. */
export type AskHistoryGenerate = (
  content: string,
  options?: AISummaryOptions,
) => Promise<AISummaryResult>;

export interface AskHistoryHandlerDeps {
  /** Admission pre-stage: consent + settings + rate, behind one seam. */
  admit: RecordingAdmit;
  search: AskHistorySearch;
  generateAnswer: AskHistoryGenerate;
  /**
   * The saved collection the question targets (M2, BDD: 対象コレクションを
   * 選んだ). Returns the raw stored query; the handler narrows it to the
   * scope fields it applies. Null = the id is unknown (縮退の出口: the QA
   * falls back to an unscoped search instead of failing).
   */
  loadCollection: (id: string) => Promise<Record<string, unknown> | null>;
}

/**
 * ASK_HISTORY handler factory. Handler-local in-flight guard: one QA at a
 * time (the AI round-trip is the hot resource; repeat clicks while executing
 * are ignored). Consent re-read at admission; local-only forced on the AI
 * seam so the answer generation never reaches a remote provider.
 */
export function createAskHistoryHandler(deps: AskHistoryHandlerDeps) {
  let inFlight = false;

  return async (
    message: { type: 'ASK_HISTORY'; payload: { question: string; collectionId?: string | null } },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (inFlight) {
      sendResponse({ success: false, error: 'in_flight' });
      return;
    }
    inFlight = true;
    try {
      const admitted = await deps.admit('ask', sender);
      if ('rejected' in admitted) {
        // The admission seam reports `reason`, but the ASK_HISTORY wire
        // contract carries failures in `error` — forwarding `rejected`
        // verbatim drops the reason in the gateway normalizer and the panel
        // shows 'Invalid ASK_HISTORY response' (PBI 2026-10-25-12). Map it
        // so the panel shows WHY (consent/rate/paused); a blank reason
        // still falls back to the gateway sentence.
        sendResponse({ success: false, error: admitted.rejected.reason });
        return;
      }
      // The per-domain egress policy resolves from the admitted settings
      // snapshot (PBI 2026-10-23-01 の egress作法): 'no-summary' domains the
      // user opted out of AI processing are excluded at evidence selection.
      const resolveDomainPolicy = (url: string) => resolveAiDomainPolicy(admitted.settings, url);
      // The collection scope degrades to null for an unknown id (縮退の出口):
      // the QA falls back to an unscoped search instead of failing.
      const collectionId = message.payload.collectionId ?? null;
      const rawScope = collectionId !== null ? await deps.loadCollection(collectionId) : null;
      sendResponse(await runAsk(deps, message.payload.question, resolveDomainPolicy, normalizeCollectionScope(rawScope)));
    } catch (error: unknown) {
      sendResponse({ success: false, error: errorMessage(error) });
    } finally {
      inFlight = false;
    }
  };
}

/** Core ask flow, split from the guard so the guard cannot drift. */
async function runAsk(
  deps: AskHistoryHandlerDeps,
  question: string,
  resolveDomainPolicy: (url: string) => AiDomainPolicy,
  scope: AskCollectionScope,
): Promise<AskHistoryOutcome> {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    return { success: false, error: 'question_required' };
  }

  const searchResult = await deps.search({
    kind: 'search',
    text: trimmed,
    limit: ASK_EVIDENCE_COUNT * 10,
    offset: 0,
    orderBy: 'rank',
    orderDir: 'DESC',
  });
  if (!searchResult.success) {
    return { success: false, error: searchResult.error };
  }

  // The collection scope narrows the search rows post-hoc (the FTS/LIKE op
  // takes no tag/date params). An unscoped QA (no collection) keeps every row.
  const dayRange = scope.date !== null ? localDayRangeFromDateString(scope.date) : null;
  const { evidence, excludedNoSummary, scopedCount } = assembleAskEvidence({
    rows: searchResult.data.rows,
    scope,
    dayRange,
    resolveDomainPolicy,
  });
  if (evidence.length === 0) {
    const reason = nameEvidenceGap(evidence.length, excludedNoSummary, scopedCount);
    return {
      success: true,
      status: 'no_evidence',
      suggestion: buildWidenSuggestion(reason ?? 'no_matches'),
    };
  }

  // 外部送信なし: mode 'local_only' is forced — the FallbackAIService routes
  // this call to the on-device model only, never to a remote provider.
  const aiResult = await deps.generateAnswer(buildEvidenceContext(trimmed, evidence), {
    mode: 'local_only',
  });
  if (!aiResult.success || aiResult.summary.trim().length === 0) {
    return { success: false, error: aiResult.summary || 'ask_failed' };
  }
  return { success: true, status: 'answered', answer: aiResult.summary, citations: evidence };
}
