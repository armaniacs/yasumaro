import { describe, it, expect } from 'vitest';
import { buildListParams, buildSearchParams } from '../readOnlyHandler.js';
import { QUERY_CAPS } from '../../../../messaging/limits.js';
import type { DashboardSqliteRequest } from '../../dashboardSqliteProtocol.js';

/**
 * readOnlyProjection-pins.test.ts (PBI 2026-09-21-20)
 *
 * Pins the projection-only contract of the two read paths: limit passes
 * through RAW (undefined included) — cap/default policy is owned by the
 * offscreen planner seam (planQuery default 100 / planSearch default 50)
 * since the background pre-clamp was removed. The offscreen side pins its
 * own defaults in offscreen/__tests__/queryPlanner.test.ts.
 */
describe('readOnly projection pins — projection-only (post PBI 2026-09-21-20)', () => {
  type ListPayload = Extract<DashboardSqliteRequest, { subtype: 'query' }>;
  type SearchPayload = Extract<DashboardSqliteRequest, { subtype: 'search' }>;

  describe('plain path — buildListParams', () => {
    it('documents the planner-owned caps this projection no longer enforces', () => {
      // The planner seam (applyReadPolicy + buildQuerySpec) clamps with these.
      expect(QUERY_CAPS.plain).toBe(10000);
      expect(QUERY_CAPS.fts).toBe(100000);
    });

    it('passes an absent limit through as undefined (planner applies its default)', () => {
      const params = buildListParams({ subtype: 'query' } as ListPayload);
      expect(params).toMatchObject({
        limit: undefined,
        offset: 0,
        orderBy: 'created_at',
        orderDir: 'DESC',
      });
    });

    it('passes raw limits through untouched (over-cap included — planner clamps)', () => {
      expect(buildListParams({ subtype: 'query', limit: 999999 } as ListPayload).limit).toBe(999999);
    });

    it('passes garbage limits through untouched (planner clampLimit falls back)', () => {
      for (const bad of [0, -5, NaN, 0.5, Infinity]) {
        expect(buildListParams({ subtype: 'query', limit: bad } as ListPayload).limit).toBe(bad);
      }
    });

    it('passes in-cap limits through untouched', () => {
      expect(buildListParams({ subtype: 'query', limit: 5000 } as ListPayload).limit).toBe(5000);
    });

    it('projects the alias fields (domain/isStarred/since/until/tagFilter)', () => {
      const params = buildListParams({
        subtype: 'query',
        limit: 10,
        offset: 3,
        domain: 'example.com',
        isStarred: true,
        since: 1000,
        until: 2000,
        tagFilter: 'news',
      } as ListPayload);
      expect(params).toMatchObject({
        limit: 10,
        offset: 3,
        domain: 'example.com',
        isStarred: true,
        since: 1000,
        until: 2000,
        tagFilter: 'news',
      });
    });
  });

  describe('fts path — buildSearchParams', () => {
    it('maps query to text and passes an absent limit through as undefined', () => {
      const { text, limit, offset, options } = buildSearchParams({
        subtype: 'search',
        query: 'hello',
      } as SearchPayload);
      expect(text).toBe('hello');
      expect(limit).toBeUndefined();
      expect(offset).toBe(0);
      expect(options).toEqual({});
    });

    it('passes raw limits through untouched (over-cap included — planner clamps)', () => {
      const { limit } = buildSearchParams({
        subtype: 'search',
        query: 'hello',
        limit: 1e9,
      } as SearchPayload);
      expect(limit).toBe(1e9);
    });

    it('passes garbage limits through untouched (planner clampLimit falls back)', () => {
      for (const bad of [0, -5, NaN, 0.5, Infinity]) {
        const { limit } = buildSearchParams({
          subtype: 'search',
          query: 'q',
          limit: bad,
        } as SearchPayload);
        expect(limit).toBe(bad);
      }
    });

    it('passes in-cap limits and order options through', () => {
      const { limit, offset, options } = buildSearchParams({
        subtype: 'search',
        query: 'q',
        limit: 20,
        offset: 4,
        orderBy: 'rank',
        orderDir: 'ASC',
      } as SearchPayload);
      expect(limit).toBe(20);
      expect(offset).toBe(4);
      expect(options).toEqual({ orderBy: 'rank', orderDir: 'ASC' });
    });
  });
});
