import { vi } from 'vitest';

const mockStorage: Record<string, unknown> = {};
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) {
          if (k in mockStorage) out[k] = mockStorage[k];
        }
        return out;
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj);
      }),
    },
  },
  alarms: {
    create: vi.fn(),
  },
};

vi.stubGlobal('chrome', mockChrome);

import { MarkdownBufferManager } from '../MarkdownBufferManager.js';
import type { MarkdownEntry } from '../MarkdownBufferManager.js';

function makeEntry(overrides: Partial<MarkdownEntry> = {}): MarkdownEntry {
  return {
    url: 'https://example.com',
    title: 'Example Page',
    visitedAt: 1_700_000_000_000,
    entryData: {
      timestamp: '14:30',
      title: 'Example Page',
      url: 'https://example.com',
      summary: 'Summary text',
      tags: '',
      domain: 'example.com',
    },
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('MarkdownBufferManager', () => {
  let manager: MarkdownBufferManager;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
    manager = new MarkdownBufferManager();
  });

  describe('add', () => {
    it('buffers entries without writing to storage', () => {
      manager.add(makeEntry());

      expect(manager.count).toBe(1);
      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('increments count for multiple entries', () => {
      manager.add(makeEntry({ url: 'https://a.com' }));
      manager.add(makeEntry({ url: 'https://b.com' }));
      manager.add(makeEntry({ url: 'https://c.com' }));

      expect(manager.count).toBe(3);
      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('writes all buffered entries to storage and clears buffer', async () => {
      const entry1 = makeEntry({ url: 'https://a.com', entryData: { timestamp: '10:00', title: 'A', url: 'https://a.com', summary: 'Entry A', tags: '', domain: 'a.com' } });
      const entry2 = makeEntry({ url: 'https://b.com', entryData: { timestamp: '11:00', title: 'B', url: 'https://b.com', summary: 'Entry B', tags: '', domain: 'b.com' } });
      manager.add(entry1);
      manager.add(entry2);

      await manager.flush();

      expect(manager.count).toBe(0);
      const setCall = mockChrome.storage.local.set.mock.calls[0][0];
      const storageKey = Object.keys(setCall).find((k) => !k.endsWith('_version')) as string;
      expect(storageKey).toMatch(/^local_export_\d{4}-\d{2}-\d{2}$/);
      expect(setCall[storageKey]).toEqual([entry1, entry2]);
    });

    it('merges with existing entries in storage (append mode)', async () => {
      const existingEntry = makeEntry({ url: 'https://existing.com', entryData: { timestamp: '09:00', title: 'Existing', url: 'https://existing.com', summary: 'Existing', tags: '', domain: 'existing.com' } });
      const today = new Date();
      const dateKey = `local_export_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      mockStorage[dateKey] = [existingEntry];

      const newEntry = makeEntry({ url: 'https://new.com', entryData: { timestamp: '12:00', title: 'New', url: 'https://new.com', summary: 'New', tags: '', domain: 'new.com' } });
      manager.add(newEntry);
      await manager.flush();

      const setCall = mockChrome.storage.local.set.mock.calls[0][0];
      const key = Object.keys(setCall).find((k) => !k.endsWith('_version')) as string;
      expect(setCall[key]).toHaveLength(2);
      expect(setCall[key][0]).toEqual(existingEntry);
      expect(setCall[key][1]).toEqual(newEntry);
    });

    it('is a no-op when buffer is empty', async () => {
      await manager.flush();

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(mockChrome.storage.local.get).not.toHaveBeenCalled();
    });

    it('can be called multiple times, accumulating across flushes', async () => {
      manager.add(makeEntry({ url: 'https://first.com' }));
      await manager.flush();
      expect(manager.count).toBe(0);

      manager.add(makeEntry({ url: 'https://second.com' }));
      await manager.flush();
      expect(manager.count).toBe(0);

      const today = new Date();
      const dateKey = `local_export_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect((mockStorage[dateKey] as unknown[]).length).toBe(2);
    });
  });

  describe('scheduleDailyFlush', () => {
    it('creates a chrome alarm with daily period', () => {
      manager.scheduleDailyFlush();

      expect(mockChrome.alarms.create).toHaveBeenCalledTimes(1);
      expect(mockChrome.alarms.create).toHaveBeenCalledWith(
        'yasumaro-local-md-daily',
        { periodInMinutes: 1440 },
      );
    });

    it('uses custom alarm name when provided', () => {
      manager.scheduleDailyFlush('custom-alarm');

      expect(mockChrome.alarms.create).toHaveBeenCalledWith(
        'custom-alarm',
        { periodInMinutes: 1440 },
      );
    });
  });
});
