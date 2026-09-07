/**
 * archiveStaging.ts
 * Offscreen/worker-side registry and lifecycle helpers for archive staging
 * files (`archive_incoming_<uuid>.db` / `archive_outgoing_<uuid>.db`).
 *
 * The registry is the single source of truth for which staging names are
 * legitimate: client-supplied names must have been issued here. This blocks
 * opening `yasumaro.db` as a second engine and path traversal via crafted
 * file names. The registry lives in worker memory — after an offscreen
 * restart every staging name is unknown and must be re-previewed.
 */

import {
  ARCHIVE_STAGING_NAME_RE,
  isValidStagingName,
  type StagingName,
} from '../../utils/archiveGuards.js';

export type ArchiveStagingKind = 'incoming' | 'outgoing';

export interface ArchiveStagingRecord {
  kind: ArchiveStagingKind;
  createdAt: number;
  /** Phase-A scope captured by archiveCreate (PBI 2026-09-06-02). Phase B
   * cross-checks the archive file's meta against these values. */
  cutoffMs?: number;
  includeDeleted?: boolean;
  maxIdAtArchive?: number;
  recordCount?: number;
}

const registry = new Map<string, ArchiveStagingRecord>();

type DirHandleProvider = () => Promise<FileSystemDirectoryHandle>;

let dirProvider: DirHandleProvider | null = null;

/** Test seam: inject a fake OPFS root directory handle. */
export function setArchiveStagingDirProviderForTesting(
  provider: DirHandleProvider,
): void {
  dirProvider = provider;
}

/** Test seam: clear the registry and provider. */
export function resetArchiveStagingForTesting(): void {
  registry.clear();
  dirProvider = null;
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (dirProvider) return dirProvider();
  return navigator.storage.getDirectory();
}

function issueName(kind: ArchiveStagingKind): StagingName {
  let nonce: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    nonce = crypto.randomUUID();
  } else {
    // Fail-closed: no predictable fallback (see confirmTokenManager VULN-039).
    throw new Error('crypto.randomUUID unavailable; refusing to issue staging name');
  }
  const name = `archive_${kind}_${nonce}.db`;
  if (!isValidStagingName(name)) {
    throw new Error(`Issued staging name failed validation: ${name}`);
  }
  return name as StagingName;
}

/** Issue and register an incoming staging name (dashboard writes the bytes). */
export async function prepareIncoming(): Promise<StagingName> {
  const name = issueName('incoming');
  registry.set(name, { kind: 'incoming', createdAt: Date.now() });
  return name;
}

/** Issue and register an outgoing staging name (offscreen writes the bytes). */
export async function prepareOutgoing(): Promise<StagingName> {
  const name = issueName('outgoing');
  registry.set(name, { kind: 'outgoing', createdAt: Date.now() });
  return name;
}

export function getStagingRecord(name: string): ArchiveStagingRecord | undefined {
  return registry.get(name);
}

export function isStagingRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Attach the phase-A scope (cutoff / includeDeleted / maxId) to a registered
 * staging record. Phase B cross-checks the archive file's meta against these
 * values — a swapped file fails closed (PBI 2026-09-06-04).
 */
export function updateStagingRecord(
  name: string,
  patch: Partial<Pick<ArchiveStagingRecord, 'cutoffMs' | 'includeDeleted' | 'maxIdAtArchive' | 'recordCount'>>,
): void {
  const record = registry.get(name);
  if (!record) {
    throw new Error(`Unknown staging file: ${name}`);
  }
  registry.set(name, { ...record, ...patch });
}

/**
 * Assert the name is well-formed AND was issued by this registry.
 * Throws fail-closed — callers must not operate on unknown file names.
 */
export function assertRegisteredStagingName(name: string): void {
  if (!isValidStagingName(name) || !registry.has(name)) {
    throw new Error(`Unknown staging file: ${String(name)}`);
  }
}

/** Best-effort OPFS removal; missing files are ignored. */
export async function removeStagingFile(name: string): Promise<void> {
  try {
    const root = await getRoot();
    await root.removeEntry(name);
  } catch {
    // missing file / transient FS error — removal is best-effort
  }
}

/**
 * Unregister and remove a staging file. Throws when the name was never
 * issued (fail-closed against client-specified names).
 */
export async function releaseStaging(name: string): Promise<void> {
  assertRegisteredStagingName(name);
  registry.delete(name);
  await removeStagingFile(name);
}

/**
 * Remove orphan staging files matching the staging name pattern, protecting
 * (a) the explicit exclude set and (b) names registered by the live session.
 * Returns the removed file names. Never touches non-staging files
 * (e.g. `yasumaro.db`).
 */
export async function sweepOrphanStagings(
  exclude: ReadonlySet<string> = new Set<string>(),
): Promise<string[]> {
  const protectedNames = new Set<string>(exclude);
  for (const name of registry.keys()) protectedNames.add(name);

  const root = await getRoot();
  const candidates: string[] = [];
  const iterable = root as unknown as {
    entries: () => AsyncIterable<[string, unknown]>;
  };
  for await (const [name] of iterable.entries()) {
    if (typeof name !== 'string') continue;
    if (!ARCHIVE_STAGING_NAME_RE.test(name)) continue;
    if (protectedNames.has(name)) continue;
    candidates.push(name);
  }
  const removed: string[] = [];
  for (const name of candidates) {
    try {
      await root.removeEntry(name);
      removed.push(name);
    } catch {
      // best-effort sweep
    }
  }
  return removed;
}
