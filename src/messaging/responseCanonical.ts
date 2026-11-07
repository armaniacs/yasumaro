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
import { parseCollectionQueryV2 } from '../utils/collectionQueryV2.js';
import { MAX_QUERY_IDS, VALIDATOR_LIMITS } from '../utils/limits.js';

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
  /**
   * True when the stored query carried per-clause text-search conditions
   * that the post-hoc filter cannot enforce (C-#4): the FTS/LIKE search op
   * takes no per-clause text params, so search text is dropped here, not
   * answered. The handler discloses it (askSearchDroppedNote) instead of
   * answering as if the full collection applied.
   */
  searchDropped: boolean;
}

/**
 * Report scope (EXPORT_RESEARCH_REPORT): the panel conditions (PBI 06
 * collection shape). Absent fields mean unscoped; an empty scope is a
 * whole-history report, which the generator caps.
 *
 * V2 (PBI 2026-11-02-04): a multi-clause collection resolves to `op` +
 * `clauses` plus the pinned `ids`. A legacy v1/single collection keeps the
 * flat `search`/`tag`/`since`/`until` shape (no `clauses` key) so existing
 * callers and pins are unaffected. UNION semantics (PBI decision): the final
 * record set is mergeClauseResults(clauseResults, op) UNION ids.
 */
export interface ResearchReportClause {
  search?: string;
  tag?: string;
  since?: number;
  until?: number;
}

export interface ResearchReportScope {
  search?: string;
  tag?: string;
  since?: number;
  until?: number;
  /** Pinned record ids (V2 pin留め): UNION members, missing ones excluded. */
  ids?: number[];
  /** Clause combinator for `clauses` (V2 multi-clause collections). */
  op?: 'and' | 'or';
  /** Per-clause conditions (V2 multi-clause collections). */
  clauses?: ResearchReportClause[];
}

/** String fields of the report scope (single table for validator + normalizer). */
export const REPORT_SCOPE_STRING_FIELDS = ['search', 'tag'] as const;

/** Number fields of the report scope (single table for validator + normalizer). */
export const REPORT_SCOPE_NUMBER_FIELDS = ['since', 'until'] as const;

/** Array fields of the report scope (single table for validator + normalizer). */
export const REPORT_SCOPE_ARRAY_FIELDS = ['ids'] as const;

/**
 * Report scope field policy (PBI 2026-11-08-07): the reject/absorb intent
 * split is a parameter, not two traversals. 'reject' is the validator gate
 * (a bad value is a wire-contract violation); 'absorb' is the normalizer
 * gate (a bad value degrades to absent). Length is absorbed, element type
 * is rejected - pinned on both sides.
 */
export type ReportScopeFieldPolicy = 'reject' | 'absorb';

/** Scope field kinds, one per canonical field table. */
export type ReportScopeFieldKind = 'string' | 'number' | 'array';

/**
 * Reject-side string predicate (adapter target for
 * ExportResearchReportValidator): a scope string field must be a string.
 * Blank handling stays absorb-side (readTrimmedString degrades blanks to
 * null); the length cap is checked by isReportScopeStringWithinCap.
 */
