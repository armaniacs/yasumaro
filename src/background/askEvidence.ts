/**
 * askEvidence.ts — independent pure module for ASK_HISTORY evidence shaping.
 *
 * Owns the single rows-to-evidence operation: collection-scope matching,
 * evidence selection with the 'no-summary' exclusion, snippet truncation
 * under the never-raw rule (cleansed text only), context assembly for the
 * local model, and the no-evidence widening suggestion.
 *
 * No chrome, no storage, no network — every export is pure. The handler
 * (`handlers/askHistoryHandlers.ts`) delegates to `assembleAskEvidence`
 * and never re-implements the sequence.
 */

import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import type { AiDomainPolicy } from '../utils/storage/types.js';
import type {
  AskCollectionScope,
  AskHistoryCitation,
} from '../messaging/responseCanonical.js';

/** Evidence rows carried back with the answer (BDD: links to source records). */
export const ASK_EVIDENCE_COUNT = 3;
/** Snippet cap per evidence row — the context the local model reads. */
export const ASK_SNIPPET_MAX_CHARS = 500;

/** One evidence row: the citation the answer links back to. */
export type AskEvidence = AskHistoryCitation;

/** Closed day range derived from the collection scope date. */
export interface AskEvidenceDayRange {
  since: number;
  until: number;
}

/** Policy reader: resolves the per-domain AI processing policy for a URL. */
export type AskEvidencePolicyReader = (url: string) => AiDomainPolicy;

/** Input to the single rows-to-evidence operation. */
export interface AssembleAskEvidenceInput {
  rows: BrowsingLogRecord[];
  scope: AskCollectionScope;
  dayRange: AskEvidenceDayRange | null;
  resolveDomainPolicy: AskEvidencePolicyReader;
  maxCount?: number;
}

/** Output of the single rows-to-evidence operation. */
export interface AssembleAskEvidenceResult {
  evidence: AskEvidence[];
  excludedNoSummary: number;
  scopedCount: number;
}

/** No-evidence reason named from data the panel already holds. */
export type AskEvidenceGapReason = 'no_matches' | 'no_quotable' | 'domain_excluded';

/**
 * Single rows-to-evidence interface: narrows the row set by the collection
 * scope, then selects quotable evidence rows. Truncation and the
 * 'no-summary' exclusion happen inside the selection step.
 */
export function assembleAskEvidence(input: AssembleAskEvidenceInput): AssembleAskEvidenceResult {
  const maxCount = input.maxCount ?? ASK_EVIDENCE_COUNT;
  const scopedRows = input.rows.filter((row) =>
    matchesCollectionScope(row, input.scope, input.dayRange),
  );
  const { evidence, excludedNoSummary } = pickEvidenceRows(
    scopedRows,
    input.resolveDomainPolicy,
    maxCount,
  );
  return { evidence, excludedNoSummary, scopedCount: scopedRows.length };
}

/**
 * Evidence selection: top rows from the search result, skipping rows whose
 * domain the user opted out of AI processing ('no-summary'). Snippets come
 * from the cleansed content the recording path stored (already PII-masked),
 * falling back to the AI summary then the title — the never-raw rule:
 * whatever the QA sends to the model was cleansed before it was persisted.
 */
export function pickEvidenceRows(
  rows: BrowsingLogRecord[],
  resolveDomainPolicy: AskEvidencePolicyReader,
  maxCount: number = ASK_EVIDENCE_COUNT,
): { evidence: AskEvidence[]; excludedNoSummary: number } {
  const evidence: AskEvidence[] = [];
  let excludedNoSummary = 0;
  for (const row of rows) {
    if (evidence.length >= maxCount) break;
    // Fail-closed: an evidence row must be linkable — a row without an id
    // is not a real DB row, so it is not evidence.
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

/** Snippet truncation — long cleansed text is cut, never wrapped. */
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
 * means no answer, never a fabricated one.
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
 * No-evidence suggestion. Named from data the panel already holds — no
 * fabrication of what the user might have meant.
 */
export function buildWidenSuggestion(reason: AskEvidenceGapReason): string {
  if (reason === 'no_matches') {
    return '該当する記録がありません。検索語を短くするか、タグフィルターや期間を広げてください。';
  }
  if (reason === 'no_quotable') {
    return '引用できる本文がありません。要約が生成された記録を対象にしてください。';
  }
  return '対象ドメインがAI処理の対象外に設定されているため、引用できる記録がありません。';
}

/**
 * Names the no-evidence reason from the assembly result: excluded domains
 * first, then unquotable rows, then no rows at all.
 */
export function nameEvidenceGap(
  evidenceCount: number,
  excludedNoSummary: number,
  scopedCount: number,
): AskEvidenceGapReason | null {
  if (evidenceCount > 0) return null;
  if (excludedNoSummary > 0) return 'domain_excluded';
  if (scopedCount > 0) return 'no_quotable';
  return 'no_matches';
}

/**
 * Collection scope post-filter: the FTS/LIKE search op takes no tag/date
 * params, so the collection narrows the evidence rows post-hoc — tag
 * membership and the local day range from the collection's saved date.
 * Rows outside the scope are dropped before evidence selection.
 */
export function matchesCollectionScope(
  row: BrowsingLogRecord,
  scope: AskCollectionScope,
  dayRange: AskEvidenceDayRange | null,
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
