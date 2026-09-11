/**
 * InMemoryTransport
 * An OffscreenTransport backed by an in-memory record array.
 *
 * Lets SqliteGateway (and SqliteClient) be exercised in tests without an
 * offscreen document or any chrome.* API: insert a record, query it back,
 * count, toggle star, and read status all round-trip through the same seam
 * production uses.
 *
 * Known intentional divergence — DELETE: this transport approximates DELETE
 * as a soft delete (sets `is_deleted = 1`, row stays in the array), while
 * every production backend hard-deletes the row (FallbackStorageAdapter
 * `hardDelete`, opfsWorker `handleHardDelete`, sqliteMessageHandlers
 * `handleDelete`). The two are deliberately NOT unified: this transport is
 * not a SQL engine, and soft-delete approximation keeps the double light.
 * Callers that assert on post-DELETE row identity, UPDATE-on-deleted, or
 * duplicate detection must verify against a production backend instead.
 * See dev-docs/TEST_DOUBLES_DIVERGENCE.md for the registry of divergences.
 *
 * This is deliberately not a full SQL engine — it covers the operations the
 * gateway issues, with a filter that mirrors buildExtraWhereSql's semantics
 * (domain / starred / date range / ids) plus a substring match for `text`.
 */

import type { OffscreenTransport } from './offscreenTransport.js';
import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type { OffscreenResponse } from '../messaging/sqliteMessages.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { sanitizeFtsTerm } from '../offscreen/schema.js';
import { QUERY_CAPS, clampLimit, matchesExtraWhere } from '../offscreen/queryPlan.js';

interface QueryPayload {
  text?: string;
  domain?: string;
  starred?: boolean;
  dateFrom?: number;
  dateTo?: number;
  gistSynced?: number;
  ids?: number[];
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface InMemoryTransportOptions {
  /** Seed records. Ids are assigned if absent. */
  records?: BrowsingLogRecord[];
  /** Overrides for the STATUS response. */
  status?: Partial<Extract<OffscreenResponse, { initialized: boolean; path: string }>>;
}

export class InMemoryTransport implements OffscreenTransport {
  private records: BrowsingLogRecord[] = [];
  private nextId = 1;
  private cleared = false;
  private readonly statusOverrides: InMemoryTransportOptions['status'];

  /** The last payload handled — handy for asserting what the gateway sent. */
  lastPayload: Record<string, unknown> | null = null;

  constructor(opts: InMemoryTransportOptions = {}) {
    this.statusOverrides = opts.status;
    for (const r of opts.records ?? []) this.insertRecord(r);
  }

