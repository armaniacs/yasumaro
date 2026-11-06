/**
 * encryptedBackupService-backupCap.test.ts (PBI 2026-11-06-02)
 *
 * Large-backup round trip: a 12MB-class history DB must export and restore
 * through the password-based backup path; tampered backups stay rejected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

// Production KDF iterations would dominate this file's runtime; the values
// themselves are pinned in cryptoParamsSSOT.test.ts.
vi.mock('../../utils/crypto/cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/crypto/cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: {
      ...actual.CRYPTO_PARAMS,
      PBKDF2_ITERATIONS: 1_000,
      LEGACY_PBKDF2_ITERATIONS: 100,
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const repo = actual.settingsRepository as Record<string, unknown>;
  const mockedRepo = {
    ...repo,
    getAll: vi.fn(),
    setAll: vi.fn(),
    getMany: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  return {
    ...actual,
    settingsRepository: mockedRepo,
  };
});

vi.mock('../exportLogsService.js', () => ({
  exportDb: vi.fn(),
}));

vi.mock('../dashboardSqliteService.js', () => ({
  restoreDb: vi.fn(),
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
}));

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { exportDb } from '../exportLogsService.js';
import { restoreDb } from '../dashboardSqliteService.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
} from '../encryptedBackupService.js';

beforeEach(() => {
  const webcrypto = new Crypto();
  global.crypto = webcrypto;
  vi.clearAllMocks();
});

describe('encryptedBackupService backup cap (PBI 2026-11-06-02)', () => {
  describe('exportEncryptedBackup / importEncryptedBackup', () => {
    it('round-trips a 12MB-class history DB through encrypt/decrypt', async () => {
      const DB_BYTES = 12 * 1024 * 1024;
      const fakeDb = new Uint8Array(DB_BYTES);
      for (let i = 0; i < fakeDb.length; i++) fakeDb[i] = i % 251;
      const fakeSettings = { obsidian_protocol: 'https', obsidian_port: '27124' } as never;
      vi.mocked(settingsRepository.getAll).mockResolvedValue(fakeSettings);
      vi.mocked(exportDb).mockResolvedValue(new Blob([fakeDb as BlobPart]));
      vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

      const envelope = await exportEncryptedBackup('correct-password');
      const result = await importEncryptedBackup(envelope, 'correct-password');

      expect(result.success).toBe(true);
      expect(restoreDb).toHaveBeenCalledTimes(1);
      const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
      expect(restoredBytes.byteLength).toBe(DB_BYTES);
      expect(restoredBytes[0]).toBe(fakeDb[0]);
      expect(restoredBytes[restoredBytes.length - 1]).toBe(fakeDb[fakeDb.length - 1]);
      expect(restoredBytes[1_000_000]).toBe(fakeDb[1_000_000]);
      expect(settingsRepository.setAll).toHaveBeenCalledWith(
        expect.objectContaining({ obsidian_protocol: 'https' }),
      );
    });

    it('rejects a backup whose ciphertext was tampered with by one char', async () => {
      const fakeDb = new Uint8Array([1, 2, 3, 4, 5]);
      const fakeSettings = { obsidian_protocol: 'https', obsidian_port: '27124' } as never;
      vi.mocked(settingsRepository.getAll).mockResolvedValue(fakeSettings);
      vi.mocked(exportDb).mockResolvedValue(new Blob([fakeDb as BlobPart]));
      vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

      const envelope = await exportEncryptedBackup('correct-password');
      const last = envelope.data[envelope.data.length - 1];
      envelope.data = envelope.data.slice(0, -1) + (last === 'A' ? 'B' : 'A');
      const result = await importEncryptedBackup(envelope, 'correct-password');

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toContain('Decryption failed');
      expect(restoreDb).not.toHaveBeenCalled();
      expect(settingsRepository.setAll).not.toHaveBeenCalled();
    });
  });
});
