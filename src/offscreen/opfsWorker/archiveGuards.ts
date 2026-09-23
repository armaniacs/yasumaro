/**
 * archiveGuards.ts (worker layer)
 * Worker-side single source of truth for archive restore resource ceilings.
 *
 * WHY this file exists: the dashboard enforces a 200MiB client-side cap, but
 * the worker is reachable by direct message and must not trust it. Both the
 * validation gate and the restore loop read the ceilings from here so the
 * two paths cannot drift apart.
 *
 * WHY 200_000 rows: one dashboard export is capped at EXPORT_ROW_LIMIT
 * (10_000 rows), and merged archives can combine many exports. 200_000 rows
 * admit ~20 full exports while still bounding loop iterations and peak
 * memory to a small multiple of RESTORE_BATCH.
 *
 * WHY bytes === MAX_ARCHIVE_FILE_BYTES: the worker must never admit a file
 * the client would reject, and never reject one the client accepted. Sharing
 * the constant keeps the two layers consistent by construction.
 */

import { MAX_ARCHIVE_FILE_BYTES } from '../../utils/archiveGuards.js';
import type { SqliteRow } from '../sqliteEngine.js';

/** Total rows a single archive restore may apply. */
export const MAX_ARCHIVE_RESTORE_ROWS = 200_000;

/** Total bytes a single archive restore may apply. Same as the client cap. */
export const MAX_ARCHIVE_RESTORE_BYTES = MAX_ARCHIVE_FILE_BYTES;

/** Error code for row-ceiling violations (see dev-docs/ERROR_CODES.md). */
export const ARC_CAP_ROWS = 'ARC_CAP_001';

/** Error code for byte-ceiling violations (see dev-docs/ERROR_CODES.md). */
export const ARC_CAP_BYTES = 'ARC_CAP_002';

/**
 * Estimate the in-memory weight of one restore batch. JSON length is a
 * cheap upper-ish proxy for per-row cost (URL/content dominate); exactness
 * does not matter because this only gates a generous ceiling.
 */
export function estimateBatchBytes(rows: readonly SqliteRow[]): number {
  let total = 0;
  for (const row of rows) {
    total += JSON.stringify(row).length;
  }
  return total;
}

/** Throw when a declared or observed row total exceeds the ceiling. */
export function assertRowTotalWithinCap(total: number, observed: boolean): void {
  if (total > MAX_ARCHIVE_RESTORE_ROWS) {
    const kind = observed ? 'contains' : 'declares';
    throw new Error(
      `Archive restore rejected: archive ${kind} ${total} rows, ` +
        `exceeding the restore limit of ${MAX_ARCHIVE_RESTORE_ROWS} rows ` +
        `— split the archive by date and retry (${ARC_CAP_ROWS})`,
    );
  }
}

/** Throw when an observed byte total exceeds the ceiling. */
export function assertByteTotalWithinCap(totalBytes: number): void {
  if (totalBytes > MAX_ARCHIVE_RESTORE_BYTES) {
    throw new Error(
      `Archive restore rejected: archive is ${totalBytes} bytes, ` +
        `exceeding the restore limit of ${MAX_ARCHIVE_RESTORE_BYTES} bytes ` +
        `— split the archive by date and retry (${ARC_CAP_BYTES})`,
    );
  }
}
