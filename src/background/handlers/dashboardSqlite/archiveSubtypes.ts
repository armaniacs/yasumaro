/**
 * archiveSubtypes.ts
 * The 4th subtype partition: archive feature subtypes (PBI 2026-09-06-02).
 *
 * Kept separate from MAINTENANCE_BATCH_SUBTYPES because these operations are
 * stateful (staging registry in the offscreen/worker) and bulk — the shared
 * maintenance batching/patterns do not apply.
 */

import type { DashboardSqliteSubtype } from '../../../messaging/sqliteOperationSecurity.js';

export const ARCHIVE_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'archive_preview',
  'archive_create',
  'archive_cleanup',
  'archive_export',
  'archive_delete_by_staging',
  'archive_prepare_incoming',
  'archive_restore_preview',
  'archive_restore',
  'archive_open',
  'archive_query',
  'archive_update',
  'archive_save',
  'archive_close',
  'archive_status',
]);
