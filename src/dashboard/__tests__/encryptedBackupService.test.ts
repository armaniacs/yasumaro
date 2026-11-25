/**
 * encryptedBackupService.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';
import { encryptEnvelope } from '../../utils/crypto/index.js';
import type { Settings } from '../../utils/storage/types.js';

// PBKDF2 at the production 600,000 iterations dominates this file's runtime.
// The production values are asserted in cryptoParamsSSOT.test.ts; here the KDF
// only needs to behave, not to be expensive.
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

vi.mock('../../utils/storage/encryptionSession.js', () => ({
  isMasterPasswordEnabled: vi.fn(),
  unlockWithPassword: vi.fn(),
}));

vi.mock('../../utils/storage/authGuard.js', () => ({
  isLocked: vi.fn(),
}));

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { exportDb } from '../exportLogsService.js';
import { restoreDb } from '../dashboardSqliteService.js';
import { isMasterPasswordEnabled, unlockWithPassword } from '../../utils/storage/encryptionSession.js';
import { isLocked } from '../../utils/storage/authGuard.js';
import { MAX_ENVELOPE_BASE64_LENGTH, MAX_BACKUP_FILE_BYTES } from '../../utils/limits.js';
import { SplitBackupError, type SplitBackupContainer } from '../encryptedBackupSplitCodec.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
  exportEncryptedSplitBackup,
  importEncryptedSplitBackup,
  isEncryptedSplitBackupFile,
  BACKUP_PAYLOAD_VERSION,
} from '../encryptedBackupService.js';

beforeEach(() => {
  const webcrypto = new Crypto();
  global.crypto = webcrypto;
  vi.clearAllMocks();
  vi.mocked(isMasterPasswordEnabled).mockResolvedValue(false);
  vi.mocked(unlockWithPassword).mockResolvedValue(true);
  // Fail closed by default, matching a fresh set (lockSession writes
  // IS_LOCKED=true); each master-enabled test sets its own state below.
  vi.mocked(isLocked).mockResolvedValue(true);
});

describe('exportEncryptedBackup / importEncryptedBackup', () => {
  const FAKE_SETTINGS = { obsidian_protocol: 'https', obsidian_port: '27124' } as never;
  const FAKE_DB_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

  it('round-trips settings and history db through encrypt/decrypt', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(settingsRepository.setAll).toHaveBeenCalledWith(expect.objectContaining(FAKE_SETTINGS));
    expect(restoreDb).toHaveBeenCalledTimes(1);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
    expect(Array.from(restoredBytes)).toEqual(Array.from(FAKE_DB_BYTES));
  });

  it('round-trips a non-default official OpenAI model without restoring its API key', async () => {
    const sourceSettings = {
      ai_provider: 'openai-official',
      // No slot-level model override: the provider model must survive restoration.
      ai_provider_priority_list: [{ provider: 'openai-official' }],
      openai_official_model: 'custom-official-model',
      openai_official_api_key: 'test-backup-key-not-for-restoration',
      openai_model: 'custom-compatible-model',
    } as Settings;
    vi.mocked(settingsRepository.getAll).mockResolvedValue(sourceSettings);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result).toEqual({ success: true, skippedKeys: ['openai_official_api_key'] });
    expect(settingsRepository.setAll).toHaveBeenCalledExactlyOnceWith({
      ai_provider: 'openai-official',
      ai_provider_priority_list: [{ provider: 'openai-official' }],
      openai_official_model: 'custom-official-model',
      openai_model: 'custom-compatible-model',
    });
    expect(restoreDb).toHaveBeenCalledExactlyOnceWith(FAKE_DB_BYTES);
  });

  it('surfaces the restoreDb failure reason instead of a fixed message', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ error: 'Database file is corrupt' });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Database file is corrupt');
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('fails with wrong password without touching settings or db', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'wrong-password');

    expect(result.success).toBe(false);
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
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
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
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
    vi.mocked(settingsRepository.getAll).mockResolvedValue(TAMPERED_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(result.skippedKeys).toEqual(
      expect.arrayContaining(['obsidian_api_key', 'openai_api_key', 'github_pat'])
    );
    const savedSettings = (vi.mocked(settingsRepository.setAll).mock.calls[0]![0] as Record<string, unknown>);
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
    vi.mocked(settingsRepository.getAll).mockResolvedValue(MIXED_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(result.skippedKeys).toEqual(
      expect.arrayContaining(['sqlite_retention_days', 'some_unknown_key'])
    );
    const savedSettings = (vi.mocked(settingsRepository.setAll).mock.calls[0]![0] as Record<string, unknown>);
    expect(savedSettings).toMatchObject({ obsidian_protocol: 'https' });
    expect(savedSettings).not.toHaveProperty('sqlite_retention_days');
    expect(savedSettings).not.toHaveProperty('some_unknown_key');
  });

  it('rejects import with excessive iterations', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    envelope.iterations = 1_000_000_000;
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
    expect(restoreDb).not.toHaveBeenCalled();
  });

  it('reports export stages in order', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const stages: string[] = [];
    await exportEncryptedBackup('correct-password', (s) => { stages.push(s); });

    expect(stages).toEqual(['readingDb', 'encrypting']);
  });

  it('reports import stages in order', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const stages: string[] = [];
    const result = await importEncryptedBackup(envelope, 'correct-password', (s) => { stages.push(s); });

    expect(result.success).toBe(true);
    expect(stages).toEqual(['decrypting', 'restoringDb', 'restoringSettings']);
  });

  it('unlocks the session with the verified password when a master password is set', async () => {
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);
    vi.mocked(isLocked).mockResolvedValue(true);
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(unlockWithPassword).toHaveBeenCalledWith('correct-password');
    const unlockOrder = vi.mocked(unlockWithPassword).mock.invocationCallOrder[0]!;
    const setAllOrder = vi.mocked(settingsRepository.setAll).mock.invocationCallOrder[0]!;
    expect(unlockOrder).toBeLessThan(setAllOrder);
  });

  it('skips the unlock attempt when a master password is set but the session is already unlocked', async () => {
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);
    vi.mocked(isLocked).mockResolvedValue(false);
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    // The backup password is not necessarily the master password: the
    // session is ready, so restore must proceed without trying it.
    const envelope = await exportEncryptedBackup('backup-password');
    const result = await importEncryptedBackup(envelope, 'backup-password');

    expect(result.success).toBe(true);
    expect(unlockWithPassword).not.toHaveBeenCalled();
    expect(restoreDb).toHaveBeenCalledTimes(1);
    expect(settingsRepository.setAll).toHaveBeenCalledTimes(1);
  });

  it('leaves the session locked path untouched when no master password is set', async () => {
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(false);
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(unlockWithPassword).not.toHaveBeenCalled();
  });

  it('fails import without touching db or settings when unlock fails', async () => {
    vi.mocked(isMasterPasswordEnabled).mockResolvedValue(true);
    vi.mocked(isLocked).mockResolvedValue(true);
    vi.mocked(unlockWithPassword).mockResolvedValue(false);
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const envelope = await exportEncryptedBackup('correct-password');
    const result = await importEncryptedBackup(envelope, 'correct-password');

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('unlock');
    expect((result as { error: string }).error).toContain('master password');
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });
});

describe('encrypted split backup service (PBI01)', () => {
  const FAKE_SETTINGS = { obsidian_protocol: 'https', obsidian_port: '27124' } as never;
  const FAKE_DB_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

  function randomBytes(size: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(size);
    global.crypto.getRandomValues(out);
    return out;
  }

  function compressibleBytes(size: number): Uint8Array<ArrayBuffer> {
    const sentence = 'History log entry for https://example.com/articles/12345 with AI summary text. ';
    const bytes = new TextEncoder().encode(sentence);
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) out[i] = bytes[i % bytes.length]!;
    return out;
  }

  async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('split round-trips settings and history with multiple parts', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([compressibleBytes(2000)]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const container = await exportEncryptedSplitBackup('correct-password', undefined, {
      chunkChars: 64,
    });
    expect(container.parts.length).toBeGreaterThan(1);
    for (const part of container.parts) {
      expect(part.data.length).toBeLessThanOrEqual(MAX_ENVELOPE_BASE64_LENGTH);
    }

    const result = await importEncryptedSplitBackup(container, 'correct-password');

    expect(result.success).toBe(true);
    expect(settingsRepository.setAll).toHaveBeenCalledWith(expect.objectContaining(FAKE_SETTINGS));
    expect(restoreDb).toHaveBeenCalledTimes(1);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
    expect(Array.from(restoredBytes)).toEqual(Array.from(compressibleBytes(2000)));
  });

  it('split round-trips a 30MB-class history db within per-part caps', async () => {
    const dbBytes = randomBytes(30_000_000);
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([dbBytes]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const container = await exportEncryptedSplitBackup('correct-password');
    expect(container.parts.length).toBeGreaterThan(1);
    for (const part of container.parts) {
      expect(part.data.length).toBeLessThanOrEqual(MAX_ENVELOPE_BASE64_LENGTH);
    }

    const result = await importEncryptedSplitBackup(container, 'correct-password');

    expect(result.success).toBe(true);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array<ArrayBuffer>;
    expect(restoredBytes.length).toBe(dbBytes.length);
    await expect(sha256Hex(restoredBytes)).resolves.toBe(await sha256Hex(dbBytes));
  });

  it('split export rejects an over-budget joined body with split-backup-too-large', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    // Incompressible bytes: gzip cannot shrink them, so the joined body is the
    // raw base64 and one byte over the cap boundary is the smallest overshoot
    // base64 can represent (4 chars).
    vi.mocked(exportDb).mockResolvedValue(
      new Blob([randomBytes((MAX_BACKUP_FILE_BYTES * 3) / 4 + 1)]),
    );

    const error = await exportEncryptedSplitBackup('correct-password').then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SplitBackupError);
    expect((error as SplitBackupError).code).toBe('split-backup-too-large');
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('reports split export/import stages in order', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS as any);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const exportStages: string[] = [];
    const container = await exportEncryptedSplitBackup('correct-password', (s) => {
      exportStages.push(s);
    });
    expect(exportStages).toEqual(['readingDb', 'encrypting']);

    const importStages: string[] = [];
    const result = await importEncryptedSplitBackup(container, 'correct-password', (s) => {
      importStages.push(s);
    });
    expect(result.success).toBe(true);
    expect(importStages).toEqual(['decrypting', 'restoringDb', 'restoringSettings']);
  });

  it('split import rejects a missing part naming the part number', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([compressibleBytes(2000)]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const container = await exportEncryptedSplitBackup('correct-password', undefined, {
      chunkChars: 64,
    });
    expect(container.parts.length).toBeGreaterThan(2);
    const dropped: SplitBackupContainer = {
      ...container,
      parts: container.parts.filter((_, i) => i !== 1),
    };

    const result = await importEncryptedSplitBackup(dropped, 'correct-password');

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('1');
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('split import rejects a tampered part without touching db or settings', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([compressibleBytes(2000)]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const container = await exportEncryptedSplitBackup('correct-password', undefined, {
      chunkChars: 64,
    });
    const tampered = structuredClone(container);
    const data = tampered.parts[0]!.data;
    tampered.parts[0]!.data = `${data.slice(0, -1)}${data.at(-1) === 'A' ? 'B' : 'A'}`;

    const result = await importEncryptedSplitBackup(tampered, 'correct-password');

    expect(result.success).toBe(false);
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('single-format importer rejects a split container without touching db or settings', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const container = await exportEncryptedSplitBackup('correct-password');

    const result = await importEncryptedBackup(container as never, 'correct-password');

    expect(result.success).toBe(false);
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('split importer rejects a single-format envelope', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });

    const envelope = await exportEncryptedBackup('correct-password');

    const result = await importEncryptedSplitBackup(envelope as never, 'correct-password');

    expect(result.success).toBe(false);
    expect(restoreDb).not.toHaveBeenCalled();
    expect(settingsRepository.setAll).not.toHaveBeenCalled();
  });

  it('legacy single-format envelope still restores (backward compat)', async () => {
    vi.mocked(restoreDb).mockResolvedValue({ data: undefined });
    let binary = '';
    for (const b of FAKE_DB_BYTES) binary += String.fromCharCode(b);
    const legacyPayload = {
      version: BACKUP_PAYLOAD_VERSION,
      exportedAt: new Date().toISOString(),
      settings: FAKE_SETTINGS,
      historyDbBase64: btoa(binary),
    };
    const legacyEnvelope = await encryptEnvelope(JSON.stringify(legacyPayload), 'correct-password');

    const result = await importEncryptedBackup(legacyEnvelope, 'correct-password');

    expect(result.success).toBe(true);
    expect(restoreDb).toHaveBeenCalledTimes(1);
    const restoredBytes = vi.mocked(restoreDb).mock.calls[0]![0] as Uint8Array;
    expect(Array.from(restoredBytes)).toEqual(Array.from(FAKE_DB_BYTES));
  });

  it('isEncryptedSplitBackupFile discriminates containers from single envelopes', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue(FAKE_SETTINGS);
    vi.mocked(exportDb).mockResolvedValue(new Blob([FAKE_DB_BYTES]));

    const container = await exportEncryptedSplitBackup('correct-password');
    const single = await exportEncryptedBackup('correct-password');

    expect(isEncryptedSplitBackupFile(container)).toBe(true);
    expect(isEncryptedSplitBackupFile(single)).toBe(false);
    expect(isEncryptedSplitBackupFile(null)).toBe(false);
  });
});
