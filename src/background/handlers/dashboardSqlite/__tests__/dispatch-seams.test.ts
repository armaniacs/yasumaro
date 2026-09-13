import { describe, it, expect, vi } from 'vitest';
import { verifyRequestToken } from '../index.js';
import { buildListParams, buildSearchParams } from '../readOnlyHandler.js';
import type { DashboardSqliteRequest } from '../../dashboardSqliteProtocol.js';

/**
 * dispatch-seams.test.ts (PBI 2026-09-11-07 spike slice)
 *
 * Pins the two extracted validation/projection seams of the
 * dashboard→offscreen route: verifyRequestToken (3 branches) and the
 * read param builders (exact dashboard-hop shape).
 */
describe('verifyRequestToken — validation branches', () => {
  const payload = (overrides: Record<string, unknown> = {}) =>
    ({ subtype: 'delete', confirmToken: 'tok', id: 7, ...overrides }) as DashboardSqliteRequest & {
      confirmToken?: string;
    };

  it('verifies via the scoped verifier when present', async () => {
    const verifyConfirmToken = vi.fn().mockResolvedValue(true);
    const ok = await verifyRequestToken({ verifyConfirmToken } as never, 'delete', payload());
    expect(ok).toBe(true);
    // 'delete' carries no archive scope — the verifier receives undefined scopeHash.
    expect(verifyConfirmToken).toHaveBeenCalledWith('tok', 'delete', 7, undefined);
  });

  it('falls back to the legacy getConfirmToken comparison', async () => {
    const getConfirmToken = vi.fn().mockResolvedValue('tok');
    const ok = await verifyRequestToken({ getConfirmToken } as never, 'delete', payload());
    expect(ok).toBe(true);
  });

  it('fails closed without a token', async () => {
    const verifyConfirmToken = vi.fn();
    const ok = await verifyRequestToken(
      { verifyConfirmToken } as never,
      'delete',
      payload({ confirmToken: undefined }),
    );
    expect(ok).toBe(false);
    expect(verifyConfirmToken).not.toHaveBeenCalled();
  });

  it('fails closed without any verifier', async () => {
    const ok = await verifyRequestToken({} as never, 'delete', payload());
    expect(ok).toBe(false);
  });
});

describe('buildListParams / buildSearchParams — read projection', () => {
  type ListPayload = Extract<DashboardSqliteRequest, { subtype: 'query' }>;
  type SearchPayload = Extract<DashboardSqliteRequest, { subtype: 'search' }>;
  it('builds the dashboard-hop list shape with per-surface caps and defaults', () => {
    const params = buildListParams({ subtype: 'query' } as ListPayload);
    expect(params).toMatchObject({
      limit: 100,
      offset: 0,
      orderBy: 'created_at',
      orderDir: 'DESC',
    });
  });

  it('clamps list limits to the plain cap', () => {
    const params = buildListParams({ subtype: 'query', limit: 999999 } as ListPayload);
    expect(params.limit).toBeLessThanOrEqual(100000);
  });

  it('builds the search shape with the fts cap', () => {
    const { text, limit, offset, options } = buildSearchParams({
      subtype: 'search',
      query: 'hello',
    } as SearchPayload);
    expect(text).toBe('hello');
    expect(limit).toBe(50);
    expect(offset).toBe(0);
    expect(options).toEqual({});
  });

  it('passes search order options through', () => {
    const { options } = buildSearchParams({
      subtype: 'search',
      query: 'q',
      orderBy: 'rank',
      orderDir: 'ASC',
    } as SearchPayload);
    expect(options).toEqual({ orderBy: 'rank', orderDir: 'ASC' });
  });
});
