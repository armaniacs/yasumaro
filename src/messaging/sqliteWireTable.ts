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
 * - heterogeneous maintain transports (init/backup-bytes/restore-bytes/
 *   clearAll/purge/status/healthCheck) where the wire shapes need
 *   layer-owned transforms — PBI 2026-09-23-02 tabled the homogeneous
 *   dashboard subset (migrate/clearAll/status/cleanup/backfill/resync/
 *   backup-string/restore/import/purges/append) in DASHBOARD_SERVICE_TABLE
 *   below; the byte and degraded-status edges stay with the dashboard tier.
 * - archive ops: owned by ARCHIVE_WIRE_TABLE (asserted below — no
 *   SQLITE_ARCHIVE_* message may appear in this table).
 * - SQLITE_SEARCH offscreen handler: no QueryOp reaches it through the
 *   gateway (kind:'search' folds into SQLITE_QUERY via queryRecords), so it
 *   has no op key. It stays a hand-written handler, pinned by the existing
 *   offscreen-search-orderby tests.
 */

import type { MaintainOp, MutateOp, QueryOp, AuditLogRecord } from './sqliteRpcClient.js';
import type { SqliteMessageType } from './sqliteMessages.js';
import type { SqliteStatusResult } from './sqliteMessages.js';
import type { DashboardSqliteSubtype } from './sqliteOperationSecurity.js';
import type { ArchiveOpType } from './archiveWireTable.js';
import { getTransportRetryPolicy, type TransportRetryPolicy } from './transportRetryPolicy.js';
import type { BrowsingLogRecord, StorageQuery } from '../utils/sqlite-types.js';
import { pickDefined } from '../utils/objectUtils.js';
import {
  requiredNonNegativeNumber,
  requiredBoolean,
  requiredString,
  requiredRows,
  decodeStatusExtras,
  isBrowsingLogEntry,
  isAuditLogEntry,
} from './sqliteValidators.js';

/**
 * Retry policy owned by one dashboard-hop row (PBI 2026-09-23-02).
 *
 * Previously the read paths (records/search) passed `{ retryAttempts: 2 }`
 * from the service call site while every other op stayed single-attempt by
 * omission — the policy lived with callers. Rows now carry it, so the
 * runner applies it without caller flags.
 */
export interface DashboardRetryPolicy {
  retryAttempts?: number;
  retryDelayMs?: number;
}

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
  /**
   * Row-owned retry (PBI 2026-09-23-02): present only on the read paths that
   * tolerate a retry (records/search); absent means single attempt. Callers
   * never pass retry flags — the runner reads this field.
   */
  retry?: DashboardRetryPolicy;
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
  retryPolicy: TransportRetryPolicy;
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

type SqliteWireOpRow = Omit<SqliteWireOpDescriptor<string, unknown, unknown>, 'retryPolicy'>;

