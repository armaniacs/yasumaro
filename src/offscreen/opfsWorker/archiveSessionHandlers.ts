/**
 * archiveSessionHandlers.ts
 * OPFS-worker handlers for the temp-open session (PBI 2026-09-06-05): open a
 * registered staging archive as a second engine, query/edit it, save (flush +
 * hand the file back), and close. The main engine is never touched — the
 * session engine is a dedicated module-level reference here, isolated from
 * `handlerCtx.engine` (Checking Team C2-2).
 *
 * Safety invariants:
 * - Staging names must be registry-issued (fail-closed) — `yasumaro.db` can
 *   never be opened as the second engine.
 * - The archive file is untrusted: ARCHIVE_OPEN runs migrateArchiveStaging
 *   (older archives) + validateArchiveEngine (allowlist, reject on meta
 *   mismatch for open — warn is surfaced to the dashboard separately).
 * - Edits are whitelisted to UPDATABLE_FIELDS (same list as the main DB);
 *   `url` changes are isHttpUrl-validated (Red Team requirement).
 * - `archiveDirty` is set by ARCHIVE_UPDATE and cleared by ARCHIVE_SAVE;
 *   ARCHIVE_CLOSE rejects while dirty (two-defense with the UI confirm).
 * - Single session: a second ARCHIVE_OPEN while one is open is rejected.
 */

import type { HandlerContext } from './handlers.js';
import { sqlExec } from './handlers.js';
import type {
  ArchiveOpenPayload,
  ArchiveQueryPayload,
  ArchiveUpdatePayload,
  ArchiveSavePayload,
  ArchiveClosePayload,
} from './types.js';
import { createEngine, type SqliteEngine, type SqliteValue } from '../sqliteEngine.js';
import {
  SCHEMA_SQL,
  ARCHIVE_META_SCHEMA_SQL,
  UPDATABLE_FIELDS,
} from '../schema.js';
import {
  validateArchiveEngine,
  migrateArchiveStaging,
} from './archiveValidation.js';
import {
  assertRegisteredStagingName,
  getStagingRecord,
  releaseStaging,
  sweepOrphanStagings,
} from './archiveStaging.js';
import { isHttpUrl } from '../../utils/archiveGuards.js';
import { isValidStagingName } from '../../utils/archiveGuards.js';

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;
const ARCHIVE_QUERY_LIMIT = 500;
const LIKE_ESCAPE = '\\';

let sessionEngine: SqliteEngine | null = null;
let sessionStagingName: string | null = null;
let archiveDirty = false;

