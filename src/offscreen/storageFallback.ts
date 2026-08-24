/**
 * storageFallback.ts
 * chrome.storage.local-based fallback storage for environments where OPFS is unavailable.
 * Provides the same CRUD interface as sqlite.ts but uses linear search instead of FTS5.
 */

import { Mutex } from '../utils/Mutex.js';
import { UPDATABLE_FIELDS, buildInsertRecordFields } from './schema.js';
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';

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
    return this.allocateIds(1);
  }

  /**
   * Reserve a contiguous block of IDs in a single storage round-trip.
   * Returns the first ID; the next free counter becomes `start + count`.
   */
  private async allocateIds(count: number): Promise<number> {
    const result = await chrome.storage.local.get(STORAGE_KEY_COUNTER);
    const current = typeof result[STORAGE_KEY_COUNTER] === 'number' ? result[STORAGE_KEY_COUNTER] : 0;
    const start = current + 1;
    await chrome.storage.local.set({ [STORAGE_KEY_COUNTER]: current + count });
    return start;
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

      // Reserve all IDs in a single counter round-trip instead of one per record.
      const startId = await this.allocateIds(records.length);
      let idOffset = 0;

      for (const record of records) {
        const exists = data.records.some(r => r.url === record.url && r.created_at === record.created_at);
        if (exists) continue;

        const id = startId + idOffset;
        idOffset++;
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

  /**
   * Unified read path — handles both plain filtered listing and text search.
   */
  // Compatibility shim: old tests call storage.search(query, limit, offset, options).
  // After PBI-03 the search is unified into query({ text, ... }). Keep a
  // thin wrapper so pre-existing tests that use the old search API still pass
  // without editing 10+ files. New code should call query({ text }) directly.
  async search(
    searchQuery: string,
    limit: number = 50,
    offset: number = 0,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {},
  ): Promise<{
    success: true; rows: (BrowsingLogRecord & { rank: number })[]; total: number
  } | { success: false; error: string }> {
    return this.query({
      text: searchQuery,
      limit,
      offset,
      orderBy: options.orderBy as unknown as StorageQuery['orderBy'],
      orderDir: options.orderDir,
    } as StorageQuery);
  }

  async query(q: StorageQuery = {}): Promise<{
    success: true; rows: (BrowsingLogRecord & { rank: number })[]; total: number
  } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      let filtered = data.records;
      // Compatibility: support both old (isStarred/since/until) and new (starred/dateFrom/dateTo) param names
      const qAny = q as unknown as Record<string, unknown>;
      const effectiveStarred = (q.starred as unknown) ?? qAny['isStarred'] ?? qAny['starred'];
      const effectiveDateFrom = (q.dateFrom as unknown) ?? qAny['since'] ?? qAny['dateFrom'];
      const effectiveDateTo = (q.dateTo as unknown) ?? qAny['until'] ?? qAny['dateTo'];
      const effectiveExcludeDeleted = q.excludeDeleted ?? (qAny['excludeDeleted'] as boolean | undefined);

      if (effectiveExcludeDeleted !== false) {
        filtered = filtered.filter(r => r.is_deleted === 0);
      }
      if (q.domain) {
        filtered = filtered.filter(r => r.domain === q.domain);
      }
      if (effectiveStarred !== undefined) {
        filtered = filtered.filter(r => r.is_starred === (effectiveStarred ? 1 : 0));
      }
      if (effectiveDateFrom !== undefined) {
        filtered = filtered.filter(r => r.created_at >= (effectiveDateFrom as number));
      }
      if (effectiveDateTo !== undefined) {
        filtered = filtered.filter(r => r.created_at <= (effectiveDateTo as number));
      }
      if (q.gistSynced !== undefined) {
        filtered = filtered.filter(r => r.gist_synced === q.gistSynced);
      }
      // Also support is_starred passed via q
      if (qAny['is_starred'] !== undefined && q.starred === undefined && effectiveStarred === undefined) {
        const v = qAny['is_starred'] as number | boolean;
        filtered = filtered.filter(r => r.is_starred === (v ? 1 : 0));
      }

      // Text search (LIKE fallback — no FTS5 in chrome.storage path)
      if (q.text) {
        const query = q.text.toLowerCase();
        // Cache lowercased searchable strings for the lifetime of this query so
        // each record is materialized at most once (query never persists data).
        const searchCache = new Map<number, string>();
        filtered = filtered.filter(r => {
          const id = r.id!;
          let searchable = searchCache.get(id);
          if (searchable === undefined) {
            searchable = [r.url, r.title, r.summary, r.tags]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            searchCache.set(id, searchable);
          }
          return searchable.includes(query);
        });
      }

      const total = filtered.length;

      // Sorting — mirrors pre-PBI split behaviour:
      // - query (no text): default to created_at DESC when no orderBy given
      // - search (text): only sort by created_at when explicitly requested; otherwise keep insertion order (no FTS5 rank)
      const compareCreatedAt = (a: BrowsingLogRecord, b: BrowsingLogRecord, dir: number) => {
        if (a.created_at < b.created_at) return -1 * dir;
        if (a.created_at > b.created_at) return 1 * dir;
        return 0;
      };
      const compareField = (a: BrowsingLogRecord, b: BrowsingLogRecord, field: keyof BrowsingLogRecord, dir: number) => {
        const aVal = a[field]; const bVal = b[field];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
        return 0;
      };
      if (q.text) {
        if (q.orderBy === 'created_at') {
          const dir = q.orderDir === 'ASC' ? 1 : -1;
          filtered.sort((a, b) => compareCreatedAt(a, b, dir));
        }
        // else: no FTS5 rank in fallback path, keep insertion order
      } else {
        if (!q.orderBy || q.orderBy === 'created_at') {
          const dir = q.orderDir === 'ASC' ? 1 : -1;
          filtered.sort((a, b) => compareCreatedAt(a, b, dir));
        } else {
          const dir = q.orderDir === 'ASC' ? 1 : -1;
          filtered.sort((a, b) => compareField(a, b, q.orderBy as keyof BrowsingLogRecord, dir));
        }
      }

      const limit = q.limit ?? 100;
      const offset = q.offset ?? 0;
      const paged = filtered.slice(offset, offset + limit);

      const rows: (BrowsingLogRecord & { rank: number })[] = paged.map(r => ({
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
          Object.assign(record, { [f]: changes[f] });
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
