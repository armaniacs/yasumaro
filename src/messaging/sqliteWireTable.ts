/**
 * sqliteWireTable.ts
 *
 * Single routing + codec table for the 10 query/mutate ops
 * (PBI 2026-09-20-16, staged application of the archive wire-table pattern).
 *
 * Each query/mutate op used to be mapped 1:1 by hand in every hop
 * (gateway switch, offscreen handler, dashboard handler case, deps delegate,
 * service decode), so adding an op required editing 8 files and copy-paste
 * drift already had a proven fix in the archive group. The archive collapse
 * lives in archiveWireTable.ts; this table is its query/mutate twin and
 * follows the same structure (descriptor rows + derived dispatch +
 * compile-time two-way sync asserts).
 *
 * Neutral placement: same rule as the archive table — both background
 * (gateway, dashboard handlers) and offscreen (message handlers) already
 * depend on messaging, while background -> offscreen imports are forbidden,
 * so this file must not import from offscreen or background. Per-hop
 * preprocessing that needs layer types (record codec, query planners,
 * dashboard cap policy) stays in layer-owned runner maps:
 * - offscreen: SQLITE_REPO_RUNNERS in sqliteMessageHandlers.ts, keyed by
 *   repoMethod. The row only names the runner.
 * - background dashboard read path (readOnlyHandler.ts) and the import
 *   path (maintenanceBatchHandler.ts) are NOT table-driven: their payload
 *   policy (clampLimit caps, row-mapping, oversized guards) is layer policy,
 *   not wire codec. Read rows still pin subtype + service codec + sync
 *   asserts so drift fails at compile time.
 *
 * Deliberately NOT tabled here (PBI AC: existing paths kept):
 * - maintain ops (init/backup/restore/clearAll/purge/status/healthCheck):
 *   Uint8Array / boolean / degraded-status transforms are heterogeneous.
 * - archive ops: owned by ARCHIVE_WIRE_TABLE (asserted below — no
 *   SQLITE_ARCHIVE_* message may appear in this table).
 * - SQLITE_SEARCH offscreen handler: no QueryOp reaches it through the
 *   gateway (kind:'search' folds into SQLITE_QUERY via queryRecords), so it
 *   has no op key. It stays a hand-written handler, pinned by the existing
 *   offscreen-search-orderby tests.
 */

import type { MutateOp, QueryOp, AuditLogRecord } from './sqliteRpcClient.js';
import type { SqliteMessageType } from './sqliteMessages.js';
import type { DashboardSqliteSubtype } from './sqliteOperationSecurity.js';
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import { pickDefined } from '../utils/objectUtils.js';
import {
  requiredNonNegativeNumber,
  requiredRows,
  isBrowsingLogEntry,
  isAuditLogEntry,
} from './sqliteValidators.js';

/**
 * Dashboard-hop codecs for one row. subtype + serviceDecode (+ defaultError)
 * are present for every row with a dashboard path; validate / depsArgs /
 * projectDeps are present only while the background dashboard handler drives
 * that subtype from the row (coreCrud today; readOnly/import stay manual —
 * see the header note).
 */
export interface SqliteDashboardHop<S = unknown> {
  /** DASHBOARD_SQLITE subtype (snake_case twin of op). */
  subtype: DashboardSqliteSubtype;
  /** Dashboard fallback message when the failure carries no reason. */
  defaultError: string;
  /** Decodes the dashboard wire success shape into the service public value. */
  serviceDecode: (response: { success: true } & Record<string, unknown>) => S;
  /** Background payload shape check; null means the payload is acceptable. */
  validate?: (payload: Record<string, unknown>) => string | null;
  /** Deps args the background handler spreads. */
  depsArgs?: (payload: Record<string, unknown>) => unknown[];
  /** Projects deps data into the wire field set. */
  projectDeps?: (data: unknown) => Record<string, unknown>;
}

/**
 * Codec carried by one wire-table row.
 *
 * O is the MutateOp type / QueryOp kind discriminator, G the gateway client
 * value produced by decodeGateway, S the dashboard public value produced by
 * the dashboard hop's serviceDecode. Per-hop functions take wide params on
 * purpose (archive-table discipline): narrowing a function param per row
 * breaks assignability, so rows narrow inside with a documented cast while
 * returns stay precise via Extract.
 */
