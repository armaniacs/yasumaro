import { describe, it, expect } from 'vitest';
import { planQuery, planSearch, applyReadPolicy, DEFAULT_QUERY_LIMIT } from '../queryPlanner.js';
import { MAX_QUERY_LIMIT } from '../../messaging/limits.js';
import { FTS_QUERY_MAX_LENGTH } from '../schema.js';

/**
 * queryPlanner.test.ts (PBI 2026-09-11-05)
 *
 * Pins the single read-policy seam: normalize -> clamp -> truncate.
 * Previously split between sqliteMessageHandlers (normalize) and
 * recordsRepo.query (clamp/truncate) — these tests cross the seam so a
 * policy drift in either direction fails here.
 */
describe('queryPlanner — read policy composition', () => {
  it('planQuery collapses wire aliases then clamps the limit', () => {
    expect(planQuery({ isStarred: 1, since: '2000', limit: 999999 })).toMatchObject({
      starred: true,
      dateFrom: 2000,
      limit: MAX_QUERY_LIMIT,
    });
  });

  it('planQuery defaults an absent limit and drops unknown keys', () => {
    const planned = planQuery({ tagFilter: 'news', bogus: 'x' });
    expect(planned.limit).toBe(DEFAULT_QUERY_LIMIT);
    expect(planned).toMatchObject({ tag: 'news' });
    expect(planned).not.toHaveProperty('bogus');
  });

  it('planQuery truncates overlong tag input to the FTS cap', () => {
    const planned = planQuery({ tag: 'a'.repeat(FTS_QUERY_MAX_LENGTH + 50) });
    expect(planned.tag).toHaveLength(FTS_QUERY_MAX_LENGTH);
  });

  it('planSearch carries the free-text query alongside normalized filters', () => {
    const planned = planSearch({ query: 'hello world', tag: 'news', limit: 5 });
    expect(planned).toMatchObject({ text: 'hello world', tag: 'news', limit: 5 });
  });

  it('planSearch truncates overlong free text to the FTS cap', () => {
    const planned = planSearch({ query: 'q'.repeat(FTS_QUERY_MAX_LENGTH + 10) });
    expect(planned.text).toHaveLength(FTS_QUERY_MAX_LENGTH);
  });

  it('applyReadPolicy is idempotent (handler + repo both route through it)', () => {
    const once = applyReadPolicy({ limit: 7, tag: 'news', text: 'hi' });
    expect(applyReadPolicy(once)).toEqual(once);
  });

  it('applyReadPolicy bounds wire ids via normalize (no giant IN clause)', () => {
    const planned = planQuery({ ids: Array.from({ length: 500 }, (_, i) => i) });
    expect(planned.ids!.length).toBeLessThanOrEqual(200);
  });
});
