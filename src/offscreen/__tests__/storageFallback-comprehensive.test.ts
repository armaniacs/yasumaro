/**
 * storageFallback-comprehensive.test.ts
 * Comprehensive tests for FallbackStorage — covers insert batch allocation,
 * quota management, query filtering, update, toggleStar, purge operations,
 * domain extraction, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

// ── Test helpers ──────────────────────────────────────────────────────

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

// ── Insert ─────────────────────────────────────────────────────────────

describe('FallbackStorage insert', () => {
  it('inserts a record and returns auto-generated id', async () => {
    const result = await storage.insert(makeRecord());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBeGreaterThan(0);
    }
  });

  it('inserts multiple records with sequential ids', async () => {
    const r1 = await storage.insert(makeRecord({ url: 'https://a.com', created_at: 1 }));
    const r2 = await storage.insert(makeRecord({ url: 'https://b.com', created_at: 2 }));
    const r3 = await storage.insert(makeRecord({ url: 'https://c.com', created_at: 3 }));

    expect(r1.success && r1.id).toBe(1);
    expect(r2.success && r2.id).toBe(2);
    expect(r3.success && r3.id).toBe(3);
  });

  it('skips duplicate (url, created_at) pairs', async () => {
    const record = makeRecord({ url: 'https://dup.com', created_at: 100 });
    const r1 = await storage.insert(record);
    const r2 = await storage.insert(record);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r2.success) {
      expect(r2.id).toBe(-1); // indicates skipped
    }
  });

  it('extracts domain from URL when not provided', async () => {
    const result = await storage.insert(makeRecord({ url: 'https://test-domain.com/path' }));
    expect(result.success).toBe(true);
    const records = await storage.getAllRecords();
    expect(records[0]!.domain).toBe('test-domain.com');
  });

  it('uses provided domain over extracted domain', async () => {
    await storage.insert(makeRecord({
      url: 'https://test.com/path',
      domain: 'custom-domain.com',
    }));
    const records = await storage.getAllRecords();
    expect(records[0]!.domain).toBe('custom-domain.com');
  });
});

// ── Insert batch ───────────────────────────────────────────────────────

describe('FallbackStorage insertBatch', () => {
  it('inserts a batch of records with sequential ids', async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ url: `https://batch${i}.com`, created_at: i })
    );
    const result = await storage.insertBatch(records);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(5);
    }
  });

  it('skips duplicates within a batch', async () => {
    const record = makeRecord({ url: 'https://same.com', created_at: 100 });
    const result = await storage.insertBatch([record, record, record]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(1); // only 1 unique inserted
    }
  });

  it('reserves IDs in a single counter round-trip', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ url: `https://batch${i}.com`, created_at: i })
    );
    await storage.insertBatch(records);
    const allRecords = await storage.getAllRecords();
    const ids = allRecords.map(r => r.id).sort((a, b) => a! - b!);
    // IDs should be sequential starting from 1
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(10);
  });

  it('handles empty batch', async () => {
    const result = await storage.insertBatch([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(0);
    }
  });
});

// ── Query filtering ────────────────────────────────────────────────────

describe('FallbackStorage query', () => {
  beforeEach(async () => {
    await storage.insertBatch([
      makeRecord({ url: 'https://a.com', created_at: 1000, domain: 'a.com', is_starred: 1 }),
      makeRecord({ url: 'https://b.com', created_at: 2000, domain: 'b.com', is_deleted: 1 }),
      makeRecord({ url: 'https://c.com', created_at: 3000, domain: 'a.com', gist_synced: 1 }),
      makeRecord({ url: 'https://d.com', created_at: 4000, domain: 'd.com' }),
    ]);
  });

  it('excludes soft-deleted records by default', async () => {
    const result = await storage.query({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(3); // b.com is deleted
    }
  });

  it('includes soft-deleted records when excludeDeleted is false', async () => {
    const result = await storage.query({ excludeDeleted: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(4);
    }
  });

  it('filters by domain', async () => {
    const result = await storage.query({ domain: 'a.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(2);
      expect(result.rows.every(r => r.domain === 'a.com')).toBe(true);
    }
  });

  it('filters by starred', async () => {
    const result = await storage.query({ starred: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(1);
      expect(result.rows[0]!.url).toBe('https://a.com');
    }
  });

  it('filters by dateFrom', async () => {
    const result = await storage.query({ dateFrom: 2500 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(2); // c.com and d.com
    }
  });

  it('filters by dateTo', async () => {
    const result = await storage.query({ dateTo: 1500 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(1); // a.com only
    }
  });

  it('filters by gistSynced', async () => {
    const result = await storage.query({ gistSynced: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.total).toBe(1);
      expect(result.rows[0]!.url).toBe('https://c.com');
    }
  });

  it('applies text search (LIKE fallback)', async () => {
    const result = await storage.query({ text: 'Test' });
    expect(result.success).toBe(true);
    if (result.success) {
      // All records have "Test Page" in title
      expect(result.total).toBeGreaterThan(0);
    }
  });

  it('respects limit and offset', async () => {
    const result = await storage.query({ limit: 2, offset: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.length).toBe(2);
      expect(result.total).toBe(3);
    }
  });

  it('sorts by created_at DESC by default', async () => {
    const result = await storage.query({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0]!.created_at).toBeGreaterThanOrEqual(result.rows[1]!.created_at);
    }
  });

  it('sorts by created_at ASC when specified', async () => {
    const result = await storage.query({ orderDir: 'ASC' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows[0]!.created_at).toBeLessThanOrEqual(result.rows[1]!.created_at);
    }
  });
});

// ── Update ─────────────────────────────────────────────────────────────

describe('FallbackStorage update', () => {
  it('updates a record field', async () => {
    const insertResult = await storage.insert(makeRecord({ url: 'https://up.com', created_at: 100 }));
    expect(insertResult.success).toBe(true);
    const id = insertResult.success ? insertResult.id : 0;

    const result = await storage.update(id, { title: 'Updated Title' });
    expect(result.success).toBe(true);

    const records = await storage.getAllRecords();
    const updated = records.find(r => r.id === id);
    expect(updated?.title).toBe('Updated Title');
  });

  it('does not update non-updatable fields', async () => {
    const insertResult = await storage.insert(makeRecord({ url: 'https://up2.com', created_at: 200 }));
    const id = insertResult.success ? insertResult.id : 0;

    await storage.update(id, { id: 9999, created_at: 9999 } as any);
    const records = await storage.getAllRecords();
    const updated = records.find(r => r.id === id);
    expect(updated?.id).not.toBe(9999);
  });

  it('returns success for non-existent id (no-op)', async () => {
    const result = await storage.update(99999, { title: 'Ghost' });
    expect(result.success).toBe(true);
  });
});

// ── Toggle star ────────────────────────────────────────────────────────

describe('FallbackStorage toggleStar', () => {
  it('toggles star from 0 to 1', async () => {
    const { success, id } = await storage.insert(makeRecord({ url: 'https://star.com', created_at: 100 }));
    expect(success).toBe(true);

    const result = await storage.toggleStar(id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.is_starred).toBe(1);
    }
  });

  it('toggles star from 1 to 0', async () => {
    const { success, id } = await storage.insert(makeRecord({
      url: 'https://star2.com', created_at: 100, is_starred: 1,
    }));
    expect(success).toBe(true);

    const result = await storage.toggleStar(id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.is_starred).toBe(0);
    }
  });

  it('returns error for non-existent id', async () => {
    const result = await storage.toggleStar(99999);
    expect(result.success).toBe(false);
  });
});

// ── Hard delete ────────────────────────────────────────────────────────

describe('FallbackStorage hardDelete', () => {
  it('removes a record by id', async () => {
    const { id } = await storage.insert(makeRecord({ url: 'https://del.com', created_at: 100 }));
    await storage.hardDelete(id);
    const records = await storage.getAllRecords();
    expect(records.find(r => r.id === id)).toBeUndefined();
  });

  it('returns success even for non-existent id', async () => {
    const result = await storage.hardDelete(99999);
    expect(result.success).toBe(true);
  });
});

// ── Get count ──────────────────────────────────────────────────────────

describe('FallbackStorage getCount', () => {
  it('counts only non-deleted records', async () => {
    await storage.insertBatch([
      makeRecord({ url: 'https://a.com', created_at: 1 }),
      makeRecord({ url: 'https://b.com', created_at: 2, is_deleted: 1 }),
      makeRecord({ url: 'https://c.com', created_at: 3 }),
    ]);
    const result = await storage.getCount();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(2);
    }
  });
});

// ── Clear all ──────────────────────────────────────────────────────────

describe('FallbackStorage clearAll', () => {
  it('removes all records and resets counter', async () => {
    await storage.insertBatch([
      makeRecord({ url: 'https://a.com', created_at: 1 }),
      makeRecord({ url: 'https://b.com', created_at: 2 }),
    ]);
    await storage.clearAll();
    const result = await storage.getCount();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(0);
    }
  });
});

// ── Purge operations ──────────────────────────────────────────────────

describe('FallbackStorage purgeOldRecords', () => {
  it('purges records older than retention days', async () => {
    const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
    const recentTime = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    await storage.insertBatch([
      makeRecord({ url: 'https://old.com', created_at: oldTime }),
      makeRecord({ url: 'https://recent.com', created_at: recentTime }),
    ]);

    const result = await storage.purgeOldRecords(90, 10000);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(1);
    }
  });

  it('does not purge starred records', async () => {
    const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000;
    await storage.insert(makeRecord({
      url: 'https://starred.com',
      created_at: oldTime,
      is_starred: 1,
    }));

    const result = await storage.purgeOldRecords(90, 10000);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(0);
    }
  });

  it('purges excess records beyond maxRecords', async () => {
    const now = Date.now();
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ url: `https://e${i}.com`, created_at: now - i * 1000 })
    );
    await storage.insertBatch(records);

    const result = await storage.purgeOldRecords(9999, 5); // keep only 5
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(5);
    }
  });
});

describe('FallbackStorage purgeContent', () => {
  it('purges content from old records', async () => {
    const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000;
    await storage.insert(makeRecord({
      url: 'https://content.com',
      created_at: oldTime,
      content: 'Some content',
    }));

    const result = await storage.purgeContent(90);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(1);
    }
  });

  it('does not purge starred content by default', async () => {
    await storage.insert(makeRecord({
      url: 'https://starred-content.com',
      created_at: 100,
      content: 'Starred content',
      is_starred: 1,
    }));

    const result = await storage.purgeContent(0); // 0 days = purge all
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(0);
    }
  });

  it('purges starred content when includeStarred is true', async () => {
    const oldTime = Date.now() - 100 * 24 * 60 * 60 * 1000;
    await storage.insert(makeRecord({
      url: 'https://starred-content2.com',
      created_at: oldTime,
      content: 'Starred content',
      is_starred: 1,
    }));

    const result = await storage.purgeContent(90, undefined, true);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purged).toBe(1);
    }
  });
});

// ── Health check ───────────────────────────────────────────────────────

describe('FallbackStorage healthCheck', () => {
  it('returns true when storage is accessible', async () => {
    const healthy = await storage.healthCheck();
    expect(healthy).toBe(true);
  });
});

// ── Domain extraction ──────────────────────────────────────────────────

describe('FallbackStorage domain extraction', () => {
  it('extracts hostname from valid URL', async () => {
    await storage.insert(makeRecord({ url: 'https://subdomain.example.com:8080/path' }));
    const records = await storage.getAllRecords();
    expect(records[0]!.domain).toBe('subdomain.example.com');
  });

  it('returns raw URL for invalid URL', async () => {
    await storage.insert(makeRecord({ url: 'not-a-valid-url' }));
    const records = await storage.getAllRecords();
    expect(records[0]!.domain).toBe('not-a-valid-url');
  });
});
