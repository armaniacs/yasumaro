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
 * Background-side collection scope (ASK_HISTORY): the V2 conditions the QA
 * applies to the evidence search. `clauses`/`op`/`ids` come straight from
 * `parseCollectionQueryV2` (PBI 2026-11-02-02) — the scope no longer
 * degrades a multi-clause query to a single tag/date. A legacy v1 shape
 * (`{ tag, date }`) migrates to one clause through the same parse, so
 * top-level tag/date collections keep working.
 *
 * `unresolvable` is the fail-closed latch: true when a stored query exists
 * but carries nothing the post-hoc filter can enforce (no tag/date clause
 * and no ids — e.g. a search-text-only or corrupted shape). The handler
 * answers with the unsupported-scope suggestion instead of an unbounded
 * search. Null (unknown id) stays unscoped — the 縮退の出口 where the QA
 * falls back to an unscoped search instead of failing.
 */
export interface AskResolvedClause {
  tag: string | null;
  date: string | null;
}

export interface AskCollectionScope {
  op: 'and' | 'or';
  clauses: AskResolvedClause[];
  ids: number[];
  unresolvable: boolean;
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

import { parseCollectionQueryV2 } from '../utils/collectionQueryV2.js';

/**
 * Collection scope normalizer (ASK_HISTORY): resolves the stored query
 * through `parseCollectionQueryV2` and keeps the enforceable per-clause
 * conditions (tag/date) plus the pinned ids. Per-clause `search` text is
 * not enforceable post-hoc (no per-clause fan-out — single question search
 * + V2 post-hoc, PBI 2026-11-02-02), so it is dropped here, not answered.
 *
 * Fail-closed: a non-null query with nothing enforceable (no tag/date
 * clause, no ids) latches `unresolvable` — the handler must not run an
 * unbounded search for it. Null (unknown id) stays unscoped.
 */
export function normalizeCollectionScope(raw: Record<string, unknown> | null): AskCollectionScope {
  const unscoped: AskCollectionScope = { op: 'and', clauses: [], ids: [], unresolvable: false };
  if (raw === null) return unscoped;
  const parsed = parseCollectionQueryV2(raw);
  const clauses: AskResolvedClause[] = parsed.clauses
    .filter((clause) => clause.tag !== null || clause.date !== null)
    .map((clause) => ({ tag: clause.tag, date: clause.date }));
  if (clauses.length === 0 && parsed.ids.length === 0) {
    return { op: 'and', clauses: [], ids: [], unresolvable: true };
  }
  return { op: parsed.op, clauses, ids: parsed.ids, unresolvable: false };
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
