/**
 * restoreStaging.ts
 * OPFS-worker-side registry and lifecycle helpers for the chunked restore
 * staging files (`restore_incoming_<uuid>.db`).
 *
 * Mirrors the archive staging registry (archiveStaging.ts): the registry is
 * the single source of truth for which restore staging names are legitimate,
 * so a fabricated or stale name fails closed instead of touching OPFS files
 * by guesswork. The registry lives in worker memory — after a worker restart
 * every staging name is unknown and the in-flight session must restart from
 * restore_begin (the next begin also sweeps the orphaned file away).
 */

import {
  MAX_RESTORE_STAGING_SESSIONS,
  RESTORE_STAGING_NAME_PREFIX,
  STAGING_SESSION_TTL,
} from '../../utils/limits.js';
import {
  RESTORE_STAGING_NAME_RE,
  isValidRestoreStagingName,
  type RestoreStagingName,
} from '../../utils/archiveGuards.js';

export interface RestoreStagingRecord {
  /** Declared DB size at begin; commit cross-checks it against the file. */
  totalBytes: number;
  totalChunks: number;
  createdAt: number;
  /** Bytes accepted so far — the next non-retry append must start here. */
  expectedOffset: number;
  /** Appends accepted so far; commit cross-checks it against totalChunks. */
  appendedChunks: number;
  /** Start offset of the most recent accepted append (retry-resend marker). */
  lastAppendOffset: number | null;
}

const registry = new Map<string, RestoreStagingRecord>();

type DirHandleProvider = () => Promise<FileSystemDirectoryHandle>;

let dirProvider: DirHandleProvider | null = null;

/** Test seam: inject a fake OPFS root directory handle. */
export function setRestoreStagingDirProviderForTesting(provider: DirHandleProvider | null): void {
  dirProvider = provider;
}

/** Test seam: clear the registry and provider. */
export function resetRestoreStagingForTesting(): void {
  registry.clear();
  dirProvider = null;
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (dirProvider) return dirProvider();
  return navigator.storage.getDirectory();
}

function issueName(): RestoreStagingName {
  let nonce: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    nonce = crypto.randomUUID();
  } else {
    // Fail-closed: no predictable fallback (see confirmTokenManager VULN-039).
    throw new Error('crypto.randomUUID unavailable; refusing to issue restore staging name');
  }
  const name = `${RESTORE_STAGING_NAME_PREFIX}${nonce}.db`;
  if (!isValidRestoreStagingName(name)) {
    throw new Error(`Issued restore staging name failed validation: ${name}`);
  }
  return name as RestoreStagingName;
}

export function getRestoreStagingRecord(name: string): RestoreStagingRecord | undefined {
  return registry.get(name);
}

/**
 * Assert the name is well-formed AND was issued by this registry.
 * Throws fail-closed — callers must not operate on unknown file names.
 */
export function assertRegisteredRestoreStagingName(name: string): void {
  if (!isValidRestoreStagingName(name) || !registry.has(name)) {
    throw new Error(`Unknown restore staging file: ${String(name)}`);
  }
}

/** Best-effort OPFS removal; missing files are ignored. */
export async function removeRestoreStagingFile(name: string): Promise<void> {
  try {
    const root = await getRoot();
    await root.removeEntry(name);
  } catch {
    // missing file / transient FS error — removal is best-effort
  }
}

/**
 * Remove leftover restore staging files from previous (crashed or aborted)
 * sessions. Registered names of the live session are protected, so a
 * concurrent second session cannot be destroyed by the sweep.
 * Returns the removed file names.
 */
export async function sweepOrphanRestoreStagings(): Promise<string[]> {
  const protectedNames = new Set<string>(registry.keys());

  const root = await getRoot();
  const candidates: string[] = [];
  const iterable = root as unknown as {
    entries: () => AsyncIterable<[string, unknown]>;
  };
  for await (const [name] of iterable.entries()) {
    if (typeof name !== 'string') continue;
    if (!RESTORE_STAGING_NAME_RE.test(name)) continue;
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

/**
 * VULN-001 (CWE-400): create-spam guard. Drop TTL-expired sessions before the
 * sweep below: removing an entry from the registry strips its sweep
 * protection, so the existing orphan sweep removes the evicted session's
 * OPFS file without re-implementing file deletion. Runs only on the at-cap
 * path so the normal flow keeps its current shape.
 */
function evictExpiredRestoreStagings(): void {
  const now = Date.now();
  for (const [name, record] of registry) {
    if (now - record.createdAt >= STAGING_SESSION_TTL) {
      registry.delete(name);
    }
  }
}

/**
 * Issue and register a fresh restore staging name after sweeping leftovers
 * of earlier sessions. The staging file itself is created (truncated to 0)
 * so append never races a missing handle.
 */
export async function prepareRestoreIncoming(
  totalBytes: number,
  totalChunks: number,
): Promise<string> {
  if (registry.size >= MAX_RESTORE_STAGING_SESSIONS) {
    evictExpiredRestoreStagings();
  }
  await sweepOrphanRestoreStagings();
  if (registry.size >= MAX_RESTORE_STAGING_SESSIONS) {
    throw new Error(
      `restore staging registry is full (${MAX_RESTORE_STAGING_SESSIONS} live sessions); refusing to begin another restore session`,
    );
  }
  const name = issueName();
  registry.set(name, {
    totalBytes,
    totalChunks,
    createdAt: Date.now(),
    expectedOffset: 0,
    appendedChunks: 0,
    lastAppendOffset: null,
  });

  const root = await getRoot();
  const handle = await root.getFileHandle(name, { create: true });
  const access = await (handle as unknown as {
    createSyncAccessHandle: () => Promise<{
      truncate: (size: number) => void;
      flush: () => void;
      close: () => void;
    }>;
  }).createSyncAccessHandle();
  try {
    access.truncate(0);
    access.flush();
  } finally {
    access.close();
  }
  return name;
}

/**
 * Unregister a staging name. The caller owns the file itself (commit moves
 * it onto the live DB path; abort removes it).
 */
export function releaseRestoreStaging(name: string): void {
  assertRegisteredRestoreStagingName(name);
  registry.delete(name);
}

/**
 * Validate and account one append against the session's offset progression
 * before the caller touches OPFS. A retry (RETRY_SAFE transport) re-sends the
 * same chunk, so an append starting at the previous append's start offset is
 * an idempotent resend; any other offset that is not exactly the expected
 * progression point would leave a gap or overwrite already-accepted bytes
 * behind a size check that cannot detect it, so it fails closed.
 */
export function recordRestoreAppendChunk(
  name: string,
  offset: number,
  byteLength: number,
): void {
  const record = registry.get(name);
  if (!record) {
    throw new Error(`Unknown restore staging file: ${String(name)}`);
  }
  if (offset + byteLength > record.totalBytes) {
    throw new Error(
      `restore_append: offset ${offset} + ${byteLength} bytes would exceed the session's declared totalBytes (${record.totalBytes})`,
    );
  }
  const isResend = record.lastAppendOffset !== null && offset === record.lastAppendOffset;
  if (!isResend && offset !== record.expectedOffset) {
    throw new Error(
      `restore_append: offset ${offset} does not match the expected session offset ${record.expectedOffset}`,
    );
  }
  if (!isResend) {
    record.expectedOffset = offset + byteLength;
    record.appendedChunks += 1;
    record.lastAppendOffset = offset;
  }
}