export interface SqliteWireOpDescriptor<O extends string = string, G = unknown, S = unknown> {
  /** MutateOp type or QueryOp kind (source of truth is the op unions). */
  op: O;
  /** Which client surface the op belongs to. */
  family: 'mutate' | 'query';
  /** background -> offscreen message type. */
  messageType: SqliteMessageType;
  /** Offscreen repo runner key (SQLITE_REPO_RUNNERS in sqliteMessageHandlers.ts). */
  repoMethod: string;
  /** DashboardSqliteHandlerDeps method, or null when no deps path exists. */
  depsMethod: string | null;
  /** Builds the op the deps delegates send to SqliteClient. */
  encodeOp: (...args: never[]) => MutateOp | QueryOp;
  /** Builds the wire payload the gateway sends offscreen. */
  encodePayload: (op: MutateOp | QueryOp) => Record<string, unknown>;
  /** Decodes the wire success shape into the gateway client value. */
  decodeGateway: (response: { success: true } & Record<string, unknown>) => G;
  /** Dashboard-hop codecs, or null when the op has no dashboard subtype. */
  dashboard: SqliteDashboardHop<S> | null;
}

/** Single constructor for table rows; preserves literal types per row. */
export function defineSqliteWireOp<const R extends SqliteWireOpDescriptor<string, unknown, unknown>>(row: R): R {
  return row;
}