  /** Current record snapshot (copy) for assertions. */
  getRecords(): BrowsingLogRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  async msgOffscreen(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    _traceId?: string
  ): Promise<OffscreenResponse> {
    this.lastPayload = payload;
    switch (type) {
      case 'SQLITE_INIT':
      case 'SQLITE_HEALTH_CHECK':
        return { success: true, initialized: true };

      case 'SQLITE_INSERT': {
        const id = this.insertRecord(payload as unknown as BrowsingLogRecord);
        return { success: true, id };
      }
      case 'SQLITE_INSERT_BATCH': {
        // Test double: no UNIQUE-constraint simulation, so skipped stays 0 and
        // inserted reports the full batch (PBI 2026-09-11-07 wire shape).
        const list = (payload.records as BrowsingLogRecord[] | undefined) ?? [];
        for (const r of list) this.insertRecord(r);
        return { success: true, count: list.length, inserted: list.length, skipped: 0 };
      }
      case 'SQLITE_AUDIT_LOG_INSERT':
        return { success: true, id: this.nextId++ };

      case 'SQLITE_QUERY':
      case 'SQLITE_SEARCH': {
        const { rows, total } = this.select(payload as QueryPayload);
        return { success: true, rows, total };
      }
      case 'SQLITE_AUDIT_LOG_QUERY':
        return { success: true, rows: [], total: 0 };

      case 'SQLITE_COUNT': {
        const { total } = this.select(payload as QueryPayload, { countOnly: true });
        return { success: true, count: total };
      }

      case 'SQLITE_UPDATE': {
        const { id, ...changes } = payload as { id: number } & Partial<BrowsingLogRecord>;
        const row = this.records.find((r) => r.id === id);
        if (row) Object.assign(row, changes);
        return { success: true };
      }
      case 'SQLITE_DELETE': {
        const id = payload.id as number;
        const row = this.records.find((r) => r.id === id);
        // Soft-delete approximation, same drift-prevention level as select():
        // production hard-deletes the row (FallbackStorageAdapter hardDelete /
        // crudHandlers handleHardDelete / sqliteMessageHandlers handleDelete).
        // Unified on purpose: keeping the double light beats simulating SQL
        // DELETE. Divergent observations (UPDATE on a deleted row succeeds via
        // find+assign here, deleted rows linger in getRecords(), DELETE+INSERT
        // duplicate detection differs) are pinned as spec in
        // dev-docs/TEST_DOUBLES_DIVERGENCE.md — verify those against a
        // production backend (opfsWorker.test.ts / e2e).
        if (row) row.is_deleted = 1;
        return { success: true };
      }
      case 'SQLITE_TOGGLE_STAR': {
        const id = payload.id as number;
        const row = this.records.find((r) => r.id === id);
        const next = row?.is_starred ? 0 : 1;
        if (row) row.is_starred = next;
        return { success: true, is_starred: next };
      }
      case 'SQLITE_CLEAR_ALL':
        this.records = [];
        this.cleared = true;
        return { success: true };
      case 'SQLITE_RESTORE':
        return { success: true };

      case 'SQLITE_STATUS':
        return {
          success: true,
          initialized: true,
          path: ':memory:',
          fallback: false,
          fts5: true,
          ...this.statusOverrides,
        };

      case 'SQLITE_PURGE':
      case 'CONTENT_PURGE':
        return { success: true, purged: 0 };

      case 'SQLITE_BACKUP':
      case 'SQLITE_EXPORT':
        return { success: true, data: [] };

      case 'SQLITE_ARCHIVE_EXPORT':
        return { success: true, chunk: [], nextOffset: 0, total: 0, done: true };

      case 'SQLITE_ARCHIVE_PREVIEW':
      case 'SQLITE_ARCHIVE_CREATE':
      case 'SQLITE_ARCHIVE_CLEANUP':
      case 'SQLITE_ARCHIVE_DELETE_BY_STAGING':
        // Not implemented here on purpose: VACUUM / freelist accounting
        // (freelistBefore/freelistAfter) cannot be verified without a real
        // storage engine. Verify against production backends only
        // (opfsWorker.test.ts / testDir e2e archive specs).
        return { success: false, error: 'Archive is not supported by InMemoryTransport' };

      case 'SQLITE_ARCHIVE_PREPARE_INCOMING':
      case 'SQLITE_ARCHIVE_RESTORE_PREVIEW':
      case 'SQLITE_ARCHIVE_RESTORE':
      case 'SQLITE_ARCHIVE_OPEN':
      case 'SQLITE_ARCHIVE_QUERY':
      case 'SQLITE_ARCHIVE_UPDATE':
      case 'SQLITE_ARCHIVE_SAVE':
      case 'SQLITE_ARCHIVE_CLOSE':
      case 'SQLITE_ARCHIVE_STATUS':
        return { success: false, error: 'Archive is not supported by InMemoryTransport' };

      default: {
        const exhaustive: never = type;
        return { success: false, error: `InMemoryTransport: unhandled message '${String(exhaustive)}'` };
      }
    }
  }

  // ------------------------------------------------------------------------

  private insertRecord(record: BrowsingLogRecord): number {
    const id = record.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    this.records.push({ ...record, id });
    return id;
  }

  private select(
    q: QueryPayload,
    opts: { countOnly?: boolean } = {}
  ): { rows: BrowsingLogRecord[]; total: number } {
    let rows = this.records.filter((r) => !r.is_deleted);

    // Delegate extra-where filtering to the shared predicate derived from
    // buildExtraWhereSql's condition set — do not reimplement the checks
    // inline so drift is impossible without touching the shared module.
    rows = rows.filter((r) => matchesExtraWhere(r, q as unknown as Parameters<typeof matchesExtraWhere>[1]));
    if (q.text) {
      const bare = sanitizeFtsTerm(q.text);
      if (!bare) {
        rows = [];
      } else {
        const terms = bare.toLowerCase().split(/\s+/).filter(Boolean);
        rows = rows.filter((r) => {
          const fields = [r.title, r.summary, r.content, r.url]
            .filter((f): f is string => typeof f === 'string')
            .map((f) => f.toLowerCase());
          // Shared tokenizer may split hyphens into spaces; require every term present (AND)
          return terms.every((term) => fields.some((f) => f.includes(term)));
        });
      }
    }

    const total = rows.length;
    if (opts.countOnly) return { rows: [], total };

    const dir = q.orderDir === 'ASC' ? 1 : -1;
    const key = (q.orderBy as keyof BrowsingLogRecord) || 'created_at';
    rows = [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });

    const cap = q.text ? QUERY_CAPS.fts : QUERY_CAPS.plain;
    const limit = clampLimit(q.limit, cap, cap);
    const offset = clampLimit(q.offset, Number.MAX_SAFE_INTEGER, 0);
    return { rows: rows.slice(offset, offset + limit), total };
  }

  /** Test helper: whether SQLITE_CLEAR_ALL was received. */
  wasCleared(): boolean {
    return this.cleared;
  }
}
