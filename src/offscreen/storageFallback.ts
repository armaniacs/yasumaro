/**
 * storageFallback.ts
 * chrome.storage.local-based fallback storage for environments where OPFS is unavailable.
 * Provides the same CRUD interface as sqlite.ts but uses linear search instead of FTS5.
 */

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

const STORAGE_KEY = 'FALLBACK_STORAGE_DATA';
const STORAGE_KEY_COUNTER = 'FALLBACK_STORAGE_COUNTER';

interface StoredData {
  records: BrowsingLogRecord[];
}

export class FallbackStorage {
  private async loadData(): Promise<StoredData> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];
    if (data && typeof data === 'object' && 'records' in data && Array.isArray((data as StoredData).records)) {
      return data as StoredData;
    }
    return { records: [] };
  }

  private async saveData(data: StoredData): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  private async getNextId(): Promise<number> {
    const result = await chrome.storage.local.get(STORAGE_KEY_COUNTER);
    const current = typeof result[STORAGE_KEY_COUNTER] === 'number' ? result[STORAGE_KEY_COUNTER] : 0;
    const next = current + 1;
    await chrome.storage.local.set({ [STORAGE_KEY_COUNTER]: next });
    return next;
  }

  async insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const id = await this.getNextId();
      const domain = record.domain || this.extractDomain(record.url);

      const newRecord: BrowsingLogRecord = {
        id,
        url: record.url,
        title: record.title ?? null,
        summary: record.summary ?? null,
        tags: record.tags ?? null,
        created_at: record.created_at,
        domain,
        visit_duration: record.visit_duration ?? null,
        scroll_ratio: record.scroll_ratio ?? null,
        is_starred: record.is_starred ?? 0,
        is_deleted: record.is_deleted ?? 0,
        obsidian_synced: record.obsidian_synced ?? 0,
      };

      const exists = data.records.some(r => r.url === record.url && r.created_at === record.created_at);
      if (exists) {
        return { success: true, id: -1 };
      }

      data.records.push(newRecord);
      await this.saveData(data);
      return { success: true, id };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; count: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      let insertedCount = 0;

      for (const record of records) {
        const exists = data.records.some(r => r.url === record.url && r.created_at === record.created_at);
        if (exists) continue;

        const id = await this.getNextId();
        const domain = record.domain || this.extractDomain(record.url);

        data.records.push({
          id,
          url: record.url,
          title: record.title ?? null,
          summary: record.summary ?? null,
          tags: record.tags ?? null,
          created_at: record.created_at,
          domain,
          visit_duration: record.visit_duration ?? null,
          scroll_ratio: record.scroll_ratio ?? null,
          is_starred: record.is_starred ?? 0,
          is_deleted: record.is_deleted ?? 0,
          obsidian_synced: record.obsidian_synced ?? 0,
        });
        insertedCount++;
      }

      await this.saveData(data);
      return { success: true, count: insertedCount };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async query(options: QueryOptions = {}): Promise<{
    success: true; rows: BrowsingLogRecord[]; total: number
  } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      let filtered = data.records;

      if (options.excludeDeleted !== false) {
        filtered = filtered.filter(r => r.is_deleted === 0);
      }
      if (options.domain) {
        filtered = filtered.filter(r => r.domain === options.domain);
      }
      if (options.isStarred !== undefined) {
        filtered = filtered.filter(r => r.is_starred === (options.isStarred ? 1 : 0));
      }
      if (options.since !== undefined) {
        filtered = filtered.filter(r => r.created_at >= options.since!);
      }
      if (options.until !== undefined) {
        filtered = filtered.filter(r => r.created_at <= options.until!);
      }

      const total = filtered.length;

      const orderBy = options.orderBy || 'created_at';
      const orderDir = options.orderDir === 'ASC' ? 1 : -1;
      filtered.sort((a, b) => {
        const aVal = a[orderBy as keyof BrowsingLogRecord];
        const bVal = b[orderBy as keyof BrowsingLogRecord];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (aVal < bVal) return -1 * orderDir;
        if (aVal > bVal) return 1 * orderDir;
        return 0;
      });

      const limit = options.limit ?? 100;
      const offset = options.offset ?? 0;
      const rows = filtered.slice(offset, offset + limit);

      return { success: true, rows, total };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async search(searchQuery: string, limit: number = 50, offset: number = 0): Promise<{
    success: true; rows: SearchResult[]; total: number
  } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const query = searchQuery.toLowerCase();

      const matched = data.records.filter(r => {
        if (r.is_deleted !== 0) return false;
        const searchable = [r.url, r.title, r.summary, r.tags]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(query);
      });

      const total = matched.length;
      const paged = matched.slice(offset, offset + limit);

      const rows: SearchResult[] = paged.map(r => ({
        id: r.id!,
        url: r.url,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags: r.tags ?? null,
        created_at: r.created_at,
        domain: r.domain ?? null,
        visit_duration: r.visit_duration ?? null,
        scroll_ratio: r.scroll_ratio ?? null,
        is_starred: r.is_starred ?? 0,
        rank: 0,
      }));

      return { success: true, rows, total };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async update(id: number, changes: Partial<BrowsingLogRecord>): Promise<{ success: true } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const record = data.records.find(r => r.id === id);
      if (!record) {
        return { success: true };
      }

      const updatableFields: (keyof BrowsingLogRecord)[] = [
        'url', 'title', 'summary', 'tags', 'domain',
        'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted'
      ];

      for (const field of updatableFields) {
        if (field in changes) {
          (record as unknown as Record<string, unknown>)[field] = changes[field];
        }
      }

      await this.saveData(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async hardDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      data.records = data.records.filter(r => r.id !== id);
      await this.saveData(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const record = data.records.find(r => r.id === id);
      if (!record) {
        return { success: false, error: 'Record not found' };
      }

      record.is_starred = record.is_starred === 0 ? 1 : 0;
      await this.saveData(data);
      return { success: true, is_starred: record.is_starred };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async getCount(): Promise<{ success: true; count: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const count = data.records.filter(r => r.is_deleted === 0).length;
      return { success: true, count };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async clearAll(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.saveData({ records: [] });
      await chrome.storage.local.set({ [STORAGE_KEY_COUNTER]: 0 });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async getAllRecords(): Promise<BrowsingLogRecord[]> {
    const data = await this.loadData();
    return data.records;
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url;
    }
  }
}
