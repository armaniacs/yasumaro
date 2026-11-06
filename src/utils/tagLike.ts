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
  return compileTagLikePattern(tagFilter).test(tagsString);
}

/**
 * S-#4: bounded LIKE→RegExp cache. The predicate runs per row × per clause,
 * so the same filter string recompiled every call. The compiled pattern
 * depends only on the filter text (`i` flag, no `lastIndex` state since
 * there is no `g` flag), so sharing is behavior-preserving.
 *
 * Bounded FIFO (insertion order): an unbounded Map would let a caller
 * flood memory with distinct tag strings, so the oldest entry is evicted
 * past the cap. Eviction only costs a recompile — never a wrong answer.
 */
const TAG_LIKE_PATTERN_CACHE_MAX_SIZE = 64;

const patternCache = new Map<string, RegExp>();
let patternCompilations = 0;
let patternCacheHits = 0;

function compileTagLikePattern(tagFilter: string): RegExp {
  const cached = patternCache.get(tagFilter);
  if (cached !== undefined) {
    patternCacheHits += 1;
    return cached;
  }
  // SQL LIKE wildcards → regex, escaping the rest of the pattern.
  const escaped = tagFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  const compiled = new RegExp(pattern, 'i');
  if (!patternCache.has(tagFilter) && patternCache.size >= TAG_LIKE_PATTERN_CACHE_MAX_SIZE) {
    const oldest = patternCache.keys().next().value;
    if (oldest !== undefined) patternCache.delete(oldest);
  }
  patternCache.set(tagFilter, compiled);
  patternCompilations += 1;
  return compiled;
}

/**
 * Test-only stats seam for the S-#4 cache (deterministic measurement, no
 * wall-clock): compilations counts RegExp constructions, hits counts cache
 * reuses, size counts retained patterns.
 */
export function tagLikeCacheStatsForTests(): { size: number; compilations: number; hits: number } {
  return { size: patternCache.size, compilations: patternCompilations, hits: patternCacheHits };
}

/** Test-only reset for the pattern cache and its counters. */
export function clearTagLikeCacheForTests(): void {
  patternCache.clear();
  patternCompilations = 0;
  patternCacheHits = 0;
}
