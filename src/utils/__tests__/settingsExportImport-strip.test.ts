/**
 * settingsExportImport-strip.test.ts
 * PBI 2026-10-16-04 (b): 返却値と保存値が一致すること。
 * `setAll` には strip 済みを保存しながら返却は strip 前のままだった。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
const mockRepoGetAll = vi.hoisted(() => vi.fn(async () => ({})));
const mockRepoSetAll = vi.hoisted(() => vi.fn(async (_patch: Record<string, unknown>) => {}));
const mockSigner = vi.hoisted(() => {
  const sign = async (data: string) => `test-sig:${data}`;
  return {
    sign: vi.fn(sign),
    verify: vi.fn(async (data: string, sig: string) => sig === (await sign(data))),
  };
});
const mockDecrypt = vi.hoisted(() => vi.fn());

vi.mock('../logger/api.js', () => ({
  logError: mockLogError,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

vi.mock('../storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: mockRepoGetAll, setAll: mockRepoSetAll },
}));

vi.mock('../storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, exportHmacSigner: mockSigner };
});

vi.mock('../crypto/kdfNegotiator.js', () => ({
  decryptWithIterationCandidates: mockDecrypt,
}));

import {
  EXPORT_VERSION,
  importEncryptedSettings,
  importSettings,
} from '../settingsExportImport.js';
import { exportHmacSigner } from '../storage/encryptionSession.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';
import { StorageKeys } from '../storage/types.js';

const CONFIRMED_KEY = StorageKeys.CONFIRMED_PROVIDER_ORIGINS as string;
const CONFIRMED_VALUE = { gemini: ['https://example.com'] };

function settingsWithConfirmed(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(DEFAULT_SETTINGS as Record<string, unknown>), ...extra };
}

function payload(settings: Record<string, unknown>, apiKeyExcluded: boolean): Record<string, unknown> {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    apiKeyExcluded,
  };
}

async function signedJson(body: Record<string, unknown>): Promise<string> {
  const { signature: _ignored, ...rest } = body;
  const dataJson = JSON.stringify(rest, null, 2);
  const signature = await exportHmacSigner.sign(dataJson);
  return JSON.stringify({ ...rest, signature });
}

function savedValue(): Record<string, unknown> {
  expect(mockRepoSetAll).toHaveBeenCalledTimes(1);
  return mockRepoSetAll.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoGetAll.mockResolvedValue({ ...(DEFAULT_SETTINGS as Record<string, unknown>) });
});

describe('settingsExportImport strip consistency', () => {
  it('importSettings (apiKeyExcluded=true): 返却値も保存値も strip 済みで一致する', async () => {
    const settings = settingsWithConfirmed({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    for (const field of API_KEY_FIELDS) {
      delete settings[field];
    }
    const json = await signedJson(payload(settings, true));

    const result = await importSettings(json) as unknown as Record<string, unknown>;
    const saved = savedValue();

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(CONFIRMED_KEY);
    expect(saved).not.toHaveProperty(CONFIRMED_KEY);
    expect(result).toEqual(saved);
  });

  it('importSettings (apiKeyExcluded=false): 返却値も保存値も strip 済みで一致する', async () => {
    const settings = settingsWithConfirmed({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    const json = await signedJson(payload(settings, false));

    const result = await importSettings(json) as unknown as Record<string, unknown>;
    const saved = savedValue();

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(CONFIRMED_KEY);
    expect(saved).not.toHaveProperty(CONFIRMED_KEY);
    expect(result).toEqual(saved);
  });

  it('importEncryptedSettings (unsigned v1, apiKeyExcluded=false): 返却値も保存値も strip 済みで一致する', async () => {
    const settings = settingsWithConfirmed({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    mockDecrypt.mockResolvedValueOnce({
      text: JSON.stringify(payload(settings, false)),
      needsRehash: false,
    });
    const envelope = JSON.stringify({
      encrypted: true,
      version: '1',
      exportedAt: new Date().toISOString(),
      ciphertext: 'c',
      iv: 'v',
      salt: 's',
    });

    const result = await importEncryptedSettings(envelope, 'master_password') as unknown as Record<string, unknown>;
    const saved = savedValue();

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(CONFIRMED_KEY);
    expect(saved).not.toHaveProperty(CONFIRMED_KEY);
    expect(result).toEqual(saved);
  });

  it('importEncryptedSettings (unsigned v1, apiKeyExcluded=true): 返却値も保存値も strip 済みで一致する', async () => {
    const settings = settingsWithConfirmed({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    for (const field of API_KEY_FIELDS) {
      delete settings[field];
    }
    mockDecrypt.mockResolvedValueOnce({
      text: JSON.stringify(payload(settings, true)),
      needsRehash: false,
    });
    const envelope = JSON.stringify({
      encrypted: true,
      version: '1',
      exportedAt: new Date().toISOString(),
      ciphertext: 'c',
      iv: 'v',
      salt: 's',
    });

    const result = await importEncryptedSettings(envelope, 'master_password') as unknown as Record<string, unknown>;
    const saved = savedValue();

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(CONFIRMED_KEY);
    expect(saved).not.toHaveProperty(CONFIRMED_KEY);
    expect(result).toEqual(saved);
  });
});
