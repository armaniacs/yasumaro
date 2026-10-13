import { describe, it, expect, vi } from 'vitest';
import { verifyRequestToken } from '../index.js';
import { buildListParams, buildSearchParams } from '../readOnlyHandler.js';
import type { DashboardSqliteRequest } from '../../../messaging/dashboardSqliteProtocol.js';

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

  it('ignores legacy getConfirmToken and fails closed', async () => {
    const getConfirmToken = vi.fn().mockResolvedValue('tok');
    const ok = await verifyRequestToken({ getConfirmToken } as never, 'delete', payload());
    expect(ok).toBe(false);
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
  it('builds the dashboard-hop list shape (order/paging defaults pass through — the planner seam owns them)', () => {
    const params = buildListParams({ subtype: 'query' } as ListPayload);
    expect(params.limit).toBeUndefined();
    expect(params.offset).toBeUndefined();
    // PBI 2026-10-10-08: absent orderBy/orderDir are omitted (pickDefined) —
    // the offscreen planner applies created_at / DESC.
    expect('orderBy' in params).toBe(false);
    expect('orderDir' in params).toBe(false);
  });

  it('passes raw list limits through untouched (planner clamps)', () => {
    const params = buildListParams({ subtype: 'query', limit: 999999 } as ListPayload);
    expect(params.limit).toBe(999999);
  });

  it('builds the search shape with text mapping (limit passes through — planner default 50)', () => {
    const { text, limit, offset, options } = buildSearchParams({
      subtype: 'search',
      query: 'hello',
    } as SearchPayload);
    expect(text).toBe('hello');
    expect(limit).toBeUndefined();
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
