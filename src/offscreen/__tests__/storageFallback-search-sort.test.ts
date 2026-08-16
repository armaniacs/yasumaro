// @vitest-environment jsdom
/**
 * storageFallback-search-sort.test.ts
 * Verifies FallbackStorage.search() sorts by orderBy/orderDir instead of
 * always returning records in storage order.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';

describe('FallbackStorage.search — sort', () => {
  let storage: FallbackStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new FallbackStorage();
  });

  it('sorts by created_at DESC when orderBy=created_at, orderDir=DESC', async () => {
    await storage.insert({ url: 'https://a.example.com', created_at: 100 });
    await storage.insert({ url: 'https://b.example.com', created_at: 300 });
    await storage.insert({ url: 'https://c.example.com', created_at: 200 });

    const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map(r => r.created_at)).toEqual([300, 200, 100]);
    }
  });

  it('sorts by created_at ASC when orderBy=created_at, orderDir=ASC', async () => {
    await storage.insert({ url: 'https://a.example.com', created_at: 100 });
    await storage.insert({ url: 'https://b.example.com', created_at: 300 });
    await storage.insert({ url: 'https://c.example.com', created_at: 200 });

    const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'ASC' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map(r => r.created_at)).toEqual([100, 200, 300]);
    }
  });

  it('leaves order unchanged when orderBy is omitted (no FTS5 rank in fallback path)', async () => {
    await storage.insert({ url: 'https://a.example.com', created_at: 100 });
    await storage.insert({ url: 'https://b.example.com', created_at: 300 });
    await storage.insert({ url: 'https://c.example.com', created_at: 200 });

    const result = await storage.search('example', 10, 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map(r => r.created_at)).toEqual([100, 300, 200]);
    }
  });
});
