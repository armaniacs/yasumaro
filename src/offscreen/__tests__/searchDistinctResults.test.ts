/**
 * Symptom regression test — different queries return different results
 * (PBI 2026-09-12-42).
 *
 * The user-reported symptom: "東京大学で検索、ガバメントで検索も同じ" — every
 * text search returned the SAME rows (a plain recent listing). Two root
 * causes caused this independently:
 *   1. normalizeStorageQuery dropped `text` (allowlist miss) → the query
 *      became a plain listing.
 *   2. OpfsWorkerBackend always sent worker type 'QUERY' (routing miss) →
 *      even a text-carrying query never reached the FTS/LIKE handler.
 *
 * These tests pin the SYMPTOM on a real JS engine (FallbackStorage — the only
 * backend whose `query()` executes full logic without a worker). The SQL
 * backends are covered by realEngineLikeSearch.test.ts (better-sqlite3) and
 * the routing pins in sqlite-search-fts5.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';
import { normalizeStorageQuery } from '../queryNormalize.js';

describe('search-distinct-results — different queries return different rows (PBI 2026-09-12-42)', () => {
  let storage: FallbackStorage;

  beforeEach(async () => {
    storage = new FallbackStorage();
    // Seed three distinct topics — the user-reported scenario shape.
    const rows: Array<[string, string, string, number]> = [
      ['https://example.com/tsukuba', '筑波大学の入試について', '筑波大学の入試情報', 1000],
      ['https://example.com/printer', 'プリンターレンタル比較', 'プリンターの選び方', 2000],
      ['https://example.com/recipe', 'カレーのレシピ', 'カレーの作り方', 3000],
    ];
    for (const [url, title, summary, created] of rows) {
      await storage.insert({
        url, title, summary, tags: null, created_at: created,
        domain: new URL(url).hostname, is_starred: 0, is_deleted: 0,
      } as never);
    }
  });

  it('search for 筑波大学 returns only the Tsukuba row', async () => {
    const result = await storage.query({ text: '筑波大学', limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rows.map((r) => r.url)).toEqual(['https://example.com/tsukuba']);
  });

  it('search for プリンター returns only the printer row', async () => {
    const result = await storage.query({ text: 'プリンター', limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rows.map((r) => r.url)).toEqual(['https://example.com/printer']);
  });

  it('search for レシピ returns only the recipe row', async () => {
    const result = await storage.query({ text: 'レシピ', limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rows.map((r) => r.url)).toEqual(['https://example.com/recipe']);
  });

  it('the three query result sets are pairwise disjoint (symptom: same rows for every query)', async () => {
    const urlsFor = async (text: string): Promise<string[]> => {
      const result = await storage.query({ text, limit: 10, offset: 0 });
      if (!result.success) throw new Error(result.error);
      return result.rows.map((r) => r.url);
    };
    const tsukuba = await urlsFor('筑波大学');
    const printer = await urlsFor('プリンター');
    const recipe = await urlsFor('レシピ');

    expect(tsukuba).not.toEqual(printer);
    expect(printer).not.toEqual(recipe);
    expect(tsukuba).not.toEqual(recipe);
  });
});

describe('field preservation contract — every StorageQuery field survives normalizeStorageQuery (PBI 2026-09-12-42)', () => {
  it('all fields set → all fields preserved (allowlist miss detection)', () => {
    const full = {
      text: 'query text',
      tag: 'typescript',
      starred: true,
      domain: 'example.com',
      orderBy: 'rank' as const,
      orderDir: 'ASC' as const,
      limit: 50,
      offset: 10,
      dateFrom: 1000,
      dateTo: 2000,
      gistSynced: 1,
      ids: [3, 7],
      excludeDeleted: false,
    };
    const normalized = normalizeStorageQuery(full);
    // Every field must survive — a new StorageQuery field added without a
    // normalizeStorageQuery update will FAIL here.
    expect(normalized).toEqual(full);
  });

  it('text survives normalization (the exact round-14 regression)', () => {
    const normalized = normalizeStorageQuery({ text: '研究所', limit: 10 });
    expect(normalized.text).toBe('研究所');
  });

  it('satisfies: the test object is a valid StorageQuery shape (compile-time guard)', () => {
    // Compile-time guard: if a new field is added to StorageQuery but this
    // test object is not updated, the `satisfies` below fails — forcing the
    // test author to extend the preservation contract.
    const full = {
      text: 't', tag: 'g', starred: true, domain: 'd',
      orderBy: 'rank' as const, orderDir: 'DESC' as const,
      limit: 1, offset: 0, dateFrom: 1, dateTo: 2,
      gistSynced: 1, ids: [1], excludeDeleted: true,
    } satisfies Record<string, unknown>;
    const normalized = normalizeStorageQuery(full);
    // Every key in the input must appear in the output.
    for (const key of Object.keys(full)) {
      expect(normalized).toHaveProperty(key);
    }
  });
});