export const SQLITE_WIRE_TABLE = [
  defineSqliteWireOp({
    op: 'insert',
    family: 'mutate',
    messageType: 'SQLITE_INSERT',
    repoMethod: 'insert',
    depsMethod: 'insert',
    encodeOp: (record: BrowsingLogRecord): Extract<MutateOp, { type: 'insert' }> => ({ type: 'insert', record }),
    encodePayload: (op) => (op as Extract<MutateOp, { type: 'insert' }>).record as unknown as Record<string, unknown>,
    decodeGateway: (response) => ({ id: response.id as number }),
    dashboard: null,
  }),
  defineSqliteWireOp({
    op: 'insertBatch',
    family: 'mutate',
    messageType: 'SQLITE_INSERT_BATCH',
    repoMethod: 'insertBatch',
    depsMethod: 'insertBatch',
    encodeOp: (records: BrowsingLogRecord[]): Extract<MutateOp, { type: 'insertBatch' }> => ({ type: 'insertBatch', records }),
    encodePayload: (op) => ({ records: (op as Extract<MutateOp, { type: 'insertBatch' }>).records as unknown as Record<string, unknown>[] }),
    decodeGateway: (response) => ({
      count: (response.inserted as number | undefined) ?? (response.count as number),
      skipped: (response.skipped as number | undefined) ?? 0,
    }),
    // No dashboard block: the only dashboard path ('import') carries
    // row-mapping + oversized-guard policy owned by maintenanceBatchHandler.
    dashboard: null,
  }),
  defineSqliteWireOp({
    op: 'update',
    family: 'mutate',
    messageType: 'SQLITE_UPDATE',
    repoMethod: 'update',
    depsMethod: 'update',
    encodeOp: (
      id: number,
      changes: Partial<Record<string, unknown>>,
    ): Extract<MutateOp, { type: 'update' }> => ({ type: 'update', id, changes }),
    // Flattened wire contract: changes travel as `{ id, ...changes }`, not
    // nested under a `changes` key. The offscreen update runner reads flat
    // keys via `key in payload`, so a nested shape would silently apply zero
    // columns instead of failing.
    encodePayload: (op) => {
      const o = op as Extract<MutateOp, { type: 'update' }>;
      return { id: o.id, ...o.changes };
    },
    decodeGateway: () => undefined,
    dashboard: {
      subtype: 'update',
      defaultError: 'Update failed',
      serviceDecode: () => undefined,
      validate: () => null,
      depsArgs: (p) => [p.id as number, (p.changes as Record<string, unknown> | undefined) ?? {}],
      projectDeps: () => ({}),
    },
  }),
  defineSqliteWireOp({
    op: 'delete',
    family: 'mutate',
    messageType: 'SQLITE_DELETE',
    repoMethod: 'delete',
    depsMethod: 'delete',
    encodeOp: (id: number): Extract<MutateOp, { type: 'delete' }> => ({ type: 'delete', id }),
    encodePayload: (op) => ({ id: (op as Extract<MutateOp, { type: 'delete' }>).id }),
    decodeGateway: () => undefined,
    dashboard: {
      subtype: 'delete',
      defaultError: 'Delete failed',
      serviceDecode: () => undefined,
      validate: () => null,
      depsArgs: (p) => [p.id as number],
      projectDeps: () => ({}),
    },
  }),
  defineSqliteWireOp({
    op: 'toggleStar',
    family: 'mutate',
    messageType: 'SQLITE_TOGGLE_STAR',
    repoMethod: 'toggleStar',
    depsMethod: 'toggleStar',
    encodeOp: (id: number): Extract<MutateOp, { type: 'toggleStar' }> => ({ type: 'toggleStar', id }),
    encodePayload: (op) => ({ id: (op as Extract<MutateOp, { type: 'toggleStar' }>).id }),
    decodeGateway: (response) => ({ is_starred: response.is_starred as number }),
    dashboard: {
      subtype: 'toggle_star',
      defaultError: 'Toggle star failed',
      serviceDecode: (response) => ({ is_starred: requiredNonNegativeNumber(response.is_starred, 'is_starred') }),
      validate: () => null,
      depsArgs: (p) => [p.id as number],
      projectDeps: (data) => ({ is_starred: (data as { is_starred: number }).is_starred }),
    },
  }),
  defineSqliteWireOp({
    op: 'insertAuditLog',
    family: 'mutate',
    messageType: 'SQLITE_AUDIT_LOG_INSERT',
    repoMethod: 'insertAuditLog',
    // No deps path: the only caller (utils/auditLog.ts) drives SqliteClient
    // directly, and no dashboard subtype exists.
    depsMethod: null,
    encodeOp: (record: Omit<AuditLogRecord, 'id'>): Extract<MutateOp, { type: 'insertAuditLog' }> => ({
      type: 'insertAuditLog',
      record,
    }),
    encodePayload: (op) => (op as Extract<MutateOp, { type: 'insertAuditLog' }>).record as unknown as Record<string, unknown>,
    decodeGateway: (response) => ({ id: response.id as number }),
    dashboard: null,
  }),
  defineSqliteWireOp({
    op: 'records',
    family: 'query',
    messageType: 'SQLITE_QUERY',
    repoMethod: 'query',
    depsMethod: 'query',
    encodeOp: (q?: StorageQuery): Extract<QueryOp, { kind: 'records' }> =>
      q === undefined ? { kind: 'records' } : { kind: 'records', q },
    encodePayload: (op) => ((op as Extract<QueryOp, { kind: 'records' }>).q ?? {}) as Record<string, unknown>,
    decodeGateway: (response) => ({
      rows: ((response.rows as unknown[] | undefined) || []) as BrowsingLogRecord[],
      total: response.total as number,
    }),
    dashboard: {
      subtype: 'query',
      defaultError: 'Query failed',
      serviceDecode: (response) => ({
        rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
        total: requiredNonNegativeNumber(response.total, 'total'),
      }),
    },
  }),
  defineSqliteWireOp({
    op: 'search',
    family: 'query',
    // Folded into SQLITE_QUERY at the gateway (the QueryOp is rebuilt as a
    // StorageQuery with text); SQLITE_SEARCH is only reachable by direct
    // offscreen messages and stays hand-written (see header note).
    messageType: 'SQLITE_QUERY',
    repoMethod: 'search',
    depsMethod: 'search',
    encodeOp: (
      text: string,
      limit: number,
      offset: number,
      options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' },
    ): Extract<QueryOp, { kind: 'search' }> => ({
      kind: 'search',
      text,
      limit,
      offset,
      ...pickDefined({ orderBy: options?.orderBy, orderDir: options?.orderDir }),
    }),
    encodePayload: (op) => {
      const o = op as Extract<QueryOp, { kind: 'search' }>;
      return { text: o.text, ...pickDefined({ limit: o.limit, offset: o.offset, orderBy: o.orderBy, orderDir: o.orderDir }) } as Record<string, unknown>;
    },
    decodeGateway: (response) => ({
      rows: ((response.rows as unknown[] | undefined) || []) as BrowsingLogRecord[],
      total: response.total as number,
    }),
    dashboard: {
      subtype: 'search',
      defaultError: 'Query failed',
      serviceDecode: (response) => ({
        rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
        total: requiredNonNegativeNumber(response.total, 'total'),
      }),
    },
  }),
  defineSqliteWireOp({
    op: 'count',
    family: 'query',
    messageType: 'SQLITE_COUNT',
    repoMethod: 'count',
    depsMethod: 'getCount',
    encodeOp: (): Extract<QueryOp, { kind: 'count' }> => ({ kind: 'count' }),
    encodePayload: () => ({}),
    decodeGateway: (response) => {
      if (!Number.isFinite(response.count as number)) throw new Error('SQLite count response was missing a numeric count');
      return response.count as number;
    },
    dashboard: {
      subtype: 'get_count',
      defaultError: 'Get count failed',
      serviceDecode: (response) => requiredNonNegativeNumber(response.count, 'count'),
    },
  }),
  defineSqliteWireOp({
    op: 'auditLog',
    family: 'query',
    messageType: 'SQLITE_AUDIT_LOG_QUERY',
    repoMethod: 'auditLogQuery',
    depsMethod: 'queryAuditLog',
    encodeOp: (options?: { limit?: number; offset?: number }): Extract<QueryOp, { kind: 'auditLog' }> => ({
      kind: 'auditLog',
      // exactOptionalPropertyTypes: absent stays absent (handler applies the
      // same ?? defaults either way, so the wire outcome is identical).
      ...(options?.limit !== undefined && { limit: options.limit }),
      ...(options?.offset !== undefined && { offset: options.offset }),
    }),
    encodePayload: (op) => {
      const o = op as Extract<QueryOp, { kind: 'auditLog' }>;
      return { limit: o.limit, offset: o.offset } as Record<string, unknown>;
    },
    decodeGateway: (response) => ({
      rows: ((response.rows as unknown[] | undefined) || []) as AuditLogRecord[],
      total: response.total as number,
    }),
    dashboard: {
      subtype: 'audit_log_query',
      defaultError: 'Audit log query failed',
      serviceDecode: (response) => ({
        rows: requiredRows(response.rows, 'rows', isAuditLogEntry),
        total: requiredNonNegativeNumber(response.total, 'total'),
      }),
    },
  }),
];

