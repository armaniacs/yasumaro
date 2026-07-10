// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';

describe('FallbackStorage', () => {
  let storage: FallbackStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new FallbackStorage();
  });

  describe('insert', () => {
    it('inserts a record and returns an id', async () => {
      const result = await storage.insert({
        url: 'https://example.com',
        created_at: 1000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.id).toBeGreaterThanOrEqual(1);
      }
    });

    it('returns success:true with id=-1 for duplicate (same url + created_at)', async () => {
      await storage.insert({ url: 'https://example.com', created_at: 1000 });
      const dup = await storage.insert({ url: 'https://example.com', created_at: 1000 });
      expect(dup).toEqual({ success: true, id: -1 });
    });

    it('inserts distinct records with same url but different timestamps', async () => {
      await storage.insert({ url: 'https://example.com', created_at: 1000 });
      const r2 = await storage.insert({ url: 'https://example.com', created_at: 2000 });
      expect(r2).toEqual({ success: true, id: 2 });
    });

    it('handles storage errors gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Quota exceeded'));
      const result = await storage.insert({ url: 'https://x.com', created_at: 1 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Quota exceeded');
      }
    });
  });

  describe('concurrency (PBI 2026-07-09-13: Mutex-protected insert/insertBatch)', () => {
    it('preserves all records when two tabs insert concurrently with distinct URLs', async () => {
      const [r1, r2] = await Promise.all([
        storage.insert({ url: 'https://tab-a.com', created_at: 1 }),
        storage.insert({ url: 'https://tab-b.com', created_at: 2 }),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      if (r1.success && r2.success) {
        // Each concurrent insert must get a unique id — a lost update would
        // manifest as both resolving to the same id or one being silently dropped.
        expect(r1.id).not.toBe(r2.id);
      }

      const all = await storage.getAllRecords();
      expect(all).toHaveLength(2);
      const urls = all.map(r => r.url).sort();
      expect(urls).toEqual(['https://tab-a.com', 'https://tab-b.com']);
    });

    it('preserves all records when insert and insertBatch run concurrently', async () => {
      await Promise.all([
        storage.insert({ url: 'https://single.com', created_at: 1 }),
        storage.insertBatch([
          { url: 'https://batch-a.com', created_at: 2 },
          { url: 'https://batch-b.com', created_at: 3 },
          { url: 'https://batch-c.com', created_at: 4 },
        ]),
      ]);

      const all = await storage.getAllRecords();
      expect(all).toHaveLength(4);
      const urls = all.map(r => r.url).sort();
      expect(urls).toEqual([
        'https://batch-a.com',
        'https://batch-b.com',
        'https://batch-c.com',
        'https://single.com',
      ]);
    });

    it('does not lose existing records when many inserts race against each other', async () => {
      await storage.insert({ url: 'https://existing.com', created_at: 0 });

      const concurrentInserts = Array.from({ length: 10 }, (_, i) =>
        storage.insert({ url: `https://concurrent-${i}.com`, created_at: i + 1 })
      );
      await Promise.all(concurrentInserts);

      const all = await storage.getAllRecords();
      // 1 pre-existing + 10 concurrent = 11 total, none lost to a race.
      expect(all).toHaveLength(11);
      const ids = all.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length); // all ids unique, no overwrite
    });

    it('releases the lock after a failure so subsequent inserts still succeed', async () => {
      vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Quota exceeded'));

      const failed = await storage.insert({ url: 'https://fails.com', created_at: 1 });
      expect(failed.success).toBe(false);

      // If the mutex were not released in a `finally`, this would hang or fail.
      const succeeded = await storage.insert({ url: 'https://succeeds.com', created_at: 2 });
      expect(succeeded.success).toBe(true);
    });
  });

  describe('insertBatch', () => {
    it('inserts multiple records and returns count', async () => {
      const records = [
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2 },
        { url: 'https://c.com', created_at: 3 },
      ];
      const result = await storage.insertBatch(records);
      expect(result).toEqual({ success: true, count: 3 });
    });

    it('skips duplicates within batch', async () => {
      await storage.insert({ url: 'https://a.com', created_at: 1 });
      const records = [
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2 },
      ];
      const result = await storage.insertBatch(records);
      expect(result).toEqual({ success: true, count: 1 });
    });

    it('handles storage errors', async () => {
      vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Write error'));
      const result = await storage.insertBatch([{ url: 'https://a.com', created_at: 1 }]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Write error');
      }
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await storage.insertBatch([
        { url: 'https://a.com', created_at: 100, domain: 'a.com' },
        { url: 'https://b.com', created_at: 200, domain: 'b.com' },
        { url: 'https://c.com', created_at: 300, domain: 'a.com', is_starred: 1 },
        { url: 'https://d.com', created_at: 150, domain: 'b.com', is_deleted: 1 },
      ]);
    });

    it('returns all non-deleted records sorted by created_at DESC by default', async () => {
      const result = await storage.query();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(3);
        expect(result.rows[0].url).toBe('https://c.com');
        expect(result.rows[2].url).toBe('https://a.com');
      }
    });

    it('filters by domain', async () => {
      const result = await storage.query({ domain: 'b.com' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].url).toBe('https://b.com');
      }
    });

    it('filters by starred', async () => {
      const result = await storage.query({ isStarred: true, excludeDeleted: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].is_starred).toBe(1);
      }
    });

    it('filters by time range', async () => {
      const result = await storage.query({ since: 100, until: 200 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(2);
      }
    });

    it('paginates with limit and offset', async () => {
      const result = await storage.query({ limit: 1, offset: 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(1);
        expect(result.total).toBe(3);
      }
    });

    it('orders ASC', async () => {
      const result = await storage.query({ orderDir: 'ASC', excludeDeleted: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows[0].url).toBe('https://a.com');
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Storage error'));
      const result = await storage.query();
      expect(result.success).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await storage.insertBatch([
        { url: 'https://example.com/alpha', title: 'Alpha page', summary: 'First entry', created_at: 100 },
        { url: 'https://example.com/beta', title: 'Beta page', summary: 'Second entry', created_at: 200 },
        { url: 'https://example.com/gamma', title: 'Gamma page', created_at: 300 },
      ]);
    });

    it('finds records matching query in url', async () => {
      const result = await storage.search('alpha');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.total).toBe(1);
        expect(result.rows[0].url).toContain('alpha');
      }
    });

    it('finds records matching query in title', async () => {
      const result = await storage.search('Beta');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.total).toBe(1);
      }
    });

    it('returns empty for unmatched query', async () => {
      const result = await storage.search('zzzzz');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.total).toBe(0);
        expect(result.rows.length).toBe(0);
      }
    });

    it('paginates results', async () => {
      const result = await storage.search('alpha', 1, 0);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(1);
        expect(result.total).toBe(1);
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Search error'));
      const result = await storage.search('test');
      expect(result.success).toBe(false);
    });

    it('includes rank field in search results', async () => {
      const result = await storage.search('alpha');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows[0]).toHaveProperty('rank');
        expect(result.rows[0].rank).toBe(0);
      }
    });
  });

  describe('update', () => {
    it('updates existing record fields', async () => {
      const ins = await storage.insert({ url: 'https://x.com', created_at: 100 });
      expect(ins.success).toBe(true);
      if (!ins.success) return;
      const upd = await storage.update(ins.id, { title: 'Updated', is_starred: 1 });
      expect(upd).toEqual({ success: true });
      const q = await storage.query();
      expect(q.success).toBe(true);
      if (q.success) {
        expect(q.rows[0].title).toBe('Updated');
        expect(q.rows[0].is_starred).toBe(1);
      }
    });

    it('returns success for non-existent id (no-op)', async () => {
      const result = await storage.update(99999, { title: 'ghost' });
      expect(result).toEqual({ success: true });
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Update error'));
      const result = await storage.update(1, { title: 'x' });
      expect(result.success).toBe(false);
    });
  });

  describe('hardDelete', () => {
    it('removes a record by id', async () => {
      const ins = await storage.insert({ url: 'https://x.com', created_at: 100 });
      expect(ins.success).toBe(true);
      if (!ins.success) return;
      await storage.hardDelete(ins.id);
      const q = await storage.query();
      expect(q.success).toBe(true);
      if (q.success) {
        expect(q.rows.length).toBe(0);
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Delete error'));
      const result = await storage.hardDelete(1);
      expect(result.success).toBe(false);
    });
  });

  describe('toggleStar', () => {
    it('toggles between 0 and 1', async () => {
      const ins = await storage.insert({ url: 'https://x.com', created_at: 100 });
      expect(ins.success).toBe(true);
      if (!ins.success) return;
      const t1 = await storage.toggleStar(ins.id);
      expect(t1).toEqual({ success: true, is_starred: 1 });
      const t2 = await storage.toggleStar(ins.id);
      expect(t2).toEqual({ success: true, is_starred: 0 });
    });

    it('returns error for non-existent id', async () => {
      const result = await storage.toggleStar(99999);
      expect(result).toEqual({ success: false, error: 'Record not found' });
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Star error'));
      const result = await storage.toggleStar(1);
      expect(result.success).toBe(false);
    });
  });

  describe('getCount', () => {
    it('returns count of non-deleted records', async () => {
      await storage.insertBatch([
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2, is_deleted: 1 },
        { url: 'https://c.com', created_at: 3 },
      ]);
      const result = await storage.getCount();
      expect(result).toEqual({ success: true, count: 2 });
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Count error'));
      const result = await storage.getCount();
      expect(result.success).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('removes all records and resets counter', async () => {
      await storage.insert({ url: 'https://a.com', created_at: 1 });
      await storage.clearAll();
      const q = await storage.query();
      expect(q.success).toBe(true);
      if (q.success) {
        expect(q.rows.length).toBe(0);
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('Clear error'));
      const result = await storage.clearAll();
      expect(result).toEqual({ success: false, error: expect.stringContaining('Clear error') });
    });
  });

  describe('purgeOldRecords', () => {
    it('removes old records beyond retention days', async () => {
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
      await storage.insert({ url: 'https://old.com', created_at: old });
      await storage.insert({ url: 'https://new.com', created_at: Date.now() });
      const result = await storage.purgeOldRecords(90);
      expect(result).toEqual({ success: true, purged: 1 });
    });

    it('preserves starred records regardless of age', async () => {
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
      await storage.insert({ url: 'https://starred.com', created_at: old, is_starred: 1 });
      await storage.insert({ url: 'https://old.com', created_at: old });
      const result = await storage.purgeOldRecords(90);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBe(1);
      }
    });

    it('trims to maxRecords when exceeded', async () => {
      for (let i = 0; i < 15; i++) {
        await storage.insert({ url: `https://x${i}.com`, created_at: i });
      }
      const result = await storage.purgeOldRecords(999, 10);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBeGreaterThanOrEqual(5);
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Purge error'));
      const result = await storage.purgeOldRecords(90, 100);
      expect(result.success).toBe(false);
    });
  });

  describe('purgeContent', () => {
    it('clears content for records older than retention', async () => {
      const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
      await storage.insert({ url: 'https://old.com', created_at: old, content: 'old content' });
      await storage.insert({ url: 'https://new.com', created_at: Date.now(), content: 'new content' });
      const result = await storage.purgeContent(7, 0, false);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBe(1);
      }
    });

    it('clears content for excess records beyond maxRecords', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.insert({ url: `https://x${i}.com`, created_at: i, content: `content ${i}` });
      }
      const result = await storage.purgeContent(0, 3, false);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBe(2);
      }
    });

    it('preserves starred content when includeStarred is false', async () => {
      const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
      await storage.insert({ url: 'https://starred.com', created_at: old, content: 'starred', is_starred: 1 });
      const result = await storage.purgeContent(7, 0, false);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBe(0);
      }
    });

    it('purges starred content when includeStarred is true', async () => {
      const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
      await storage.insert({ url: 'https://starred.com', created_at: old, content: 'starred', is_starred: 1 });
      const result = await storage.purgeContent(7, 0, true);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.purged).toBe(1);
      }
    });

    it('handles error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Purge content error'));
      const result = await storage.purgeContent(7, 100);
      expect(result.success).toBe(false);
    });
  });

  describe('getAllRecords', () => {
    it('returns all records', async () => {
      await storage.insertBatch([
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2 },
      ]);
      const records = await storage.getAllRecords();
      expect(records.length).toBe(2);
    });

    it('returns empty array when no records', async () => {
      const records = await storage.getAllRecords();
      expect(records).toEqual([]);
    });
  });

  describe('query sort edge cases', () => {
    it('handles null values in sort column', async () => {
      await storage.insert({ url: 'https://a.com', created_at: 100, visit_duration: null });
      await storage.insert({ url: 'https://b.com', created_at: 200, visit_duration: 10 });
      await storage.insert({ url: 'https://c.com', created_at: 300, visit_duration: 5 });
      const result = await storage.query({ orderBy: 'visit_duration', orderDir: 'ASC' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows.length).toBe(3);
      }
    });

    it('sorts by a non-default column', async () => {
      await storage.insertBatch([
        { url: 'https://z.com', created_at: 300 },
        { url: 'https://a.com', created_at: 100 },
        { url: 'https://m.com', created_at: 200 },
      ]);
      const result = await storage.query({ orderBy: 'created_at', orderDir: 'ASC' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.rows[0].url).toBe('https://a.com');
        expect(result.rows[2].url).toBe('https://z.com');
      }
    });
  });
});
