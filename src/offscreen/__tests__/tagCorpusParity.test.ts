import { describe, it, expect } from 'vitest';
import { rowMatchesTagLike, tagMatchesFilter } from '../queryPlan.js';

/**
 * Tag-corpus test — the executable contract for cross-backend tag semantics
 * (PBI 2026-09-12-40). The six inputs below are the cases where the fallback
 * JS predicate diverged from SQL `tags LIKE ?` before `rowMatchesTagLike`
 * unified them. The SQL side's semantics are the source of truth.
 */
describe('tag corpus — cross-backend parity (PBI 2026-09-12-40)', () => {
  it.each([
    ['case', 'AI', 'ai tools', true],
    ['comma', 'a,b', 'a,b', true],
    ['wildcard %', 'a%b', 'axxb', true],
    ['wildcard _', 'a_b', 'axb', true],
    ['whitespace padding', ' ai ', 'has ai tools', true],
    ['plain', 'runes', 'has #runes tag', true],
  ])('%s: tag=%s matches row=%s', (_label, tag, tags, expected) => {
    expect(rowMatchesTagLike(tags, tag)).toBe(expected);
  });

  it('non-matching rows still do not match', () => {
    expect(rowMatchesTagLike('other tools', 'runes')).toBe(false);
    expect(rowMatchesTagLike(null, 'runes')).toBe(false);
    expect(rowMatchesTagLike(undefined, 'runes')).toBe(false);
    expect(rowMatchesTagLike('', '')).toBe(false);
  });

  // PBI 2026-09-12-42: Japanese corpus — CJK trigram/LIKE boundary cases.
  it('Japanese 4-char tag matches via SQL-parity predicate', () => {
    expect(rowMatchesTagLike('大学 入試', '大学入試')).toBe(false); // SQL: %大学入試% needs contiguous
    expect(rowMatchesTagLike('筑波大学の入試', '筑波大学')).toBe(true);
  });

  it('Japanese 2-char tag matches (LIKE path boundary)', () => {
    expect(rowMatchesTagLike('大学 入試', '入試')).toBe(true);
    expect(rowMatchesTagLike('レシピ集', 'レシピ')).toBe(true);
  });

  it('Japanese rows with ASCII tags fold case like SQL LIKE (PBI 2026-09-12-42)', () => {
    // SQL LIKE folds ASCII case; CJK chars have no case to fold. This pins
    // that the predicate folds ASCII within a CJK-containing row without
    // breaking the CJK part.
    expect(rowMatchesTagLike('研究 AI tools', 'AI')).toBe(true);
    expect(rowMatchesTagLike('研究 ai tools', 'AI')).toBe(true);
  });

  it('documented policy: wildcards expand, case folds, commas are literal', () => {
    // These three assertions ARE the policy decision (PBI 2026-09-12-40):
    expect(rowMatchesTagLike('axxb', 'a%b')).toBe(true);   // % = any sequence
    expect(rowMatchesTagLike('a.b', 'a_b')).toBe(true);    // _ = any char
    expect(rowMatchesTagLike('AI tools', 'ai')).toBe(true); // case-insensitive
    // Commas inside the filter are literal (SQL `LIKE '%a,b%'` parity)
    expect(rowMatchesTagLike('x, a,b, y', 'a,b')).toBe(true);
  });
});

describe('tagMatchesFilter — legacy comma-split semantics preserved for direct callers', () => {
  it('keeps the legacy behavior (documented divergence from rowMatchesTagLike)', () => {
    // Legacy: comma-split + case-sensitive includes. Direct callers that
    // explicitly want this keep working; the fallback read path no longer
    // uses it (rowMatchesTagLike is SQL-parity).
    expect(tagMatchesFilter('typescript,testing', 'test')).toBe(true);
    expect(tagMatchesFilter('rust', 'test')).toBe(false);
  });
});
