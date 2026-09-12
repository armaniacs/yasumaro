/**
 * storageFallback.ts
 * chrome.storage.local-based fallback storage for environments where OPFS is unavailable.
 * Provides the same CRUD interface as sqlite.ts but uses linear search instead of FTS5.
 */

import { Mutex } from '../utils/Mutex.js';
import { extractDomain } from '../utils/domainUtils.js';
import { UPDATABLE_FIELDS, buildInsertRecordFields } from './schema.js';
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import { buildQuerySpec, QUERY_CAPS, matchesExtraWhere } from './queryPlan.js';

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

  /**
   * Serialized read-modify-write helper.
   *
   * Acquires `this.mutex`, loads the current data, applies the pure transform
   * `fn`, persists the returned `next` state, and releases the lock in a
   * `finally` block. This is the single locking discipline every mutator must
   * use so that concurrent mutations (e.g. purgeOldRecords vs toggleStar)
   * cannot clobber each other's blob writes.
   *
   * Contract for `fn`:
   * - MUST be a pure transform: derive `next` from the given `data` and return
   *   it together with the caller's `result` value. Do not perform storage I/O.
   * - MUST NOT call `mutate` (directly or transitively) — the mutex is not
   *   reentrant and doing so deadlocks.
   *
   * If `saveData` throws, the exception propagates to the caller and the lock
   * is still released by `finally`. The persisted state is left untouched
   * (the failed write never landed), so no half-written blob results.
   */
  private async mutate<T>(fn: (data: StoredData) => { next: StoredData; result: T }): Promise<T> {
    await this.mutex.acquire();
    try {
      const data = await this.loadData();
      const { next, result } = fn(data);
      await this.saveData(next);
      return result;
    } finally {
      this.mutex.release();
    }
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

  // insert / insertBatch keep bespoke locking rather than routing through
  // `mutate`, but on the SAME `this.mutex`, so they still serialize against
  // every other mutator. They cannot use `mutate`'s pure-fn contract because
  // the "dedupe-check THEN allocate IDs" ordering (PBI 2026-08-27-06) requires
  // side-effecting storage I/O in the middle of the RMW: `ensureQuotaSpace`
  // and `allocateIds` both touch chrome.storage and must run after the dedupe
  // check but before the records are appended.
  async insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
    await this.mutex.acquire();
    try {
      await this.ensureQuotaSpace();
      const data = await this.loadData();
      const exists = data.records.some(r => r.url === record.url && r.created_at === record.created_at);
      if (exists) {
        return { success: true, id: -1 };
      }
      const id = await this.getNextId();
      const domain = record.domain || this.extractDomain(record.url);

      const newRecord: BrowsingLogRecord = {
        id,
        ...buildInsertRecordFields(record, domain),
      };

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

      // Deduplicate against existing data and within-batch duplicates before allocating IDs
      const existingKeys = new Set(data.records.map(r => `${r.url}\0${r.created_at}`));
      const seen = new Set<string>();
      const toInsert: BrowsingLogRecord[] = [];
      for (const record of records) {
        const key = `${record.url}\0${record.created_at}`;
        if (existingKeys.has(key) || seen.has(key)) continue;
        seen.add(key);
        toInsert.push(record);
      }

      if (toInsert.length === 0) {
        return { success: true, count: 0 };
      }

      const startId = await this.allocateIds(toInsert.length);
      let insertedCount = 0;

      for (let i = 0; i < toInsert.length; i++) {
        const record = toInsert[i]!;
        const id = startId + i;
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
   * Full-table scan for the export path (PBI 2026-09-12-28).
   *
   * The capped `query()` clamps `limit` to QUERY_CAPS.plain (10000), which
   * silently truncated exports on this backend while the SQL backends'
   * serialize SELECTs are unbounded. This bypasses the paging policy on
   * purpose: export is an explicit full-snapshot request, not a paged read.
   */
  async exportAllRecords(): Promise<{ success: true; rows: BrowsingLogRecord[] } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const rows = data.records
        .filter(r => r.is_deleted === 0)
        .sort((a, b) => b.created_at - a.created_at);
      return { success: true, rows };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Unified read path — handles both plain filtered listing and text search.
   */
  async query(q: StorageQuery = {}): Promise<{
    success: true; rows: (BrowsingLogRecord & { rank: number })[]; total: number
  } | { success: false; error: string }> {
    try {
      const spec = buildQuerySpec(q, { caps: QUERY_CAPS, fts5Available: false });
      if (spec.error) return { success: false, error: spec.error };
      const data = await this.loadData();
      let filtered = data.records;
      // PBI 2026-09-12-13: trust the planner seam — `q` arrives normalized
      // (normalizeStorageQuery collapses starred|isStarred|is_starred,
      // dateFrom|since, dateTo|until), so the local alias re-derivation is
      // deleted and the canonical query feeds matchesExtraWhere directly.
      if (q.excludeDeleted !== false) {
        filtered = filtered.filter(r => r.is_deleted === 0);
      }
      filtered = filtered.filter(r => matchesExtraWhere(r, q));

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

      const limit = spec.limit;
      const offset = spec.offset;
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
      await this.mutate<void>(data => {
        const record = data.records.find(r => r.id === id);
        if (record) {
          for (const field of UPDATABLE_FIELDS) {
            const f = field as keyof BrowsingLogRecord;
            if (f in changes) {
              Object.assign(record, { [f]: changes[f] });
            }
          }
        }
        return { next: data, result: undefined };
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async hardDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
    try {
      await this.mutate<void>(data => {
        data.records = data.records.filter(r => r.id !== id);
        return { next: data, result: undefined };
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
    try {
      const nextStarred = await this.mutate<number | null>(data => {
        const record = data.records.find(r => r.id === id);
        if (!record) {
          return { next: data, result: null };
        }
        record.is_starred = record.is_starred === 0 ? 1 : 0;
        return { next: data, result: record.is_starred };
      });
      if (nextStarred === null) {
        return { success: false, error: 'Record not found' };
      }
      return { success: true, is_starred: nextStarred };
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
      await this.mutate<void>(() => ({ next: { records: [] }, result: undefined }));
      await chrome.storage.local.set({ [STORAGE_KEY_COUNTER]: 0 });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async purgeOldRecords(retentionDays?: number | undefined, maxRecords?: number | undefined): Promise<{ success: true; purged: number } | { success: false; error: string }> {
    try {
      // PBI 2026-09-12-36: skip guards — same contract as purgeContent and
      // the SQL backends. Before this, (0,0) purged everything (cutoff = now)
      // while content-purge(0,0) was a no-op.
      const purged = await this.mutate<number>(data => {
        let count = 0;

        if (retentionDays != null && retentionDays > 0) {
          const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
          data.records = data.records.filter(r => {
            if (r.is_starred === 1 || r.is_deleted === 1) return true;
            if (r.created_at < cutoffMs) {
              count++;
              return false;
            }
            return true;
          });
        }

        if (maxRecords != null && maxRecords > 0) {
          const activeRecords = data.records.filter(r => r.is_deleted === 0);
          if (activeRecords.length > maxRecords) {
            const sorted = [...activeRecords].sort((a, b) => a.created_at - b.created_at);
            const toRemove = new Set(sorted.slice(0, activeRecords.length - maxRecords).map(r => r.id));
            data.records = data.records.filter(r => {
              if (toRemove.has(r.id)) {
                count++;
                return false;
              }
              return true;
            });
          }
        }

        return { next: data, result: count };
      });
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
      const totalPurged = await this.mutate<number>(data => {
        const includeAll = includeStarred === true;
        let count = 0;

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
          count += toPurge.length;
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
            count += toPurge.length;
          }
        }

        return { next: data, result: count };
      });
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

  private extractDomain(url: string): string | null {
    return extractDomain(url);
  }
}