export function defineSqliteWireOp<const R extends SqliteWireOpRow>(row: R): R & { retryPolicy: TransportRetryPolicy } {
  return { ...row, retryPolicy: getTransportRetryPolicy(row.messageType) };
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
    // columns instead of failing. A `changes.id` key would override the
    // routing id here (spread order), so it is stripped — a wrong-row write
    // must be impossible even for callers that spread a whole row object
    // (Checking Team 2026-09-22: Red Team Low).
    encodePayload: (op) => {
      const o = op as Extract<MutateOp, { type: 'update' }>;
      const { id: _dropRoutingOverride, ...rest } = o.changes;
      return { id: o.id, ...rest };
    },
    decodeGateway: () => undefined,
    dashboard: {
      subtype: 'update',
      defaultError: 'Update failed',
      serviceDecode: () => undefined,
      // Explicit single attempt: the background coreCrud handler pins driven
      // rows with Required<> (validate/depsArgs/projectDeps must be present),
      // which also pins this field — absent and { retryAttempts: 1 } both
      // mean one gateway attempt, so the explicit form keeps that assert
      // passing without changing runtime behavior.
      retry: { retryAttempts: 1 },
      // Fail-closed on malformed payloads (Checking Team 2026-09-22: Data
      // Integrity Medium) — an empty changes object would otherwise succeed
      // as a zero-column update, looking successful while writing nothing.
      validate: (p) => {
        const id = (p as { id?: unknown }).id;
        if (!Number.isInteger(id) || (id as number) <= 0) {
          return 'update requires a positive integer id';
        }
        const changes = (p as { changes?: unknown }).changes;
        if (
          changes === null ||
          typeof changes !== 'object' ||
          Object.keys(changes as Record<string, unknown>).length === 0
        ) {
          return 'update requires a non-empty changes object';
        }
        return null;
      },
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
      // Single attempt, explicit for the Required<> driven-row pin (see update).
      retry: { retryAttempts: 1 },
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
      // Single attempt, explicit for the Required<> driven-row pin (see update).
      retry: { retryAttempts: 1 },
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
      // Read path tolerates one retry (SQLite init timing) — owned here so
      // callers cannot forget or misconfigure it.
      retry: { retryAttempts: 2, retryDelayMs: 1000 },
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
      // Undefined rides the wire and the offscreen planner owns the search
      // default (planSearch → DEFAULT_SEARCH_LIMIT = 50) since PBI 2026-09-21-20.
      limit?: number,
      offset?: number,
      options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' },
    ): Extract<QueryOp, { kind: 'search' }> => ({
      kind: 'search',
      text,
      ...(limit !== undefined && { limit }),
      ...(offset !== undefined && { offset }),
      ...pickDefined({ orderBy: options?.orderBy, orderDir: options?.orderDir }),
    }),
    encodePayload: (op) => {
      const o = op as Extract<QueryOp, { kind: 'search' }>;
      // `kind: 'search'` marker: the gateway folds search into SQLITE_QUERY
      // and the offscreen 'records' runner routes on this marker so the
      // search route keeps its planner-owned default (planSearch → 50)
      // instead of falling into planQuery's listing default (100).
      // (Checking Team 2026-09-22: Legacy Bridge Medium.) Additive on the
      // wire — normalizeStorageQuery drops unknown keys.
      return { kind: 'search', text: o.text, ...pickDefined({ limit: o.limit, offset: o.offset, orderBy: o.orderBy, orderDir: o.orderDir }) } as Record<string, unknown>;
    },
    decodeGateway: (response) => ({
      rows: ((response.rows as unknown[] | undefined) || []) as BrowsingLogRecord[],
      total: response.total as number,
    }),
    dashboard: {
      subtype: 'search',
      defaultError: 'Query failed',
      // Same init-timing retry as the records read path (row-owned).
      retry: { retryAttempts: 2, retryDelayMs: 1000 },
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

// ============================================================================
// Dashboard service table (PBI 2026-09-23-02)
//
// The 12 DASHBOARD_SQLITE subtypes with no query/mutate row and no archive
// row used to be decoded inline in dashboardSqliteService (one decode lambda
// + one fallback string per public function). Each row here owns the same
// triple the wire rows own — subtype (routing/encode discriminator),
// serviceDecode, defaultError — plus the row-owned retry (absent everywhere
// here: none of these ops retries). The dashboard-tier runner derives all
// three from the row, so a new op is one table row plus a one-line alias.
//
// Layer note: this file stays neutral — decodes operate on the loose wire
// field set both sides already agree on and never import background/dashboard
// types. The precise per-op payload/result types live with the runner in the
// dashboard tier (dashboardSqliteService.ts), which may import both sides.
//
// Deliberately tabled here and nowhere else:
// - backupDb decodes to the base64 string, not bytes: the bytes/base64 codec
//   lives in utils/crypto and stays with the dashboard-tier alias (one line).
// - restoreDb encodes from bytes the same way (alias converts, row validates).
// ============================================================================

/** Codec carried by one dashboard-service row (dashboard hop only). */
export interface DashboardServiceOpDescriptor<S = unknown> {
  /** Short op key used by sqliteClient.call (distinct from wire/archive ops). */
  op: string;
  /** DASHBOARD_SQLITE subtype. */
  subtype: DashboardSqliteSubtype;
  /** Dashboard fallback message when the failure carries no reason. */
  defaultError: string;
  /** Row-owned retry; absent means single attempt (all rows here). */
  retry?: DashboardRetryPolicy;
  /** Decodes the dashboard wire success shape into the service public value. */
  serviceDecode: (response: { success: true } & Record<string, unknown>) => S;
}

/** Single constructor for service-table rows; preserves literal types per row. */
export function defineDashboardServiceOp<const R extends DashboardServiceOpDescriptor<unknown>>(row: R): R {
  return row;
}

export const DASHBOARD_SERVICE_TABLE = [
  defineDashboardServiceOp({
    op: 'migrate',
    subtype: 'migrate',
    defaultError: 'Migration failed',
    serviceDecode: (response) => ({
      count: requiredNonNegativeNumber(response.count, 'count'),
      read: requiredNonNegativeNumber(response.read, 'read'),
      inserted: requiredNonNegativeNumber(response.inserted, 'inserted'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'clearAll',
    subtype: 'clear_all',
    defaultError: 'Clear all failed',
    serviceDecode: () => undefined,
  }),
  defineDashboardServiceOp({
    op: 'status',
    subtype: 'status',
    defaultError: 'Failed to get SQLite status',
    serviceDecode: (response): SqliteStatusResult => ({
      initialized: requiredBoolean(response.initialized, 'initialized'),
      path: requiredString(response.path, 'path'),
      fallback: requiredBoolean(response.fallback, 'fallback'),
      fts5: requiredBoolean(response.fts5, 'fts5'),
      ...pickDefined({
        initError: response.initError ? String(response.initError) : undefined,
        ...decodeStatusExtras(response as unknown as Record<string, unknown>),
      }),
    }),
  }),
  defineDashboardServiceOp({
    op: 'cleanupLegacy',
    subtype: 'cleanup_legacy',
    defaultError: 'Cleanup failed',
    serviceDecode: (response) => ({
      removed: Array.isArray(response.removed) ? (response.removed as string[]) : [],
      totalBytes: requiredNonNegativeNumber(response.totalBytes, 'totalBytes'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'backfill',
    subtype: 'backfill_metadata',
    defaultError: 'Backfill failed',
    serviceDecode: (response) => ({
      updated: requiredNonNegativeNumber(response.updated, 'updated'),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'resync',
    subtype: 'resync_legacy',
    defaultError: 'Resync failed',
    serviceDecode: (response) => ({
      examined: requiredNonNegativeNumber(response.examined, 'examined'),
      written: requiredNonNegativeNumber(response.written, 'written'),
      skipped: requiredNonNegativeNumber(response.skipped, 'skipped'),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'backupDb',
    subtype: 'backup_db',
    defaultError: 'Backup failed',
    serviceDecode: (response) => {
      if (!response.data) throw new Error('Backup returned no data');
      return requiredString(response.data, 'data');
    },
  }),
  defineDashboardServiceOp({
    op: 'restoreDb',
    subtype: 'restore_db',
    defaultError: 'Restore failed',
    serviceDecode: () => undefined,
  }),
  defineDashboardServiceOp({
    op: 'import',
    subtype: 'import',
    defaultError: 'Import failed',
    serviceDecode: (response) => ({
      inserted: requiredNonNegativeNumber(response.inserted, 'inserted'),
      skipped: requiredNonNegativeNumber(response.skipped, 'skipped'),
      total: requiredNonNegativeNumber(response.total, 'total'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'purgeNow',
    subtype: 'purge_now',
    defaultError: 'Purge failed',
    serviceDecode: (response) => ({
      purged: requiredNonNegativeNumber(response.purged, 'purged'),
      skipped: requiredBoolean(response.skipped, 'skipped'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'contentPurgeNow',
    subtype: 'content_purge_now',
    defaultError: 'Content purge failed',
    serviceDecode: (response) => ({
      purged: requiredNonNegativeNumber(response.purged, 'purged'),
      skipped: requiredBoolean(response.skipped, 'skipped'),
    }),
  }),
  defineDashboardServiceOp({
    op: 'appendToLogs',
    subtype: 'append_to_obsidian',
    defaultError: 'Append failed',
    serviceDecode: (response) => ({
      appended: requiredNonNegativeNumber(response.appended, 'appended'),
    }),
  }),
];

export type DashboardServiceDescriptor = (typeof DASHBOARD_SERVICE_TABLE)[number];

export type DashboardServiceOp = DashboardServiceDescriptor['op'];

/** Dashboard public value a service row decodes to. */
export type DashboardServiceResult<D> = D extends {
  serviceDecode: (...args: never[]) => infer S;
} ? S : never;

/** Precise per-op view over the service table; indexing never yields undefined. */
export type DashboardServiceDescriptorMap = {
  readonly [O in DashboardServiceOp]: Extract<DashboardServiceDescriptor, { op: O }>;
};

export const DASHBOARD_SERVICE_DESCRIPTORS: DashboardServiceDescriptorMap = Object.fromEntries(
  DASHBOARD_SERVICE_TABLE.map((entry) => [entry.op, entry]),
) as DashboardServiceDescriptorMap;

// Compile-time sync with the dashboard subtypes: every service row must name
// a real subtype.
type ServiceTableSubtype = DashboardServiceDescriptor['subtype'];
type StaleServiceSubtype = Exclude<ServiceTableSubtype, DashboardSqliteSubtype>;
const _serviceSubtypesLive: StaleServiceSubtype extends never ? true : never = true;
void _serviceSubtypesLive;

// Service op keys must collide with neither the wire ops nor the archive ops
// (type-only import above, so no runtime cycle with archiveWireTable).
type ServiceWireCollision = Extract<DashboardServiceOp, SqliteWireOp>;
type ServiceArchiveCollision = Extract<DashboardServiceOp, ArchiveOpType>;
const _serviceWireDisjoint: ServiceWireCollision extends never ? true : never = true;
const _serviceArchiveDisjoint: ServiceArchiveCollision extends never ? true : never = true;
void _serviceWireDisjoint;
void _serviceArchiveDisjoint;

const SERVICE_BY_OP: ReadonlyMap<string, DashboardServiceDescriptor> = new Map(
  DASHBOARD_SERVICE_TABLE.map((entry) => [entry.op, entry]),
);

export function dashboardServiceWireFor(op: string): DashboardServiceDescriptor | undefined {
  return SERVICE_BY_OP.get(op);
}

// ============================================================================
// Maintain wire table (PBI 2026-09-23-13)
//
// The 7 non-archive maintain ops (init/backup/restore/clearAll/
// purgeOldRecords/purgeContent/healthCheck) were the last hand-wired hop in
// the offscreen gateway: each switch branch re-spelled messageType + payload
// shape + decoder, so a shape change broke in the gateway instead of in one
// codec. Each row here owns that same triple — messageType, encodePayload,
// decodeGateway — and the gateway dissolves into the same table.for(op.type)
// + callInternal seam query/mutate already use. Archive ops stay in
// ARCHIVE_WIRE_TABLE; this table covers exactly the non-archive remainder.
//
// Definition-site move only: wire shapes are frozen byte-identical to the
// former inline lambdas. Two edges pin that deliberately:
// - backup decodes to bytes (new Uint8Array over the wire number[]), not text.
// - purgeOldRecords vs purgeContent keep distinct message types (SQLITE_PURGE
//   vs CONTENT_PURGE), and both payloads carry their keys literally —
//   retentionDays/maxRecords/includeStarred stay present even when undefined
//   (no pickDefined), matching the former object literals.
// - init/healthCheck map a bare success to true (the gateway used to project
//   success to true after a decoder-less call); the row returns true so the
//   uniform dispatch needs no branch.
// ============================================================================

/**
 * Codec carried by one maintain wire-table row. O is the MaintainOp
 * discriminator, G the gateway client value produced by decodeGateway.
 * Params stay wide on purpose (same archive-table discipline as the
 * query/mutate rows): rows narrow inside with a documented cast.
 */
export interface SqliteMaintainWireOpDescriptor<O extends string = string, G = unknown> {
  /** MaintainOp discriminator (source of truth is the MaintainOp union). */
  op: O;
  /** Client-surface marker; always 'maintain' in this table. */
  family: 'maintain';
  /** background -> offscreen message type. */
  messageType: SqliteMessageType;
  retryPolicy: TransportRetryPolicy;
  /** Builds the wire payload the gateway sends offscreen. */
  encodePayload: (op: MaintainOp) => Record<string, unknown>;
  /** Decodes the wire success shape into the gateway client value. */
  decodeGateway: (response: { success: true } & Record<string, unknown>) => G;
}

type SqliteMaintainWireOpRow = Omit<SqliteMaintainWireOpDescriptor<string, unknown>, 'retryPolicy'>;

export function defineSqliteMaintainWireOp<const R extends SqliteMaintainWireOpRow>(row: R): R & { retryPolicy: TransportRetryPolicy } {
  return { ...row, retryPolicy: getTransportRetryPolicy(row.messageType) };
}

export const SQLITE_MAINTAIN_WIRE_TABLE = [
  defineSqliteMaintainWireOp({
    op: 'init',
    family: 'maintain',
    messageType: 'SQLITE_INIT',
    encodePayload: () => ({}),
    decodeGateway: () => true,
  }),
  defineSqliteMaintainWireOp({
    op: 'backup',
    family: 'maintain',
    messageType: 'SQLITE_BACKUP',
    encodePayload: () => ({}),
    decodeGateway: (response) => new Uint8Array(response.data as number[]),
  }),
  defineSqliteMaintainWireOp({
    op: 'restore',
    family: 'maintain',
    messageType: 'SQLITE_RESTORE',
    encodePayload: (op) => ({ data: Array.from((op as Extract<MaintainOp, { type: 'restore' }>).data) }),
    decodeGateway: () => undefined,
  }),
  defineSqliteMaintainWireOp({
    op: 'clearAll',
    family: 'maintain',
    messageType: 'SQLITE_CLEAR_ALL',
    encodePayload: () => ({}),
    decodeGateway: () => undefined,
  }),
  defineSqliteMaintainWireOp({
    op: 'purgeOldRecords',
    family: 'maintain',
    messageType: 'SQLITE_PURGE',
    // Literal keys (undefined rides along): matches the former
    // `{ retentionDays: rest.retentionDays, maxRecords: rest.maxRecords }`.
    encodePayload: (op) => {
      const o = op as Extract<MaintainOp, { type: 'purgeOldRecords' }>;
      return { retentionDays: o.retentionDays, maxRecords: o.maxRecords };
    },
    decodeGateway: (response) => ({ purged: response.purged as number }),
  }),
  defineSqliteMaintainWireOp({
    op: 'purgeContent',
    family: 'maintain',
    messageType: 'CONTENT_PURGE',
    encodePayload: (op) => {
      const o = op as Extract<MaintainOp, { type: 'purgeContent' }>;
      return { retentionDays: o.retentionDays, maxRecords: o.maxRecords, includeStarred: o.includeStarred };
    },
    decodeGateway: (response) => ({ purged: response.purged as number }),
  }),
  defineSqliteMaintainWireOp({
    op: 'healthCheck',
    family: 'maintain',
    messageType: 'SQLITE_HEALTH_CHECK',
    encodePayload: () => ({}),
    decodeGateway: () => true,
  }),
];

export type SqliteMaintainWireDescriptor = (typeof SQLITE_MAINTAIN_WIRE_TABLE)[number];

export type SqliteMaintainWireOp = SqliteMaintainWireDescriptor['op'];
export type SqliteMaintainWireMessageType = SqliteMaintainWireDescriptor['messageType'];

/** Precise per-op view over the maintain table; indexing never yields undefined. */
export type SqliteMaintainWireDescriptorMap = {
  readonly [O in SqliteMaintainWireOp]: Extract<SqliteMaintainWireDescriptor, { op: O }>;
};

export const SQLITE_MAINTAIN_WIRE_DESCRIPTORS: SqliteMaintainWireDescriptorMap = Object.fromEntries(
  SQLITE_MAINTAIN_WIRE_TABLE.map((entry) => [entry.op, entry]),
) as SqliteMaintainWireDescriptorMap;

// Compile-time two-way sync with the non-archive MaintainOp remainder:
// adding a maintain op without a table row (or vice versa) is a type error,
// which is also what forces decoder coverage — decodeGateway is a required
// row field, so a row cannot exist without its decoder (query/mutate parity).
type NonArchiveMaintainOpType = Exclude<MaintainOp['type'], ArchiveOpType>;
type MissingMaintainFromTable = Exclude<NonArchiveMaintainOpType, SqliteMaintainWireOp>;
type StaleMaintainInTable = Exclude<SqliteMaintainWireOp, NonArchiveMaintainOpType>;
const _maintainCovered: MissingMaintainFromTable extends never ? true : never = true;
const _maintainLive: StaleMaintainInTable extends never ? true : never = true;
void _maintainCovered;
void _maintainLive;

// Maintain messages must collide with neither the query/mutate table nor the
// archive group (the purge split is the load-bearing half of this assert:
// SQLITE_PURGE and CONTENT_PURGE must stay distinct rows here).
type MaintainWireCollision = Extract<SqliteMaintainWireMessageType, SqliteWireMessageType>;
type MaintainArchiveLeak = Extract<SqliteMaintainWireMessageType, `SQLITE_ARCHIVE_${string}`>;
const _maintainWireDisjoint: MaintainWireCollision extends never ? true : never = true;
const _maintainNoArchiveLeak: MaintainArchiveLeak extends never ? true : never = true;
void _maintainWireDisjoint;
void _maintainNoArchiveLeak;

const MAINTAIN_BY_OP: ReadonlyMap<string, SqliteMaintainWireDescriptor> = new Map(
  SQLITE_MAINTAIN_WIRE_TABLE.map((entry) => [entry.op, entry]),
);

export function sqliteMaintainWireFor(op: string): SqliteMaintainWireDescriptor | undefined {
  return MAINTAIN_BY_OP.get(op);
}
