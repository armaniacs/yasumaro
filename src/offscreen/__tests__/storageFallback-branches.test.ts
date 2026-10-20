/**
 * storageFallback-branches.test.ts
 * Targets branches in storageFallback.ts not exercised by the existing
 * storageFallback / storageFallback-comprehensive / storageFallback-search-sort
 * suites: quota purge, invalid orderBy error path, legacy is_starred param
 * handling, search-cache hits, compareField null handling, and purgeContent
 * count-based purge with includeStarred variations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';

function makeRecord(overrides: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return {
    url: 'https://example.com/page',
    created_at: Date.now(),
    title: 'Test Page',
    summary: 'Test summary',
    ...overrides,
  };
}

let storage: FallbackStorage;

beforeEach(async () => {
  storage = new FallbackStorage();
  await storage.clearAll();
});

// ── ensureQuotaSpace: over-limit purge path (line 54 else branch) ──────

describe('FallbackStorage quota management', () => {
  it('purges oldest records when bytes in use exceed the quota threshold', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.insert(makeRecord({ url: `https://q${i}.com`, created_at: i + 1 }));
    }

    const getBytesSpy = (
      vi.spyOn(chrome.storage.local, 'getBytesInUse') as unknown as {
        mockResolvedValueOnce: (v: number) => { mockRestore: () => void };
      }
    ).mockResolvedValueOnce(6 * 1024 * 1024); // over 5MB threshold on next insert's ensureQuotaSpace call

    const result = await storage.insert(makeRecord({ url: 'https://new.com', created_at: 999 }));
    expect(result.success).toBe(true);

    const all = await storage.getAllRecords();
    // purgeCount = max(1, floor(5 * 0.1)) = 1 oldest record removed, then new one inserted
    expect(all.length).toBe(5);
    expect(all.some(r => r.url === 'https://q0.com')).toBe(false);

    getBytesSpy.mockRestore();
  });

  it('does not purge when bytes in use are within the quota threshold', async () => {
    await storage.insert(makeRecord({ url: 'https://ok.com', created_at: 1 }));
    (vi.spyOn(chrome.storage.local, 'getBytesInUse') as unknown as {
      mockResolvedValueOnce: (v: number) => void;
    }).mockResolvedValueOnce(100);

    const result = await storage.insert(makeRecord({ url: 'https://ok2.com', created_at: 2 }));
    expect(result.success).toBe(true);

    const all = await storage.getAllRecords();
    expect(all.length).toBe(2);
  });
});

// ── quota purge ordering (PBI 2026-10-18-13) ────────────────────────────
// The quota trim runs only AFTER the dedupe check and only when the write
// actually lands, exempts `is_starred === 1` rows (same standard as the
// sibling purges), and measures the fallback key's own bytes instead of
// `getBytesInUse(null)`.

describe('FallbackStorage quota purge ordering (PBI 2026-10-18-13)', () => {
  // Spy style follows the existing quota tests above. mockClear() drops the
  // call history the seeding inserts already recorded on the shared mock, so
  // call-count assertions only see the calls under test. Each test restores
  // the spy explicitly in `finally` — vi.restoreAllMocks() here would leave
  // the setup's getBytesInUse implementation unset for the following suites.
  function spyBytesInUse(): ReturnType<typeof vi.spyOn> {
    const spy = vi.spyOn(chrome.storage.local, 'getBytesInUse');
    (spy as unknown as { mockResolvedValue: (v: number) => unknown }).mockResolvedValue(6 * 1024 * 1024);
    spy.mockClear();
    return spy;
  }

  async function seedRows(count: number, starredIndices: readonly number[] = []): Promise<void> {
    for (let i = 1; i <= count; i++) {
      await storage.insert(
        makeRecord({ url: `https://seed-${i}.com`, created_at: i, is_starred: starredIndices.includes(i) ? 1 : 0 }),
      );
    }
  }

  it('keeps every row and id stable when a duplicate insert repeats under quota pressure', async () => {
    await seedRows(20);
    const before = await storage.getAllRecords();
    expect(before.length).toBe(20);

    const getBytesSpy = spyBytesInUse();
    try {
      // Re-record an existing newer-side row: the dedupe path must return
      // id:-1 without the quota trim even running (MAX_RETRY_COUNT = 5 scale).
      const dupTarget = before.find(r => r.url === 'https://seed-20.com')!;
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = await storage.insert(makeRecord({ url: dupTarget.url, created_at: dupTarget.created_at }));
        expect(result).toEqual({ success: true, id: -1 });
      }
      // No quota measurement on the dedupe path at all.
      expect(getBytesSpy).not.toHaveBeenCalled();

      const after = await storage.getAllRecords();
      expect(after.length).toBe(20);
      expect(after.map(r => r.id ?? 0).sort((a, b) => a - b)).toEqual(before.map(r => r.id ?? 0).sort((a, b) => a - b));
      expect(after.map(r => r.url).sort()).toEqual(before.map(r => r.url).sort());
    } finally {
      getBytesSpy.mockRestore();
    }
  });

  it('thins only non-starred rows when a new record actually needs space', async () => {
    // Oldest row starred: the trim must skip it and take the next candidate.
    await seedRows(20, [1]);
    const before = await storage.getAllRecords();
    const starredIds = before.filter(r => r.is_starred === 1).map(r => r.id);

    const getBytesSpy = spyBytesInUse();
    try {
      const result = await storage.insert(makeRecord({ url: 'https://brand-new.com', created_at: 999 }));
      expect(result.success).toBe(true);

      const after = await storage.getAllRecords();
      // candidates = 19 non-starred rows -> 10% floor = 1 purged; 20 - 1 + 1 = 20
      expect(after.length).toBe(20);
      for (const id of starredIds) {
        expect(after.some(r => r.id === id)).toBe(true);
      }
      const removed = before.filter(r => !after.some(a => a.id === r.id));
      expect(removed.length).toBe(1);
      expect(removed.every(r => r.is_starred !== 1)).toBe(true);
    } finally {
      getBytesSpy.mockRestore();
    }
  });

  it('returns count:0 and deletes nothing when insertBatch is fully duplicate under quota pressure', async () => {
    await seedRows(20);
    const before = await storage.getAllRecords();

    const getBytesSpy = spyBytesInUse();
    try {
      const batch = before.slice(0, 10).map(r => makeRecord({ url: r.url, created_at: r.created_at }));
      const result = await storage.insertBatch(batch);
      expect(result).toEqual({ success: true, count: 0 });
      expect(getBytesSpy).not.toHaveBeenCalled();

      const after = await storage.getAllRecords();
      expect(after.length).toBe(before.length);
      expect(after.map(r => r.id ?? 0).sort((a, b) => a - b)).toEqual(before.map(r => r.id ?? 0).sort((a, b) => a - b));
    } finally {
      getBytesSpy.mockRestore();
    }
  });

  it('measures the fallback key itself, not all chrome.storage.local keys', async () => {
    await seedRows(20);

    const getBytesSpy = spyBytesInUse();
    try {
      const result = await storage.insert(makeRecord({ url: 'https://brand-new.com', created_at: 999 }));
      expect(result.success).toBe(true);

      expect(getBytesSpy).toHaveBeenCalledWith('FALLBACK_STORAGE_DATA');
      expect(getBytesSpy).not.toHaveBeenCalledWith(null);
    } finally {
      getBytesSpy.mockRestore();
    }
  });

  it('fails explicitly instead of dropping starred rows when no purge candidate exists', async () => {
    await seedRows(5, [1, 2, 3, 4, 5]);
    const before = await storage.getAllRecords();
    expect(before.length).toBe(5);
    expect(before.every(r => r.is_starred === 1)).toBe(true);

    const getBytesSpy = spyBytesInUse();
    try {
      const result = await storage.insert(makeRecord({ url: 'https://brand-new.com', created_at: 999 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('quota');
      }

      const after = await storage.getAllRecords();
      expect(after.length).toBe(before.length);
      expect(after.every(r => r.is_starred === 1)).toBe(true);
    } finally {
      getBytesSpy.mockRestore();
    }
  });

  it('applies the same explicit failure to insertBatch when no purge candidate exists', async () => {
    await seedRows(5, [1, 2, 3, 4, 5]);
    const before = await storage.getAllRecords();
    expect(before.length).toBe(5);

    const getBytesSpy = spyBytesInUse();
    try {
      const result = await storage.insertBatch([makeRecord({ url: 'https://brand-new.com', created_at: 999 })]);
      expect(result.success).toBe(false);

      const after = await storage.getAllRecords();
      expect(after.length).toBe(before.length);
      expect(after.every(r => r.is_starred === 1)).toBe(true);
    } finally {
      getBytesSpy.mockRestore();
    }
  });
});

// ── query(): spec.error path (line 165) ─────────────────────────────────

describe('FallbackStorage query error handling', () => {
  it('returns an error result when orderBy is invalid', async () => {
    await storage.insert(makeRecord({ url: 'https://a.com', created_at: 1 }));
    const result = await storage.query({ orderBy: 'not_a_real_field' as unknown as 'created_at' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid orderBy');
    }
  });
});

// ── query(): legacy is_starred param + effectiveStarred falsy branch ───
// PBI 2026-09-12-13: aliases collapse at the planner seam; these tests feed
// the normalized query, mirroring the product path.

describe('FallbackStorage query legacy starred param', () => {
  it('filters by legacy is_starred=1 when starred/isStarred are not provided', async () => {
    await storage.insert(makeRecord({ url: 'https://s1.com', created_at: 1, is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://s2.com', created_at: 2, is_starred: 0 }));

    const { normalizeStorageQuery } = await import('../queryNormalize.js');
    const result = await storage.query(normalizeStorageQuery({ is_starred: 1 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.url).toBe('https://s1.com');
    }
  });

  it('filters by legacy is_starred=0 (falsy) via ternary else branch', async () => {
    await storage.insert(makeRecord({ url: 'https://s3.com', created_at: 3, is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://s4.com', created_at: 4, is_starred: 0 }));

    const { normalizeStorageQuery } = await import('../queryNormalize.js');
    const result = await storage.query(normalizeStorageQuery({ is_starred: 0 }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.url).toBe('https://s4.com');
    }
  });

  it('filters by starred=false (falsy) via effectiveStarred ternary else branch', async () => {
    await storage.insert(makeRecord({ url: 'https://s5.com', created_at: 5, is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://s6.com', created_at: 6, is_starred: 0 }));

    const result = await storage.query({ starred: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.url).toBe('https://s6.com');
    }
  });

  it('does not apply legacy is_starred filter when starred is explicitly provided', async () => {
    await storage.insert(makeRecord({ url: 'https://s7.com', created_at: 7, is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://s8.com', created_at: 8, is_starred: 0 }));

    // starred provided explicitly (true) — legacy is_starred field on q should be ignored
    const result = await storage.query({ starred: true, ...({ is_starred: 0 } as unknown as object) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.url).toBe('https://s7.com');
    }
  });
});

// ── query(): text search cache hit (line 208 false branch) ──────────────

describe('FallbackStorage text search cache reuse', () => {
  it('reuses cached searchable string when duplicate ids appear in the stored data', async () => {
    // The per-query searchCache is keyed by record id and is meant to guard
    // against re-materializing the same record twice within one filter pass.
    // That only happens if the underlying records array contains a duplicate
    // id (e.g. corrupted storage state) — simulate that directly.
    await storage.insert(makeRecord({ url: 'https://cache1.com', created_at: 1, title: 'Cache Test', summary: 'cache summary text' }));
    const all = await storage.getAllRecords();
    const original = all[0]!;
    const duplicate: BrowsingLogRecord = { ...original, url: 'https://cache1-dup.com' };
    await chrome.storage.local.set({
      FALLBACK_STORAGE_DATA: { records: [...all, duplicate] },
    });

    const result = await storage.query({ text: 'cache' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(2);
    }
  });
});

// ── query(): compareField null handling when sorting by non-created_at field ──

describe('FallbackStorage sort by arbitrary field with nulls', () => {
  it('sorts records with both values null as equal', async () => {
    await storage.insert(makeRecord({ url: 'https://n1.com', created_at: 1, title: null as unknown as string }));
    await storage.insert(makeRecord({ url: 'https://n2.com', created_at: 2, title: null as unknown as string }));

    const result = await storage.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as StorageQuery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(2);
    }
  });

  it('sorts null values after defined values (aVal == null branch)', async () => {
    await storage.insert(makeRecord({ url: 'https://n3.com', created_at: 1, title: null as unknown as string }));
    await storage.insert(makeRecord({ url: 'https://n4.com', created_at: 2, title: 'Defined Title' }));

    const result = await storage.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as StorageQuery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0]?.url).toBe('https://n4.com');
      expect(result.rows[1]?.url).toBe('https://n3.com');
    }
  });

  it('sorts defined values before null values (bVal == null branch)', async () => {
    await storage.insert(makeRecord({ url: 'https://n5.com', created_at: 1, title: 'Defined Title' }));
    await storage.insert(makeRecord({ url: 'https://n6.com', created_at: 2, title: null as unknown as string }));

    const result = await storage.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as StorageQuery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0]?.url).toBe('https://n5.com');
      expect(result.rows[1]?.url).toBe('https://n6.com');
    }
  });

  it('sorts by field DESC via orderDir else branch (non-ASC)', async () => {
    await storage.insert(makeRecord({ url: 'https://d1.com', created_at: 1, title: 'Alpha' }));
    await storage.insert(makeRecord({ url: 'https://d2.com', created_at: 2, title: 'Beta' }));

    const result = await storage.query({ orderBy: 'title', orderDir: 'DESC' } as unknown as StorageQuery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0]?.title).toBe('Beta');
      expect(result.rows[1]?.title).toBe('Alpha');
    }
  });

  it('treats equal field values as equal when sorting (compareField fallthrough)', async () => {
    await storage.insert(makeRecord({ url: 'https://eq1.com', created_at: 1, title: 'Same' }));
    await storage.insert(makeRecord({ url: 'https://eq2.com', created_at: 2, title: 'Same' }));

    const result = await storage.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as StorageQuery);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(2);
      expect(result.rows.every(r => r.title === 'Same')).toBe(true);
    }
  });
});

// ── query(): compareCreatedAt equal-values fallthrough (line 226) ──────

describe('FallbackStorage sort by created_at with equal values', () => {
  it('treats equal created_at values as equal (compareCreatedAt fallthrough)', async () => {
    const ts = 12345;
    await storage.insert(makeRecord({ url: 'https://same-time-1.com', created_at: ts }));
    await storage.insert(makeRecord({ url: 'https://same-time-2.com', created_at: ts }));

    const result = await storage.query({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(2);
      expect(result.rows.every(r => r.created_at === ts)).toBe(true);
    }
  });
});

// ── query(): nullish-coalescing defaults on row mapping (domain, is_starred) ──

describe('FallbackStorage row mapping defaults', () => {
  it('defaults domain to null and is_starred to 0 when undefined on the stored record', async () => {
    await storage.insert(makeRecord({ url: 'https://nodefault.com', created_at: 1 }));
    const all = await storage.getAllRecords();
    const record = all.find(r => r.url === 'https://nodefault.com')!;
    // Force undefined (rather than the insert defaults) to exercise the ?? fallback branch directly.
    delete (record as { domain?: unknown }).domain;
    delete (record as { is_starred?: unknown }).is_starred;
    await chrome.storage.local.set({ FALLBACK_STORAGE_DATA: { records: all } });

    const result = await storage.query({});
    expect(result.success).toBe(true);
    if (result.success) {
      const row = result.rows.find(r => r.url === 'https://nodefault.com');
      expect(row?.domain).toBeNull();
      expect(row?.is_starred).toBe(0);
    }
  });

  it('preserves defined domain and is_starred values on the mapped row', async () => {
    await storage.insert(makeRecord({ url: 'https://withdefault.com', created_at: 1, domain: 'example.com', is_starred: 1 }));

    const result = await storage.query({});
    expect(result.success).toBe(true);
    if (result.success) {
      const row = result.rows.find(r => r.url === 'https://withdefault.com');
      expect(row?.domain).toBe('example.com');
      expect(row?.is_starred).toBe(1);
    }
  });
});

// ── purgeContent(): count-based purge branches (lines 412-424) ──────────

describe('FallbackStorage purgeContent count-based purge', () => {
  it('purges oldest content-bearing records over maxRecords, excluding starred by default', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await storage.insert(makeRecord({
        url: `https://c${i}.com`,
        created_at: now - (5 - i) * 1000,
        content: `content-${i}`,
        is_starred: 0,
      }));
    }

    const result = await storage.purgeContent(undefined, 2, false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(3);
    }

    const all = await storage.getAllRecords();
    const withContent = all.filter(r => r.content != null);
    expect(withContent.length).toBe(2);
  });

  it('includes starred records in count-based purge when includeStarred=true', async () => {
    const now = Date.now();
    await storage.insert(makeRecord({ url: 'https://star-old.com', created_at: now - 5000, content: 'x', is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://star-new.com', created_at: now - 1000, content: 'y', is_starred: 0 }));

    const result = await storage.purgeContent(undefined, 1, true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(1);
    }

    const all = await storage.getAllRecords();
    const starOld = all.find(r => r.url === 'https://star-old.com');
    expect(starOld?.content).toBeNull();
  });

  it('excludes starred records from count-based purge when includeStarred is false', async () => {
    const now = Date.now();
    await storage.insert(makeRecord({ url: 'https://star-keep.com', created_at: now - 5000, content: 'x', is_starred: 1 }));
    await storage.insert(makeRecord({ url: 'https://plain-old.com', created_at: now - 4000, content: 'y', is_starred: 0 }));
    await storage.insert(makeRecord({ url: 'https://plain-new.com', created_at: now - 1000, content: 'z', is_starred: 0 }));

    const result = await storage.purgeContent(undefined, 1, false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(1);
    }

    const all = await storage.getAllRecords();
    const starred = all.find(r => r.url === 'https://star-keep.com');
    expect(starred?.content).toBe('x');
    const plainOld = all.find(r => r.url === 'https://plain-old.com');
    expect(plainOld?.content).toBeNull();
  });

  it('does not purge when remaining count-based candidates are within maxRecords', async () => {
    const now = Date.now();
    await storage.insert(makeRecord({ url: 'https://small1.com', created_at: now - 1000, content: 'a', is_starred: 0 }));

    const result = await storage.purgeContent(undefined, 10, false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(0);
    }
  });

  it('handles a duplicate-id record safely during count-based purge (defensive find() branch)', async () => {
    const now = Date.now();
    await storage.insert(makeRecord({ url: 'https://dup-source.com', created_at: now - 5000, content: 'a', is_starred: 0 }));
    const all = await storage.getAllRecords();
    const original = all[0]!;
    // Duplicate the id: `remaining` (built from data.records) will contain two
    // entries sharing one id, but only the first is ever returned by find(),
    // so the purge loop harmlessly re-nulls the same record's content twice —
    // still both list entries are accounted for in totalPurged.
    const duplicate: BrowsingLogRecord = { ...original, url: 'https://dup-source-2.com' };
    await chrome.storage.local.set({
      FALLBACK_STORAGE_DATA: { records: [...all, duplicate] },
    });

    const result = await storage.purgeContent(undefined, 1, false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBeGreaterThanOrEqual(1);
    }
  });
});
