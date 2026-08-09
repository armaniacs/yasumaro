/**
 * Test harness for the dashboard SQLite handler.
 *
 * Replaces the former `handleDashboardSqlite` wrapper, which lived in the
 * production module but had no production caller: its only job was filling in
 * the four Service-Worker-owned dependencies with stubs for tests. Its six
 * positional parameters also forced call sites to write placeholder
 * `undefined`s just to reach the token argument.
 *
 * This goes through the production `createSqliteClientDeps`, so tests still
 * exercise the same SqliteClient-backed wiring the Service Worker uses.
 */

import { createDashboardSqliteHandler, createSqliteClientDeps } from '../dashboardSqliteHandlers.js';
import type { SqliteClientBackedDeps } from '../dashboardSqliteHandlers.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';

/** Matches the wrapper's former defaults so migrated tests keep their behaviour. */
function defaultServiceWorkerDeps(): SqliteClientBackedDeps {
  return {
    runMigration: async () => ({ success: false, error: 'Migration not available', count: 0 }),
    getConfirmToken: async () => '',
    runBackfill: async () => { throw new Error('Backfill not available'); },
    runCleanup: async () => { throw new Error('Cleanup not available'); },
  };
}

/**
 * Read-path methods, and the `null`-returning method each one is derived from.
 *
 * Tests mock SqliteClient by hand, so they supply the plain methods
 * (`query`, `getCount`, ...). Production reads through the `*Result` variants
 * to keep each failure's reason attached to its own call. Where a test has
 * mocked only the plain method, synthesize the Result form from it: `null`
 * becomes a failure carrying `lastError` — which is exactly what the handler
 * used to consult, so migrated assertions keep their meaning.
 */
const RESULT_METHOD_SOURCES = [
  // [Result method, plain method, message used when the plain method returns
  //  null and no lastError is set — the wording the handler used to supply]
  ['queryResult', 'query', 'Query failed'],
  ['searchResult', 'search', 'Search failed'],
  ['getCountResult', 'getCount', 'Get count failed'],
  ['backupDbResult', 'backupDb', 'Backup failed'],
  ['queryAuditLogResult', 'queryAuditLog', 'Audit log query failed'],
] as const;

type LooseClient = Record<string, unknown>;

export function withDerivedResultMethods(sqliteClient: Partial<SqliteClient>): Partial<SqliteClient> {
  const loose = sqliteClient as LooseClient;

  // Augment in place rather than returning a copy: tests hold a reference to
  // the object they built and both assert on its spies and reassign its
  // methods afterwards, so a copy would silently diverge from what they see.
  for (const [resultName, plainName, fallbackMessage] of RESULT_METHOD_SOURCES) {
    if (typeof loose[resultName] === 'function') continue;

    loose[resultName] = async (...args: unknown[]) => {
      // Resolve the plain method and lastError at call time, not build time:
      // several tests swap in a fresh vi.fn() (or set lastError) after the
      // client object exists, and a snapshot would miss those.
      const plain = loose[plainName];
      if (typeof plain !== 'function') {
        return { success: false, error: { kind: 'unknown', message: fallbackMessage, retriable: false } };
      }
      const data = await (plain as (...a: unknown[]) => Promise<unknown>).apply(sqliteClient, args);
      if (data === null || data === undefined) {
        const message = (loose.lastError as string | undefined) || fallbackMessage;
        return { success: false, error: { kind: 'unknown', message, retriable: false } };
      }
      return { success: true, data };
    };
  }

  return sqliteClient;
}

/**
 * Builds a handler bound to `sqliteClient`.
 *
 * @param overrides the Service-Worker-owned dependencies a test cares about;
 *   anything omitted falls back to the stub the old wrapper supplied.
 */
export function makeDashboardSqliteHandler(
  sqliteClient: Partial<SqliteClient>,
  overrides: Partial<SqliteClientBackedDeps> = {},
): (payload: DashboardSqliteRequest & { confirmToken?: string }) => Promise<unknown> {
  return createDashboardSqliteHandler(
    createSqliteClientDeps(withDerivedResultMethods(sqliteClient) as SqliteClient, {
      ...defaultServiceWorkerDeps(),
      ...overrides,
    }),
  );
}

/**
 * One-shot form for tests that dispatch a single payload.
 *
 * Mirrors the old wrapper's call shape so migrated assertions stay identical,
 * but names the token instead of hiding it behind a positional `undefined`.
 */
export function dispatchDashboardSqlite(
  payload: DashboardSqliteRequest & { confirmToken?: string },
  sqliteClient: Partial<SqliteClient>,
  overrides: Partial<SqliteClientBackedDeps> = {},
): Promise<unknown> {
  return makeDashboardSqliteHandler(sqliteClient, overrides)(payload);
}
