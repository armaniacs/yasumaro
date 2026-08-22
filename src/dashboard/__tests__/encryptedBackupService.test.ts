/**
 * encryptedBackupService.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import { encryptEnvelope } from '../../utils/crypto/index.js';

vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn(),
    saveSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

vi.mock('../exportLogsService.js', () => ({
  exportDb: vi.fn(),
}));

vi.mock('../dashboardSqliteService.js', () => ({
  restoreDb: vi.fn(),
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
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
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(FAKE_SETTINGS);
    expect(restoreDb).toHaveBeenCalledTimes(1);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
    expect(Array.from(restoredBytes)).toEqual(Array.from(FAKE_DB_BYTES));
  });

  it('surfaces the restoreDb failure reason instead of a fixed message', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ error: 'Database file is corrupt' });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Database file is corrupt');
    expect(saveSettings).not.toHaveBeenCalled();
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
    // The original assertion here checked success==true, which cannot
    // exercise the version guard — it happened to pass only because
    // restoreDb was left unmocked (resolving to undefined) and the outcome
    // depended on isServiceError tolerating that, not on the guard itself.
    const futurePayload = {
      version: BACKUP_PAYLOAD_VERSION + 1,
      exportedAt: new Date().toISOString(),
      settings: FAKE_SETTINGS,
      historyDbBase64: 'AAAA',
    };
    const envelope = await encryptEnvelope(JSON.stringify(futurePayload), 'correct-password');

    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Unsupported backup version');
    expect(restoreDb).not.toHaveBeenCalled();
  });

  it('rejects when exportDb fails', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockRejectedValue(new Error('Database unavailable'));

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
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

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
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

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

  it('rejects import with excessive iterations', async () => {
    vi.mocked(getSettings).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    envelope.iterations = 1_000_000_000;
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(restoreDb).not.toHaveBeenCalled();
  });
});