export function isReportScopeStringValue(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Reject-side string cap predicate: a scope string field must fit the wire
 * cap. The default cap is the same VALIDATOR_LIMITS constant the validator
 * interpolates into its rejection text, so wording and bound cannot drift.
 */
export function isReportScopeStringWithinCap(
  value: string,
  cap: number = VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH,
): boolean {
  return value.length <= cap;
}

/**
 * Reject-side number predicate: a scope number field must be a finite
 * number. Shared with the absorb-side reader (readFiniteNumber) so
 * NaN/Infinity handling stays single-owned.
 */
export function isReportScopeFiniteNumberValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reject-side id predicate: a scope id entry must be a non-negative
 * integer (rowids - floats/negatives can never match, so they are rejected
 * on the wire and filtered out on the absorb side).
 */
export function isReportScopeIdValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Reject-side ids shape predicate: the ids field must be an array when
 * present. Length is NOT judged here - an over-long pin list is absorbed
 * (truncated) by the normalizer, never rejected.
 */
export function isReportScopeIdListValue(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * The ONE traversal over the canonical scope field tables (PBI 2026-11-08-07).
 * Both the validator (policy 'reject') and the normalizer (policy 'absorb')
 * walk the same tables through this function, so adding a field is a table
 * row plus policy handling - never a new loop. The policy parameter is
 * fail-closed: an unknown policy throws instead of silently picking a side.
 * `op` / `clauses` are not scope fields and stay normalizer-owned.
 */
export function forEachReportScopeField(
  source: Record<string, unknown>,
  policy: ReportScopeFieldPolicy,
  visit: (field: string, kind: ReportScopeFieldKind, value: unknown) => void,
): void {
  if (policy !== 'reject' && policy !== 'absorb') {
    throw new Error(`Unknown report scope policy: ${String(policy)}`);
  }
  for (const field of REPORT_SCOPE_STRING_FIELDS) visit(field, 'string', source[field]);
  for (const field of REPORT_SCOPE_NUMBER_FIELDS) visit(field, 'number', source[field]);
  for (const field of REPORT_SCOPE_ARRAY_FIELDS) visit(field, 'array', source[field]);
}

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
  const unscoped: AskCollectionScope = { op: 'and', clauses: [], ids: [], unresolvable: false, searchDropped: false };
  if (raw === null) return unscoped;
  const parsed = parseCollectionQueryV2(raw);
  // C-#4: any stored search text is unenforceable post-hoc, so its presence
  // latches the disclosure flag even when tag/date/ids survive.
  const searchDropped = parsed.clauses.some((clause) => clause.search !== '');
  const clauses: AskResolvedClause[] = parsed.clauses
    .filter((clause) => clause.tag !== null || clause.date !== null)
    .map((clause) => ({ tag: clause.tag, date: clause.date }));
  if (clauses.length === 0 && parsed.ids.length === 0) {
    return { op: 'and', clauses: [], ids: [], unresolvable: true, searchDropped };
  }
  return { op: parsed.op, clauses, ids: parsed.ids, unresolvable: false, searchDropped };
}

/**
 * Report scope normalizer (EXPORT_RESEARCH_REPORT): keeps only the fields
 * that are actually set. Non-object inputs degrade to the empty scope.
 * V2 (PBI 2026-11-02-04): `ids` keeps finite numbers only, capped at
 * MAX_QUERY_IDS (an over-long pin list is truncated, never rejected —
 * report-side absorption, unlike save path B); `op` keeps 'and'/'or';
 * `clauses` keeps per-clause trimmed-string / finite-number conditions and
 * drops fully-empty clauses.
 */
export function normalizeReportScope(raw: unknown): ResearchReportScope {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const scope: ResearchReportScope = {};
  // Absorb side of the single traversal (policy 'absorb'): bad values
  // degrade to absent, never throw. The reject side lives in
  // ExportResearchReportValidator, which walks the same tables with the
  // same predicates but policy 'reject'.
  forEachReportScopeField(source, 'absorb', (field, kind, value) => {
    if (value === undefined) return;
    if (kind === 'string') {
      const trimmed = readTrimmedString(value);
      if (trimmed !== null) scope[field as (typeof REPORT_SCOPE_STRING_FIELDS)[number]] = trimmed;
    } else if (kind === 'number') {
      const num = readFiniteNumber(value);
      if (num !== null) scope[field as (typeof REPORT_SCOPE_NUMBER_FIELDS)[number]] = num;
    } else {
      // C-#8: rowids are non-negative integers - floats/negatives degrade
      // to absent, matching the validator's rejection and the parse-side cap.
      const ids = isReportScopeIdListValue(value) ? value.filter(isReportScopeIdValue) : [];
      if (ids.length > 0) scope[field as (typeof REPORT_SCOPE_ARRAY_FIELDS)[number]] = ids.slice(0, MAX_QUERY_IDS);
    }
  });
  const op = source['op'];
  if (op === 'and' || op === 'or') scope.op = op;
  const clauses = source['clauses'];
  if (Array.isArray(clauses)) {
    const kept: ResearchReportClause[] = [];
    for (const entry of clauses) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const clause: ResearchReportClause = {};
      const search = readTrimmedString(record['search']);
      if (search !== null) clause.search = search;
      const tag = readTrimmedString(record['tag']);
      if (tag !== null) clause.tag = tag;
      const since = readFiniteNumber(record['since']);
      if (since !== null) clause.since = since;
      const until = readFiniteNumber(record['until']);
      if (until !== null) clause.until = until;
      if (Object.keys(clause).length > 0) kept.push(clause);
    }
    if (kept.length > 0) scope.clauses = kept;
  }
  return scope;
}
