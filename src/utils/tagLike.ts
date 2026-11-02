/**
 * tagLike.ts
 *
 * Canonical row-level tag predicate shared by every non-SQL path.
 *
 * Hoisted from src/offscreen/queryPlan.ts (PBI 2026-11-02-02): the
 * background ask-history post-hoc filter needs the exact SQL LIKE
 * semantics, but the background→offscreen import ban (see
 * readOnlyHandler.ts) forbids importing it from offscreen. This module
 * is the single owner — offscreen/queryPlan.ts re-exports it, so the
 * SQL generator's JS fallback and the background filter cannot drift.
 *
 * Policy (decided once, here — was prose-only "mirrors the SQL" while the
 * former client-side rule matched case-sensitively and treated commas as
 * separators, diverging from SQL `tags LIKE ?` on six concrete inputs):
 * - CASE: case-insensitive substring match (SQL `LIKE` folds ASCII case).
 * - COMMA: the raw tag text (including commas) is matched against the raw
 *   tags column — commas are NOT treated as separators. The SQL side
 *   `tags LIKE '%a,b%'` matches the identical row.
 * - WILDCARD: `%` and `_` are treated as wildcards (SQL `LIKE` semantics),
 *   not literals.
 * Rows with unset/non-string tags never match (existing rule).
 */
export function rowMatchesTagLike(tags: string | null | undefined, tagFilter: string): boolean {
  const tagsString = tags || '';
  if (typeof tagsString !== 'string' || !tagFilter) return false;
  // SQL LIKE wildcards → regex, escaping the rest of the pattern.
  const escaped = tagFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(pattern, 'i').test(tagsString);
}
