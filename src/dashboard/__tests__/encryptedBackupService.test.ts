/**
 * encryptedBackupService.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('../exportLogsService.js', () => ({
  exportDb: vi.fn(),
}));

vi.mock('../dashboardSqliteService.js', () => ({
  restoreDb: vi.fn(),
}));

import { getSettings, saveSettings } from '../../utils/storage.js';
import { exportDb } from '../exportLogsService.js';
import { restoreDb } from '../dashboardSqliteService.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
  BACKUP_PAYLOAD_VERSION,
} from '../encryptedBackupService.js';

beforeEach(() => {
  const webcrypto = new Crypto();
  // @ts-expect-error jsdom crypto override for test env
  global.crypto = webcrypto;
  vi.clearAllMocks();
});

describe('exportEncryptedBackup / importEncryptedBackup', () => {
  const FAKE_SETTINGS = { obsidian_protocol: 'https', obsidian_port: '27124' } as never;
  const FAKE_DB_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

  it('round-trips settings and history db through encrypt/decrypt', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue(true);

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(FAKE_SETTINGS);
    expect(restoreDb).toHaveBeenCalledTimes(1);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
    expect(Array.from(restoredBytes)).toEqual(Array.from(FAKE_DB_BYTES));
  });

  it('fails with wrong password without touching settings or db', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'wrong-password');

    expect(result.success).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(restoreDb).not.toHaveBeenCalled();
  });

  it('rejects payload with unsupported version', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');
    expect(result.success).toBe(true);
  });

  it('rejects when exportDb fails (no history db available)', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(null);

    await expect(exportEncryptedBackup('correct-password')).rejects.toThrow();
  });
});
