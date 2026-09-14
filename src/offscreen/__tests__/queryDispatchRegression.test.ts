// @vitest-environment jsdom
/**
 * queryDispatchRegression.test.ts (PBI 2026-09-14-01)
 *
 * Pins the search-vs-listing dispatch decision to queryPlanner.planQueryMode,
 * the single owner introduced to fix a duplicated `if (q.text)` branch across
 * OpfsWorkerBackend, IdbVfsBackend and storageFallback. This exact class of
 * bug shipped twice:
 *
 * - 4a1f6093: OPFS backend sent text search to the plain-listing worker
 *   handler (`QUERY`) instead of `SEARCH`, silently returning empty results.
 * - 43385d95: normalizeStorageQuery dropped `text`, so a search request
 *   reached backends already stripped of the field and fell through to
 *   plain listing.
 *
 * Both were "text search routed to plain listing" — this file freezes the
 * routing decision itself (planQueryMode / QuerySpec.mode) plus an
 * end-to-end check per backend that a `text` query never returns the plain
 * listing shape.
 */
import { describe, it, expect, vi } from 'vitest';
import { planQueryMode } from '../queryPlanner.js';
import { buildQuerySpec } from '../queryPlan.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { OpfsWorkerBackend } from '../OpfsWorkerBackend.js';
import { FallbackStorage } from '../storageFallback.js';

describe('planQueryMode — single dispatch decision (PBI 2026-09-14-01)', () => {
  it('a query with non-empty text is "search"', () => {
    expect(planQueryMode({ text: 'rust' })).toBe('search');
  });

  it('a query with no text (plain listing) is "listing"', () => {
    expect(planQueryMode({})).toBe('listing');
    expect(planQueryMode({ text: undefined })).toBe('listing');
  });

  it('a query with empty-string text is "listing" (matches prior `if (q.text)` truthiness)', () => {
    expect(planQueryMode({ text: '' })).toBe('listing');
  });

  it('buildQuerySpec.mode agrees with planQueryMode for the same query', () => {
    const searchSpec = buildQuerySpec({ text: 'rust', limit: 10 }, { fts5Available: true });
    expect(searchSpec.mode).toBe('search');
    expect(searchSpec.mode).toBe(planQueryMode({ text: 'rust', limit: 10 }));

    const listingSpec = buildQuerySpec({ domain: 'example.com', limit: 10 }, { fts5Available: true });
    expect(listingSpec.mode).toBe('listing');
    expect(listingSpec.mode).toBe(planQueryMode({ domain: 'example.com', limit: 10 }));
  });
});

describe('regression pin: 4a1f6093 — OPFS backend must route text search to SEARCH, not QUERY', () => {
  it('OpfsWorkerBackend.query sends the worker a SEARCH message type when q.text is set', async () => {
    const tryOpfsProxy = vi.fn(async (_type: string) => ({ rows: [], total: 0 }));
    const engine = { tryOpfsProxy } as unknown as ConstructorParameters<typeof OpfsWorkerBackend>[0];
    const backend = new OpfsWorkerBackend(engine);

    await backend.query({ text: 'rust', limit: 10 });
    expect(tryOpfsProxy).toHaveBeenCalledWith('SEARCH', expect.objectContaining({ text: 'rust' }));

    tryOpfsProxy.mockClear();
    await backend.query({ domain: 'example.com', limit: 10 });
    expect(tryOpfsProxy).toHaveBeenCalledWith('QUERY', expect.objectContaining({ domain: 'example.com' }));
  });
});

describe('regression pin: 43385d95 — a text query must never silently fall through to plain listing', () => {
  it('IdbVfsBackend.query builds a search (FTS/LIKE) statement, not the plain listing statement, when text is set', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const engine = {
      fts5Available: true,
      execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
        calls.push({ sql, params });
        if (callback && /SELECT COUNT/i.test(sql)) callback([0]);
      }),
    };
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};

    await backend.query({ text: 'rust', limit: 10 });

    const rowsSql = calls.find(c => /LIMIT \? OFFSET \?/.test(c.sql) && !/COUNT/i.test(c.sql))?.sql ?? '';
    // The bug class: a dropped/ignored `text` produces the plain listing SQL
    // (no browsing_logs_fts reference at all) instead of a MATCH search.
    expect(rowsSql).toContain('browsing_logs_fts');
    expect(rowsSql).toMatch(/MATCH \?/);
  });

  it('FallbackStorage.query applies the text filter, not the unfiltered plain-listing path, when text is set', async () => {
    const storage = new FallbackStorage();
    await storage.insert({ url: 'https://match.example.com', title: 'rust programming', created_at: 100 });
    await storage.insert({ url: 'https://nomatch.example.com', title: 'unrelated topic', created_at: 200 });

    const result = await storage.query({ text: 'rust', limit: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      // The bug class: text silently ignored would return both rows (total: 2).
      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].url).toBe('https://match.example.com');
    }
  });
});
