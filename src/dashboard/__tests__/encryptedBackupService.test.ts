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

  it('strips sensitive API key fields from a tampered backup before restoring', async () => {
    const TAMPERED_SETTINGS = {
      obsidian_protocol: 'https',
      obsidian_port: '27124',
      obsidian_api_key: 'sk-attacker-key',
      openai_api_key: 'sk-attacker-key-2',
      github_pat: 'ghp_attackertoken',
    } as never;
    vi.mocked(getSettings).mockResolvedValue(TAMPERED_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue(true);

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(result.skippedKeys).toEqual(
      expect.arrayContaining(['obsidian_api_key', 'openai_api_key', 'github_pat'])
    );
    const savedSettings = vi.mocked(saveSettings).mock.calls[0]![0];
    expect(savedSettings).not.toHaveProperty('obsidian_api_key');
    expect(savedSettings).not.toHaveProperty('openai_api_key');
    expect(savedSettings).not.toHaveProperty('github_pat');
    expect(savedSettings).toMatchObject({ obsidian_protocol: 'https', obsidian_port: '27124' });
  });

  it('reports skipped keys for an unknown/malformed field while restoring valid ones', async () => {
    const MIXED_SETTINGS = {
      obsidian_protocol: 'https',
      sqlite_retention_days: 'not-a-number',
      some_unknown_key: 'x',
    } as never;
    vi.mocked(getSettings).mockResolvedValue(MIXED_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue(true);

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(result.skippedKeys).toEqual(
      expect.arrayContaining(['sqlite_retention_days', 'some_unknown_key'])
    );
    const savedSettings = vi.mocked(saveSettings).mock.calls[0]![0];
    expect(savedSettings).toMatchObject({ obsidian_protocol: 'https' });
    expect(savedSettings).not.toHaveProperty('sqlite_retention_days');
    expect(savedSettings).not.toHaveProperty('some_unknown_key');
  });
});
