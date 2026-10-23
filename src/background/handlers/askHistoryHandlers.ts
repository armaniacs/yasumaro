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
  AskHistoryCitation,
  AskHistoryResponse,
} from '../../messaging/responseCanonical.js';
import { normalizeCollectionScope } from '../../messaging/responseCanonical.js';

export { normalizeCollectionScope };

/** Evidence rows carried back with the answer (BDD: 根拠3件のリンク). */
export const ASK_EVIDENCE_COUNT = 3;
/** Snippet cap per evidence row — the context the local model reads. */
export const ASK_SNIPPET_MAX_CHARS = 500;

/** One evidence row: the citation the answer links back to (元記録に飛べる). Shape single-sourced from the wire type. */
export type AskEvidence = AskHistoryCitation;

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
 * Evidence selection (PBI 2026-10-23-08): top rows from the search result,
 * skipping rows whose domain the user opted out of AI processing
 * ('no-summary'). Snippets come from the cleansed content the recording path
 * stored (already PII-masked), falling back to the AI summary then the title
 * — the never-raw rule: whatever the QA sends to the model was cleansed
 * before it was persisted.
 */
export function pickEvidenceRows(
  rows: BrowsingLogRecord[],
  resolveDomainPolicy: (url: string) => AiDomainPolicy,
  maxCount: number = ASK_EVIDENCE_COUNT,
): { evidence: AskEvidence[]; excludedNoSummary: number } {
  const evidence: AskEvidence[] = [];
  let excludedNoSummary = 0;
  for (const row of rows) {
    if (evidence.length >= maxCount) break;
    // Fail-closed: an evidence row must be linkable (元記録に飛べる) — a
    // row without an id is not a real DB row, so it is not evidence.
    if (row.id === undefined) continue;
    if (resolveDomainPolicy(row.url) === 'no-summary') {
      excludedNoSummary += 1;
      continue;
    }
    const snippet = truncateSnippet(firstCleansedText(row), ASK_SNIPPET_MAX_CHARS);
    if (snippet === null) {
      // No cleansed text to quote — an evidence row must quote something
      // (the never-raw rule). Skipped without counting as an exclusion.
      continue;
    }
    evidence.push({
      id: row.id,
      title: row.title ?? row.url,
      url: row.url,
      snippet,
    });
  }
  return { evidence, excludedNoSummary };
}

/**
 * First cleansed text worth quoting: cleansed content, then the AI summary.
 * Both are persisted post-cleansing, so the QA never quotes raw page text.
 */
function firstCleansedText(row: BrowsingLogRecord): string | null {
  if (row.content !== null && row.content !== undefined && row.content.trim().length > 0) {
    return row.content;
  }
  if (row.summary !== null && row.summary !== undefined && row.summary.trim().length > 0) {
    return row.summary;
  }
  return null;
}

/** Snippet truncation (単体: 打ち切り) — long cleansed text is cut, never wrapped. */
export function truncateSnippet(text: string | null, maxChars: number): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.substring(0, maxChars)}…`;
}

/**
 * The prompt the local model reads: the question, then each evidence excerpt
 * with its citation number. The instruction is fail-closed — no evidence
 * means 分からない, never a fabricated answer.
 */
export function buildEvidenceContext(question: string, evidence: AskEvidence[]): string {
  const excerpts = evidence
    .map((row, index) => `[${index + 1}] ${row.title}\nURL: ${row.url}\n${row.snippet}`)
    .join('\n\n');
  return [
    '以下の閲覧記録の抜粋だけ根拠にして質問に答えてください。',
    '根拠にないことは答えず、根拠が足りない場合は「分かりません」と述べてください。',
    `質問: ${question}`,
    '',
    '記録の抜粋:',
    excerpts,
  ].join('\n');
}

/**
 * No-evidence suggestion (BDD: 対象の広げ方を提案する). Named from data the
 * panel already holds — no fabrication of what the user might have meant.
 */
export function buildWidenSuggestion(reason: 'no_matches' | 'no_quotable' | 'domain_excluded'): string {
  if (reason === 'no_matches') {
    return '該当する記録がありません。検索語を短くするか、タグフィルターや期間を広げてください。';
  }
  if (reason === 'no_quotable') {
    return '引用できる本文がありません。要約が生成された記録を対象にしてください。';
  }
  return '対象ドメインがAI処理の対象外に設定されているため、引用できる記録がありません。';
}

/**
 * Collection scope post-filter (PBI 2026-10-23-08): the FTS/LIKE search op
 * takes no tag/date params, so the collection narrows the evidence rows
 * post-hoc — tag membership and the local day range from the collection's
 * saved date. Rows outside the scope are dropped before evidence selection.
 */
export function matchesCollectionScope(
  row: BrowsingLogRecord,
  scope: AskCollectionScope,
  dayRange: { since: number; until: number } | null,
): boolean {
  if (scope.tag !== null) {
    const tags = row.tags ?? '';
    if (!tags.split(',').some((t) => t.trim() === scope.tag)) return false;
  }
  if (dayRange !== null) {
    if (row.created_at < dayRange.since || row.created_at > dayRange.until) return false;
  }
  return true;
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
        sendResponse(admitted.rejected);
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
  const scopedRows = searchResult.data.rows.filter((row) => matchesCollectionScope(row, scope, dayRange));

  const { evidence, excludedNoSummary } = pickEvidenceRows(scopedRows, resolveDomainPolicy);
  if (evidence.length === 0) {
    const reason = excludedNoSummary > 0 ? 'domain_excluded' : (scopedRows.length > 0 ? 'no_quotable' : 'no_matches');
    return { success: true, status: 'no_evidence', suggestion: buildWidenSuggestion(reason) };
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
