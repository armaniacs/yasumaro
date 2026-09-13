/**
 * Hop-contract tests for the text-search path (PBI 2026-09-12-43).
 *
 * Text search crosses four hops: dashboard buildSearchParams → background
 * deps.search → gateway kind:'search' → offscreen SQLITE_QUERY → planQuery.
 * A field dropped at any hop silently degraded text search to a plain
 * listing (the round-14 regression). These tests pin each hop's contract so
 * a dropped field fails at the hop that dropped it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hop 1: buildSearchParams (dashboard → background payload) ─────────────

import { buildSearchParams } from '../handlers/dashboardSqlite/readOnlyHandler.js';
import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';

describe('hop 1 — buildSearchParams maps query→text (PBI 2026-09-12-43)', () => {
  it('maps query to text and preserves limit/offset', () => {
    const payload = { subtype: 'search', query: '研究所', limit: 10, offset: 0 } as unknown as Extract<DashboardSqliteRequest, { subtype: 'search' }>;
    const params = buildSearchParams(payload);
    expect(params.text).toBe('研究所');
    expect(params.limit).toBe(10);
    expect(params.offset).toBe(0);
  });

  it('falls back to empty text when query is missing (plain listing)', () => {
    const payload = { subtype: 'search', limit: 10 } as unknown as Extract<DashboardSqliteRequest, { subtype: 'search' }>;
    const params = buildSearchParams(payload);
    expect(params.text).toBe('');
  });
});

// ── Hop 2: gateway kind:'search' → SQLITE_QUERY with text ─────────────────

import { OffscreenGateway } from '../sqlite/offscreenGateway.js';
import type { OffscreenTransport } from '../../offscreenTransport.js';

describe('hop 2 — gateway kind:search carries text into SQLITE_QUERY (PBI 2026-09-12-43)', () => {
  let sentPayloads: Array<Record<string, unknown>> = [];
  let transport: OffscreenTransport;

  beforeEach(() => {
    sentPayloads = [];
    const fakeTransport = {
      msgOffscreen: async (type: string, payload: Record<string, unknown> = {}) => {
        sentPayloads.push({ type, ...payload });
        if (type === 'SQLITE_QUERY') {
          return { success: true, rows: [], total: 0 };
        }
        return { success: true };
      },
    } as unknown as OffscreenTransport;
    transport = fakeTransport;
  });

  it('kind:search sends SQLITE_QUERY with text preserved', async () => {
    const gateway = new OffscreenGateway(transport);
    await gateway.query({ kind: 'search', text: '研究所', limit: 10, offset: 0 });

    const queryMsg = sentPayloads.find((p) => p.type === 'SQLITE_QUERY');
    expect(queryMsg).toBeDefined();
    expect(queryMsg!.text).toBe('研究所');
  });

  it('drops text when it is an empty string (plain listing contract)', async () => {
    const gateway = new OffscreenGateway(transport);
    await gateway.query({ kind: 'search', text: '', limit: 10, offset: 0 });

    const queryMsg = sentPayloads.find((p) => p.type === 'SQLITE_QUERY');
    expect(queryMsg).toBeDefined();
    expect(queryMsg!.text).toBe('');
  });
});

// ── Hop 3: planQuery preserves text (offscreen → backend) ─────────────────

import { planQuery } from '../../offscreen/queryPlanner.js';

describe('hop 3 — planQuery preserves text (PBI 2026-09-12-43)', () => {
  it('text survives normalization + read policy', () => {
    const planned = planQuery({ text: '研究所', limit: 10, offset: 0 });
    expect(planned.text).toBe('研究所');
  });

  it('text survives alongside other filters (combined search)', () => {
    const planned = planQuery({
      text: '研究所',
      domain: 'example.com',
      starred: true,
      orderBy: 'rank',
      orderDir: 'DESC',
      limit: 10,
    });
    expect(planned.text).toBe('研究所');
    expect(planned.domain).toBe('example.com');
    expect(planned.orderBy).toBe('rank');
  });
});