/** Test seam: clear the module-level session state between tests. */
export function resetArchiveSessionForTesting(): void {
  sessionEngine = null;
  sessionStagingName = null;
  archiveDirty = false;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Reconnect/status probe — never mutates. */
export async function handleArchiveStatus(_ctx: HandlerContext): Promise<{
  open: boolean;
  stagingName: string | null;
  dirty: boolean;
}> {
  return {
    open: sessionEngine !== null,
    stagingName: sessionStagingName,
    dirty: archiveDirty,
  };
}

export async function handleArchiveOpen(
  _ctx: HandlerContext,
  payload: ArchiveOpenPayload,
): Promise<{ open: boolean }> {
  assertRegisteredStagingName(payload.stagingName);
  if (sessionEngine) {
    throw new Error('Archive already open (ARC_ALR_001)');
  }
  const record = getStagingRecord(payload.stagingName);
  if (!record || record.kind !== 'incoming') {
    // Temp-open reads user-picked files, which the dashboard stages as
    // incoming. Outgoing files (phase A output) have their own flow.
    throw new Error(
      `Refusing to open: staging is not an incoming archive (kind=${record?.kind ?? 'unknown'})`,
    );
  }

  const engine = await createEngine(payload.stagingName, WASM_URL);
  try {
    // Older archives may lack newer columns — complete before validating.
    await migrateArchiveStaging(engine);
    // Allowlist structure check + meta consistency (reject mode: a mismatched
    // file is not opened at all — the dashboard surfaces the error).
    await validateArchiveEngine(engine, { recordCountMismatch: 'reject' });
  } catch (error) {
    try {
      await engine.close();
    } catch {
      // close failure must not mask the validation error
    }
    throw error;
  }

  sessionEngine = engine;
  sessionStagingName = payload.stagingName;
  archiveDirty = false;
  return { open: true };
}

export async function handleArchiveQuery(
  _ctx: HandlerContext,
  payload: ArchiveQueryPayload,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  if (!sessionEngine || sessionStagingName !== payload.stagingName) {
    throw new Error('Archive not open (ARC_ALR_001)');
  }
  const limit = Math.min(Math.max(1, Math.floor(payload.limit)), ARCHIVE_QUERY_LIMIT);
  const offset = Math.max(0, Math.floor(payload.offset));
  const params: SqliteValue[] = [];
  let where = '';
  if (payload.query !== '') {
    const pattern = `%${escapeLike(payload.query)}%`;
    where =
      ' WHERE (url LIKE ? ESCAPE \'\\\' OR title LIKE ? ESCAPE \'\\\' OR summary LIKE ? ESCAPE \'\\\')';
    params.push(pattern, pattern, pattern);
  }
  const total = Number(
    (await sessionEngine.queryValue(`SELECT COUNT(*) AS c FROM browsing_logs${where}`, params)) ?? 0,
  );
  const rows = await sessionEngine.query(
    `SELECT id, url, title, summary, tags, created_at, is_starred, is_deleted FROM browsing_logs${where} ` +
      'ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [...params, limit, offset],
  );
  return { rows, total };
}

export async function handleArchiveUpdate(
  _ctx: HandlerContext,
  payload: ArchiveUpdatePayload,
): Promise<{ dirty: boolean }> {
  if (!sessionEngine || sessionStagingName !== payload.stagingName) {
    throw new Error('Archive not open (ARC_ALR_001)');
  }
  const id = payload.id;
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Archive update: invalid id ${String(payload.id)}`);
  }
  const changes = payload.changes ?? {};
  const entries = Object.entries(changes).filter(([key]) => key !== 'id');
  for (const [key] of entries) {
    if (!(UPDATABLE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`Archive update: field '${key}' is not updatable`);
    }
  }
  if (typeof changes.url === 'string' && !isHttpUrl(changes.url)) {
    throw new Error('Archive update: url must be http or https');
  }
  if (entries.length === 0) return { dirty: archiveDirty };

  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const params: SqliteValue[] = [...entries.map(([, v]) => v as SqliteValue), id];
  await sqlExec(
    { engine: sessionEngine },
    `UPDATE browsing_logs SET ${assignments} WHERE id = ?`,
    params,
  );
  archiveDirty = true;
  return { dirty: true };
}

/**
 * Flush the session WAL into the staging file. The dashboard then reads the
 * file via SQLITE_ARCHIVE_EXPORT (chunked) and writes it back to the original
 * file / re-downloads it.
 */
export async function handleArchiveSave(
  _ctx: HandlerContext,
  payload: ArchiveSavePayload,
): Promise<{ dirty: boolean }> {
  if (!sessionEngine || sessionStagingName !== payload.stagingName) {
    throw new Error('Archive not open (ARC_ALR_001)');
  }
  await sessionEngine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  archiveDirty = false;
  return { dirty: false };
}

export async function handleArchiveClose(
  _ctx: HandlerContext,
  payload: ArchiveClosePayload,
): Promise<{ dirty: boolean }> {
  if (!sessionEngine || sessionStagingName !== payload.stagingName) {
    // Idempotent: closing a closed session is a no-op success (dashboard
    // reload flows may double-send).
    return { dirty: false };
  }
  if (archiveDirty) {
    throw new Error('Archive has unsaved changes (ARC_DIRTY_001)');
  }
  await sessionEngine.close();
  sessionEngine = null;
  archiveDirty = false;
  await releaseStaging(payload.stagingName).catch(() => {});
  if (sessionStagingName === payload.stagingName) sessionStagingName = null;
  return { dirty: false };
}

/**
 * Force-discard the session (dashboard reconnect flow chose "discard").
 * Closes the engine and removes the staging file even when dirty.
 */
export async function handleArchiveDiscard(stagingName: string): Promise<void> {
  if (sessionStagingName === stagingName && sessionEngine) {
    await sessionEngine.close();
    sessionEngine = null;
    archiveDirty = false;
  }
  await releaseStaging(stagingName).catch(() => {});
}

/** Startup sweep helper: orphans are removed; the live session is protected. */
export async function handleArchiveSweep(): Promise<string[]> {
  return sweepOrphanStagings(new Set(sessionStagingName ? [sessionStagingName] : []));
}

// isValidStagingName re-export guard: staging names must always come from the
// registry — this import documents that the session only ever binds to
// registry-issued names.
void isValidStagingName;
