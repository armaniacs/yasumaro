/**
 * Test-only aggregate of the offscreen SQLite surface.
 *
 * The production code imports each operation from the module that owns it
 * (recordsRepo / dbMaintenance / auditLogRepo / sqliteEngineContext). These
 * tests drive a whole database lifecycle — init, write, read, reset — so they
 * want one handle to the surface rather than four imports each.
 *
 * This replaces the former `src/offscreen/sqlite.ts` re-export layer, which
 * marked every export `@deprecated` while the production router remained its
 * only importer. Keeping the aggregate here confines it to the tests that
 * actually want it.
 */

import { engine } from '../sqliteEngineContext.js';

export {
  insert,
  insertBatch,
  query,
  search,
  update,
  hardDelete,
  toggleStar,
  getCount,
  getStatus,
  clearAll,
  serialize,
} from '../recordsRepo.js';

export {
  purgeOldRecords,
  purgeContent,
  backupDb,
  restoreDb,
  sqliteHealthCheck,
} from '../dbMaintenance.js';

export {
  insertAuditLog,
  queryAuditLog,
} from '../auditLogRepo.js';

export async function init(): Promise<boolean> {
  return engine.init();
}

export function _resetForTesting(): void {
  engine.resetForTesting();
}
