/**
 * responseCanonical.ts — canonical owner of ask/report response shapes.
 *
 * The ASK_HISTORY and EXPORT_RESEARCH_REPORT response unions used to be
 * defined twice: once as the messaging wire type (`types.ts`) and once as
 * the background outcome (`AskHistoryOutcome` in askHistoryHandlers.ts,
 * `ResearchReportOutcome` in researchReportGenerator.ts). The twins had
 * identical members, so a shape change needed edits in both places and
 * nothing failed when they drifted. This module is the single definition:
 * handlers alias it and return it directly, views receive it directly.
 *
 * It also owns the scope-shaping rules both the validators and the
 * handlers apply: the trimmed-string / finite-number readers plus the
 * report scope field tables. `normalizeCollectionScope` and
 * `normalizeReportScope` are the only normalizers; validators check with
 * the same tables and handlers no longer re-inspect.
 *
 * Placement record (ADR 2026-09-25 precedent): this module imports nothing
 * from background — it is pure (no chrome, no storage) — and background
 * plus dashboard import from messaging. That is the forward direction
 * (background -> messaging), so no reverse-dependency exception applies.
 * `types.ts` keeps type-only re-exports so existing import paths work.
 */

/** One citation the answer links back to (BDD: 元記録に飛べる). */
export interface AskHistoryCitation {
  id: number;
  title: string;
  url: string;
  snippet: string;
}

/**
 * Canonical ASK_HISTORY wire response. A discriminated union so success
 * and failure narrow apart. A record-less question answers with status
 * 'no_evidence' plus a widening suggestion instead of a fabricated answer.
 */
export type AskHistoryResponse =
  | { success: true; status: 'answered'; answer: string; citations: AskHistoryCitation[] }
  | { success: true; status: 'no_evidence'; suggestion: string }
  | { success: false; error: string };

/**
 * Canonical EXPORT_RESEARCH_REPORT wire response. A discriminated union
 * so success and failure narrow apart. A failure carries the reason in
 * error, never a fake success.
 */
export type ResearchReportResponse =
  | { success: true; recordCount: number; deliveredTo: Array<'download' | 'obsidian'> }
  | { success: false; error: string };

/**
 * Background-side collection scope (ASK_HISTORY): the tag and date fields
 * the QA applies to the evidence search. Unknown shapes degrade to null
 * (縮退の出口) — the recall-path parse stays owned by the dashboard's
 * savedCollectionQuery module; this shape holds only the scope fields the
 * background is allowed to apply.
 */
export interface AskCollectionScope {
  tag: string | null;
  date: string | null;
}

/**
 * Report scope (EXPORT_RESEARCH_REPORT): the panel conditions (PBI 06
 * collection shape). Absent fields mean unscoped; an empty scope is a
 * whole-history report, which the generator caps.
 */
export interface ResearchReportScope {
  search?: string;
  tag?: string;
  since?: number;
  until?: number;
}

/** String fields of the report scope (single table for validator + normalizer). */
export const REPORT_SCOPE_STRING_FIELDS = ['search', 'tag'] as const;

/** Number fields of the report scope (single table for validator + normalizer). */
export const REPORT_SCOPE_NUMBER_FIELDS = ['since', 'until'] as const;

/**
 * Single trimmed-string reader: a non-blank string trims, everything else
 * (non-strings, blank strings) degrades to null. Shared by the collection
 * and report normalizers so blank handling cannot drift between them.
 */
export function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Single finite-number reader: a finite number passes through, everything
 * else degrades to null. Shared by the report normalizer (and the
 * validator's positive path) so NaN/Infinity handling stays single-owned.
 */
export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Collection scope normalizer (ASK_HISTORY): reads only the tag/date
 * fields the background applies. Unknown shapes degrade to nulls.
 */
export function normalizeCollectionScope(raw: Record<string, unknown> | null): AskCollectionScope {
  if (raw === null) return { tag: null, date: null };
  return { tag: readTrimmedString(raw.tag), date: readTrimmedString(raw.date) };
}

/**
 * Report scope normalizer (EXPORT_RESEARCH_REPORT): keeps only the fields
 * that are actually set. Non-object inputs degrade to the empty scope.
 */
export function normalizeReportScope(raw: unknown): ResearchReportScope {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const scope: ResearchReportScope = {};
  for (const field of REPORT_SCOPE_STRING_FIELDS) {
    const trimmed = readTrimmedString(source[field]);
    if (trimmed !== null) scope[field] = trimmed;
  }
  for (const field of REPORT_SCOPE_NUMBER_FIELDS) {
    const value = readFiniteNumber(source[field]);
    if (value !== null) scope[field] = value;
  }
  return scope;
}
