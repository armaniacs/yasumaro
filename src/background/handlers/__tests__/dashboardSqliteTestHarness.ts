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
 *
 * PBI-02: the SqliteClient no longer exposes `null`/boolean-returning wrappers,
 * so tests supply the `*Result` methods directly (no more synthesizing them
 * from plain methods via a RESULT_METHOD_SOURCES table).
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
    createSqliteClientDeps(sqliteClient as SqliteClient, {
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
