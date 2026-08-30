/**
 * dashboardSqliteWiring.ts
 * Extracted from service-worker.ts (PBI-05).
 * Wires the dashboard SQLite handler with its migration/backfill/cleanup deps.
 */

import { createDashboardSqliteHandler, createSqliteClientDeps } from './handlers/dashboardSqliteHandlers.js';
import type { DashboardSqliteRequest } from './handlers/dashboardSqliteProtocol.js';
import { createErrorResponse } from '../utils/errorClassification.js';
import type { SqliteClient } from './sqliteClient.js';
import { MigrationService } from './migrationService.js';
import { createConfirmToken as createConfirmTokenImpl, verifyConfirmToken as verifyConfirmTokenImpl } from './confirmTokenManager.js';

export interface DashboardSqliteWiringDeps {
  sqliteClient: SqliteClient;
  ensureConfirmToken: () => Promise<string>;
  createConfirmToken?: (action: string, id?: number) => Promise<string>;
  verifyConfirmToken?: (token: string, action: string, id?: number) => Promise<boolean>;
}

export function createDashboardSqliteMessageHandler(deps: DashboardSqliteWiringDeps): (
  (message: Record<string, unknown>, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void
) {
  const migrationService = new MigrationService(deps.sqliteClient);

  const _dashboardSqliteHandler = createDashboardSqliteHandler(
    createSqliteClientDeps(deps.sqliteClient, {
      runMigration: async () => {
        await chrome.storage.local.remove([
          'yasumaro_migration_status',
          'yasumaro_migration_progress',
        ]);
        const beforeCount = await deps.sqliteClient.query({ kind: 'count' });
        await migrationService.run();
        const afterCount = await deps.sqliteClient.query({ kind: 'count' });
        if (!beforeCount.success || !afterCount.success) {
          return {
            success: false,
            error: 'Failed to read SQLite record count during migration',
            count: 0,
          };
        }
        return {
          success: true,
          count: afterCount.data,
          read: 0,
          inserted: Math.max(0, afterCount.data - beforeCount.data),
        };
      },
      createConfirmToken: deps.createConfirmToken ?? createConfirmTokenImpl,
      verifyConfirmToken: deps.verifyConfirmToken ?? verifyConfirmTokenImpl,
      runBackfill: () => migrationService.backfillDiagnosticMetadata(),
      runCleanup: () => migrationService.cleanupLegacyStorage(),
    }),
  );

  return (message: Record<string, unknown>, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void => {
    void (async () => {
      try {
        const result = await _dashboardSqliteHandler(
          (message.payload || {}) as DashboardSqliteRequest & { confirmToken?: string },
        );
        sendResponse(result);
      } catch (error) {
        sendResponse(createErrorResponse(error));
      }
    })();
  };
}
