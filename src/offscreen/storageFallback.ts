/**
 * storageFallback.ts
 * chrome.storage.local-based fallback storage for environments where OPFS is unavailable.
 * Provides the same CRUD interface as sqlite.ts but uses linear search instead of FTS5.
 */

import { Mutex } from '../background/Mutex.js';
import { UPDATABLE_FIELDS, buildInsertRecordFields } from './schema.js';
import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

const STORAGE_KEY = 'FALLBACK_STORAGE_DATA';
const STORAGE_KEY_COUNTER = 'FALLBACK_STORAGE_COUNTER';
const QUOTA_BYTES_LIMIT = 5 * 1024 * 1024; // 5MB warning threshold

interface StoredData {
  records: BrowsingLogRecord[];
}

export class FallbackStorage {
  private readonly mutex = new Mutex();
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

  private async ensureQuotaSpace(): Promise<void> {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    if (bytesInUse <= QUOTA_BYTES_LIMIT) return;

    const data = await this.loadData();
    const purgeCount = Math.max(1, Math.floor(data.records.length * 0.1));
    const sorted = [...data.records].sort((a, b) => a.created_at - b.created_at);
    const toRemove = new Set(sorted.slice(0, purgeCount).map(r => r.id));
    data.records = data.records.filter(r => !toRemove.has(r.id));
    await this.saveData(data);
  }

  async insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
    await this.mutex.acquire();
    try {
      await this.ensureQuotaSpace();
      const data = await this.loadData();
      const id = await this.getNextId();
      const domain = record.domain || this.extractDomain(record.url);

      const newRecord: BrowsingLogRecord = {
        id,
        ...buildInsertRecordFields(record, domain),
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
    } finally {
      this.mutex.release();
    }
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; count: number } | { success: false; error: string }> {
    await this.mutex.acquire();
    try {
      await this.ensureQuotaSpace();
      const data = await this.loadData();
      let insertedCount = 0;

      for (const record of records) {
        const exists = data.records.some(r => r.url === record.url && r.created_at === record.created_at);
        if (exists) continue;

        const id = await this.getNextId();
        const domain = record.domain || this.extractDomain(record.url);

        data.records.push({
          id,
          ...buildInsertRecordFields(record, domain),
        });
        insertedCount++;
      }

      await this.saveData(data);
      return { success: true, count: insertedCount };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      this.mutex.release();
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

      for (const field of UPDATABLE_FIELDS) {
        const f = field as keyof BrowsingLogRecord;
        if (f in changes) {
          (record as unknown as Record<string, unknown>)[f] = changes[f];
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

  async purgeOldRecords(retentionDays: number = 90, maxRecords: number = 1000): Promise<{ success: true; purged: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      let purged = 0;

      const _before = data.records.length;
      data.records = data.records.filter(r => {
        if (r.is_starred === 1 || r.is_deleted === 1) return true;
        if (r.created_at < cutoffMs) {
          purged++;
          return false;
        }
        return true;
      });

      const activeRecords = data.records.filter(r => r.is_deleted === 0);
      if (activeRecords.length > maxRecords) {
        const sorted = [...activeRecords].sort((a, b) => a.created_at - b.created_at);
        const toRemove = new Set(sorted.slice(0, activeRecords.length - maxRecords).map(r => r.id));
        data.records = data.records.filter(r => {
          if (toRemove.has(r.id)) {
            purged++;
            return false;
          }
          return true;
        });
      }

      await this.saveData(data);
      return { success: true, purged };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ success: true; purged: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const includeAll = includeStarred === true;
      let totalPurged = 0;

      // Filter: records with non-null content
      let candidates = data.records.filter(r => r.content != null && r.content !== undefined);
      if (!includeAll) {
        candidates = candidates.filter(r => r.is_starred !== 1);
      }

      // 1. Days-based
      if (retentionDays != null && retentionDays > 0) {
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const toPurge = candidates.filter(r => r.created_at < cutoffMs);
        for (const r of toPurge) {
          r.content = null;
        }
        totalPurged += toPurge.length;
      }

      // 2. Count-based
      if (maxRecords != null && maxRecords > 0) {
        let remaining = data.records.filter(r => r.content != null);
        if (!includeAll) {
          remaining = remaining.filter(r => r.is_starred !== 1);
        }
        if (remaining.length > maxRecords) {
          const excess = remaining.length - maxRecords;
          const sorted = [...remaining].sort((a, b) => a.created_at - b.created_at);
          const toPurge = sorted.slice(0, excess);
          for (const r of toPurge) {
            const record = data.records.find(rec => rec.id === r.id);
            if (record) record.content = null;
          }
          totalPurged += toPurge.length;
        }
      }

      await this.saveData(data);
      return { success: true, purged: totalPurged };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.loadData();
      return true;
    } catch {
      return false;
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
