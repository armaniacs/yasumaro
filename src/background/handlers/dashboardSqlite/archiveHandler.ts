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
 * in validation, deps args, and response projection — all three now live in
 * the wire-table descriptor row, and runArchive executes the shared shape.
 */

import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';
import type { ArchiveDeps, DepsResult } from './deps.js';
import { toFailure } from './deps.js';
import { ARCHIVE_SUBTYPES } from './archiveSubtypes.js';
import { ARCHIVE_WIRE_TABLE, type ArchiveDescriptor, type ArchiveOpDescriptor } from '../../../messaging/archiveWireTable.js';

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
  const invalid = descriptor.validate(raw);
  if (invalid !== null) return { success: false, error: invalid };
  const invoke = (deps as unknown as Record<string, (...args: unknown[]) => Promise<DepsResult<unknown>>>)[descriptor.depsMethod];
  if (typeof invoke !== 'function') return { success: false, error: `Unknown archive deps method: ${descriptor.depsMethod}` };
  const result = await invoke(...descriptor.depsArgs(raw));
  if (!result.success) return toFailure(result);
  const project = descriptor.projectDeps ?? descriptor.project;
  return { success: true, ...project(result.data) };
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
