/**
 * archiveSubtypes.ts
 * The 4th subtype partition: archive feature subtypes (PBI 2026-09-06-02).
 *
 * Kept separate from MAINTENANCE_BATCH_SUBTYPES because these operations are
 * stateful (staging registry in the offscreen/worker) and bulk — the shared
 * maintenance batching/patterns do not apply.
 *
 * Derived from ARCHIVE_WIRE_TABLE (PBI 2026-09-09-05): the set cannot drift
 * from the codec table, since it is built from it.
 */

import { ARCHIVE_WIRE_TABLE } from '../../../messaging/archiveWireTable.js';
import type { DashboardSqliteSubtype } from '../../../messaging/sqliteOperationSecurity.js';

export const ARCHIVE_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set(
  ARCHIVE_WIRE_TABLE.map((descriptor) => descriptor.subtype),
);
