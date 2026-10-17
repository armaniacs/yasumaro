/**
 * archiveHandler.ts
 * Service-Worker-side handler for the archive subtype group (4th partition).
 *
 * The actual work happens in the offscreen document / OPFS worker (staging
 * registry + second engine live there). This handler validates the payload
 * shape, delegates to the client-backed archive deps, and forwards the
 * failure reason (see toFailure).
 *
 * Table-driven (PBI 2026-09-09-05): the 14 hand-written cases differed only
 * in validation, deps args, and response projection. Deps args and response
 * projection live in the wire-table descriptor row; validation lives once in
 * DASHBOARD_SQLITE_SUBTYPE_SPECS and runArchive evaluates it at the handler
 * entry (PBI 2026-10-16-02) — so a direct createArchiveHandler call without
 * the envelope gate still rejects before deps. runArchive executes the shape.
 */

import type { DashboardSqliteRequest } from '../../../messaging/dashboardSqliteProtocol.js';
import type { ArchiveDeps, DepsResult } from './deps.js';
import { runTableDriven } from './deps.js';
import { ARCHIVE_SUBTYPES } from './archiveSubtypes.js';
import { ARCHIVE_WIRE_TABLE, type ArchiveDescriptor, type ArchiveOpDescriptor } from '../../../messaging/archiveWireTable.js';
import { evaluateSubtypeSpec } from '../../../messaging/validators.js';

export { ARCHIVE_SUBTYPES };

/** Deps the archive group needs (subset view over the full union). */
export type ArchiveHandlerDeps = ArchiveDeps;

const DESCRIPTOR_BY_SUBTYPE: ReadonlyMap<string, ArchiveDescriptor> = new Map(
  ARCHIVE_WIRE_TABLE.map((descriptor) => [descriptor.subtype, descriptor]),
);

export async function runArchive<D extends ArchiveOpDescriptor>(
  descriptor: D,
  payload: DashboardSqliteRequest,
  deps: ArchiveHandlerDeps,
): Promise<unknown> {
  const raw = payload as unknown as Record<string, unknown>;
  const invoke = (deps as unknown as Record<string, (...args: unknown[]) => Promise<DepsResult<unknown>>>)[descriptor.depsMethod];
  if (typeof invoke !== 'function') return { success: false, error: `Unknown archive deps method: ${descriptor.depsMethod}` };
  // PBI 2026-10-06-10: depsArgs is optional on the interface (defineArchiveOp
  // fills it from backendArgs), so fall back here too.
  const argsFn = descriptor.depsArgs ?? descriptor.backendArgs;
  const project = descriptor.projectDeps ?? descriptor.project;
  // PBI 2026-10-16-02: the spec table is the only validation truth — the
  // handler entry evaluates the descriptor's subtype row, so direct calls
  // (no envelope gate) still reject before deps.
  return runTableDriven({ validate: (raw) => evaluateSubtypeSpec(descriptor.subtype, raw), depsArgs: argsFn }, raw, invoke, project);
}

export function createArchiveHandler(deps: ArchiveHandlerDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const descriptor = DESCRIPTOR_BY_SUBTYPE.get(payload.subtype);
    if (!descriptor) {
      const unknownSubtype = (payload as { subtype?: string }).subtype;
      return { success: false, error: `Unknown archive subtype: ${String(unknownSubtype)}` };
    }
    return runArchive(descriptor, payload, deps);
  };
}
