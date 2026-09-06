// @vitest-environment jsdom
/**
 * archiveFallbackRejection.test.ts
 * PBI 2026-09-07-02 (Y2): the non-OPFS backends (IDB-VFS, FallbackStorage)
 * must reject every archive operation with the OPFS-required error — the
 * archive feature (staging registry + second engine) exists only on the OPFS
 * worker path. Error string is a raw English literal (not i18n): the manual
 * checklist expects exactly 'Archive requires OPFS storage.'.
 */
import { describe, it, expect } from 'vitest';
import { FallbackStorageAdapter } from '../FallbackStorageAdapter.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';

const EXPECTED_ERROR = 'Archive requires OPFS storage.';

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

describe('Y2: non-OPFS backends reject archive operations', () => {
  it('FallbackStorageAdapter rejects every archive* method with the OPFS error', async () => {
    // The archive* methods never touch the underlying fallback store —
    // a bare object is enough to prove the rejection path.
    const adapter = new FallbackStorageAdapter({} as never);
    for (const method of ARCHIVE_METHODS) {
      const result = await (adapter as unknown as Record<string, () => Promise<unknown>>)[method]();
      expect(result, `${method} must fail closed`).toEqual({ success: false, error: EXPECTED_ERROR });
    }
  });

  it('IdbVfsBackend rejects every archive method with the OPFS error (before any IDB access)', async () => {
    // The archive methods short-circuit before touching the engine host —
    // an empty host proves no engine access happens on the reject path.
    const backend = new IdbVfsBackend({} as never);
    for (const method of ARCHIVE_METHODS) {
      const result = await (backend as unknown as Record<string, () => Promise<unknown>>)[method]();
      expect(result, `${method} must fail closed`).toEqual({ success: false, error: EXPECTED_ERROR });
    }
  });
});