export type SqliteWireDescriptor = (typeof SQLITE_WIRE_TABLE)[number];

export type SqliteWireOp = SqliteWireDescriptor['op'];
export type SqliteWireMessageType = SqliteWireDescriptor['messageType'];

/** Gateway client value a descriptor decodes to. */
export type DescriptorGateway<D> = D extends { decodeGateway: (...args: never[]) => infer G } ? G : never;

/** Dashboard public value a descriptor decodes to. */
export type DescriptorService<D> = D extends {
  dashboard: { serviceDecode: (...args: never[]) => infer S } | null;
} ? S : never;

/** Precise per-op view over the table; indexing never yields undefined. */
export type SqliteWireDescriptorMap = {
  readonly [O in SqliteWireOp]: Extract<SqliteWireDescriptor, { op: O }>;
};

export const SQLITE_WIRE_DESCRIPTORS: SqliteWireDescriptorMap = Object.fromEntries(
  SQLITE_WIRE_TABLE.map((entry) => [entry.op, entry]),
) as SqliteWireDescriptorMap;

// Compile-time two-way sync with the MutateOp union: adding a mutate op
// without a table row (or vice versa) is a type error.
type MutateTableOp = Extract<SqliteWireDescriptor, { family: 'mutate' }>['op'];
type MissingMutateFromTable = Exclude<MutateOp['type'], MutateTableOp>;
type StaleMutateInTable = Exclude<MutateTableOp, MutateOp['type']>;
const _mutateCovered: MissingMutateFromTable extends never ? true : never = true;
const _mutateLive: StaleMutateInTable extends never ? true : never = true;
void _mutateCovered;
void _mutateLive;

// Compile-time two-way sync with the QueryOp union.
type QueryTableOp = Extract<SqliteWireDescriptor, { family: 'query' }>['op'];
type MissingQueryFromTable = Exclude<QueryOp['kind'], QueryTableOp>;
type StaleQueryInTable = Exclude<QueryTableOp, QueryOp['kind']>;
const _queryCovered: MissingQueryFromTable extends never ? true : never = true;
const _queryLive: StaleQueryInTable extends never ? true : never = true;
void _queryCovered;
void _queryLive;

// The archive group owns its own table — no archive message may appear here.
type ArchiveLeak = Extract<SqliteWireMessageType, `SQLITE_ARCHIVE_${string}`>;
const _noArchiveLeak: ArchiveLeak extends never ? true : never = true;
void _noArchiveLeak;

// Compile-time sync with the dashboard subtypes: every row dashboard block
// must name a real subtype — otherwise the dashboard and background disagree
// on routing. (Reverse direction is impossible: the dashboard owns ~30
// subtypes outside this subset.)
type TableSubtype = NonNullable<SqliteWireDescriptor['dashboard']>['subtype'];
type StaleSubtype = Exclude<TableSubtype, DashboardSqliteSubtype>;
const _subtypesLive: StaleSubtype extends never ? true : never = true;
void _subtypesLive;

const BY_OP: ReadonlyMap<string, SqliteWireDescriptor> = new Map(
  SQLITE_WIRE_TABLE.map((entry) => [entry.op, entry]),
);

export function sqliteWireFor(op: string): SqliteWireDescriptor | undefined {
  return BY_OP.get(op);
}

export function isSqliteWireOp(op: string): op is SqliteWireOp {
  return BY_OP.has(op);
}
