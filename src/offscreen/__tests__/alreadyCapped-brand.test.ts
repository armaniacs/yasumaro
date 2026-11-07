import { describe, expect, it } from 'vitest';
import type { StorageQuery } from '../../utils/sqlite-types.js';
import { MAX_QUERY_LIMIT, QUERY_CAPS } from '../../utils/limits.js';
import {
  buildQuerySpec,
  DEFAULT_QUERY_LIMIT,
  planQueryMode,
  selectReadCap,
  type AlreadyCappedQuery,
} from '../queryPlan.js';
import { applyReadPolicy, applySearchPolicy, planQuery, planQueryOrSearch, planSearch } from '../queryPlanner.js';
import { FTS_QUERY_MAX_LENGTH } from '../schema.js';
import type { Queryable } from '../StorageBackend.js';

/**
 * alreadyCapped-brand.test.ts (PBI 2026-11-07-05)
 *
 * Pin test for the read-policy brand: AlreadyCappedQuery values are created
 * ONLY through the sanctioned creation point (applyReadPolicy; planQuery /
 * planSearch / planQueryOrSearch delegate to it), and uncapped queries cannot
 * reach SQL assembly (buildQuerySpec takes AlreadyCappedQuery only).
 *
 * The guard is type-level (the unique-symbol brand is erased at runtime), so
 * the negative pins use @ts-expect-error: each directive becomes an "unused
 * directive" compile error the day the guard disappears. That is the RED
 * tripwire for the PBI 07 consolidation. No production-code change here.
 */
describe('alreadyCapped-brand', () => {
  describe('applyReadPolicy', () => {
    it('clamps an over-cap limit and returns a value buildQuerySpec accepts', () => {
      const capped: AlreadyCappedQuery = applyReadPolicy({ limit: 1e9, text: 'hello' });
      expect(capped.limit).toBe(MAX_QUERY_LIMIT);
      const spec = buildQuerySpec(capped);
      expect(spec.limit).toBeLessThanOrEqual(QUERY_CAPS.plain);
      expect(spec.mode).toBe('search');
    });

    it('truncates overlong tag and text to FTS_QUERY_MAX_LENGTH', () => {
      const capped = applyReadPolicy({
        limit: 10,
        tag: 'a'.repeat(FTS_QUERY_MAX_LENGTH + 10),
        text: 'b'.repeat(FTS_QUERY_MAX_LENGTH + 10),
      });
      expect(capped.tag).toHaveLength(FTS_QUERY_MAX_LENGTH);
      expect(capped.text).toHaveLength(FTS_QUERY_MAX_LENGTH);
    });

    it('falls back to the default limit for a non-positive limit', () => {
      expect(applyReadPolicy({ limit: -5 }).limit).toBe(DEFAULT_QUERY_LIMIT);
    });
  });

  describe('sanctioned creation paths', () => {
    it('planQuery normalizes aliases then applies the read policy', () => {
      const planned: AlreadyCappedQuery = planQuery({ isStarred: 1, since: '2000', limit: 999999 });
      expect(planned).toMatchObject({ starred: true, dateFrom: 2000, limit: MAX_QUERY_LIMIT });
      expect(buildQuerySpec(planned).limit).toBeLessThanOrEqual(QUERY_CAPS.plain);
    });

    it('planSearch applies the same policy with the search page-size default', () => {
      const planned: AlreadyCappedQuery = planSearch({ query: 'hello' });
      expect(planned.text).toBe('hello');
      expect(planned.limit).toBe(50);
      expect(buildQuerySpec(planned).mode).toBe('search');
    });

    it('planQueryOrSearch routes kind:search through the search policy', () => {
      const search: AlreadyCappedQuery = planQueryOrSearch({ kind: 'search', query: 'hi' });
      expect(search.limit).toBe(50);
      const listing: AlreadyCappedQuery = planQueryOrSearch({});
      expect(listing.limit).toBe(DEFAULT_QUERY_LIMIT);
      expect(buildQuerySpec(listing).mode).toBe('listing');
    });

    it('normalizes before clamping and truncating', () => {
      const planned = planQuery({
        tagFilter: 'a'.repeat(FTS_QUERY_MAX_LENGTH + 5),
        limit: '999999999',
      });
      expect(planned.tag).toHaveLength(FTS_QUERY_MAX_LENGTH);
      expect(planned.limit).toBe(MAX_QUERY_LIMIT);
    });
  });

  describe('planQueryMode dispatch', () => {
    it('routes text queries to search and empty or absent text to listing', () => {
      expect(planQueryMode({ text: 'hello' })).toBe('search');
      expect(planQueryMode({})).toBe('listing');
      expect(planQueryMode({ text: '' })).toBe('listing');
    });
  });

  describe('selectReadCap', () => {
    it('returns the FTS cap for FTS searches and the plain cap otherwise', () => {
      expect(selectReadCap(true)).toBe(QUERY_CAPS.fts);
      expect(selectReadCap(false)).toBe(QUERY_CAPS.plain);
    });
  });

  describe('uncapped queries cannot reach SQL assembly', () => {
    it('rejects a direct object literal as AlreadyCappedQuery at type level', () => {
      // @ts-expect-error — the brand only comes from applyReadPolicy; a literal has none
      const forged: AlreadyCappedQuery = { limit: 10 };
      expect(forged.limit).toBe(10);
    });

    it('rejects an uncapped StorageQuery at the buildQuerySpec boundary', () => {
      const uncapped: StorageQuery = { limit: 10, text: 'hello' };
      // @ts-expect-error — uncapped query must not reach SQL assembly
      buildQuerySpec(uncapped);
      expect(uncapped.limit).toBe(10);
    });

    it('accepts the same query once it passes the read policy', () => {
      const uncapped: StorageQuery = { limit: 10, text: 'hello' };
      const capped: AlreadyCappedQuery = applyReadPolicy(uncapped);
      const spec = buildQuerySpec(capped);
      expect(spec.limit).toBe(10);
      expect(spec.mode).toBe('search');
    });

    it('applySearchPolicy clamps through the planner-owned cap without conferring the brand', () => {
      const clamped = applySearchPolicy({ text: 'a fairly long search phrase here', limit: 1e9 }, true);
      expect(clamped.limit).toBe(QUERY_CAPS.fts);
      // @ts-expect-error — applySearchPolicy returns StorageQuery, not AlreadyCappedQuery
      const forged: AlreadyCappedQuery = clamped;
      expect(forged.limit).toBe(QUERY_CAPS.fts);
    });
  });

  describe('Queryable facet boundary', () => {
    it('keeps SQL assembly brand-gated while the facet signature takes StorageQuery', () => {
      type QueryParam = Parameters<Queryable['query']>[0];
      const wire: QueryParam = { limit: 5, text: 'hi' };
      const planned: AlreadyCappedQuery = applyReadPolicy(wire);
      expect(buildQuerySpec(planned).mode).toBe('search');
      // @ts-expect-error — the facet type still takes uncapped StorageQuery; the SQL gate does not
      buildQuerySpec(wire);
    });
  });
});
