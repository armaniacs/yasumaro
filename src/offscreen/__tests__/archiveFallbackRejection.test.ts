// @vitest-environment jsdom
/**
 * archiveFallbackRejection.test.ts
 * PBI 2026-09-07-02 (Y2), narrowed by PBI 2026-09-11-06: the non-OPFS
 * backends (IDB-VFS, FallbackStorage) carry NO archive operations — the 14
 * archive methods live behind ArchiveStaging (implemented only by
 * OpfsWorkerBackend) and the ARCHIVE_DISPATCH layer fails closed with the
 * OPFS-required error. Error string is a raw English literal (not i18n):
 * the manual checklist expects exactly 'Archive requires OPFS storage.'.
 * The literal lives in one place (StorageBackend.ARCHIVE_UNSUPPORTED_ERROR) —
 * the test pins the constant, not a re-typed copy.
 */
import { describe, it, expect } from 'vitest';
import { FallbackStorageAdapter } from '../FallbackStorageAdapter.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { ARCHIVE_UNSUPPORTED_ERROR } from '../StorageBackend.js';
import { supportsArchive } from '../archiveStaging.js';

const EXPECTED_ERROR = ARCHIVE_UNSUPPORTED_ERROR;

const ARCHIVE_METHODS = [
  'archivePreview',
  'archiveCreate',
  'archiveCleanup',
  'archiveExportChunk',
  'archivePrepareIncoming',
  'archiveRestorePreview',
  'archiveRestore',
  'archiveDeleteByStaging',
  'archiveOpen',
  'archiveQuery',
  'archiveUpdate',
  'archiveSave',
  'archiveClose',
  'archiveStatus',
] as const;

describe('Y2: non-OPFS backends carry no archive operations', () => {
  it('FallbackStorageAdapter exposes no archive* methods', () => {
    const adapter = new FallbackStorageAdapter({} as never);
    const surface = adapter as unknown as Record<string, unknown>;
    for (const method of ARCHIVE_METHODS) {
      expect(surface[method]).toBeUndefined();
    }
    expect(supportsArchive(adapter)).toBe(false);
  });

  it('IdbVfsBackend exposes no archive* methods', () => {
    const backend = new IdbVfsBackend({} as never);
    const surface = backend as unknown as Record<string, unknown>;
    for (const method of ARCHIVE_METHODS) {
      expect(surface[method]).toBeUndefined();
    }
    expect(supportsArchive(backend)).toBe(false);
  });

  it('supportsArchive accepts a staging backend', () => {
    const staging = Object.fromEntries(ARCHIVE_METHODS.map((m) => [m, async () => ({ success: true })]));
    expect(supportsArchive(staging as never)).toBe(true);
  });

  it('pins the fail-closed error constant', () => {
    expect(EXPECTED_ERROR).toBe('Archive requires OPFS storage.');
  });
});
