/**
 * settingsExportImport-postprocess.test.ts
 * PBI 2026-10-16-01: merge→strip→保存の単一化 + repo/signer注入。
 * settingsRepositoryのモックなしに検証できることが受け入れ基準。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogError = vi.hoisted(() => vi.fn(async () => {}));
const mockLogInfo = vi.hoisted(() => vi.fn(async () => {}));
const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../logger/api.js', () => ({
  logError: mockLogError,
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
}));

import {
  EXPORT_VERSION,
  finalizeImportedSettings,
  importSettings,
} from '../settingsExportImport.js';
import type { SettingsImportRepo } from '../settingsExportImport.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';

const CONFIRMED_KEY = StorageKeys.CONFIRMED_PROVIDER_ORIGINS as string;
const CONFIRMED_VALUE = { gemini: ['https://example.com'] };

function makeFakeRepo(existing: Record<string, unknown>): {
  repo: { getAll: ReturnType<typeof vi.fn>; setAll: ReturnType<typeof vi.fn> };
  saved: () => Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...existing };
  const getAll = vi.fn(async () => ({ ...store }));
  const setAll = vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(store, patch);
  });
  const saved = (): Record<string, unknown> => {
    expect(setAll).toHaveBeenCalledTimes(1);
    return setAll.mock.calls[0][0] as Record<string, unknown>;
  };
  return { repo: { getAll, setAll }, saved };
}

function asRepo(repo: { getAll: unknown; setAll: unknown }): SettingsImportRepo {
  return repo as unknown as SettingsImportRepo;
}

function baseSettings(extra: Record<string, unknown> = {}): Settings {
  return { ...(DEFAULT_SETTINGS as Record<string, unknown>), ...extra } as Settings;
}

function makeSigner() {
  const sign = async (data: string): Promise<string> => `sig:${data}`;
  return {
    sign: vi.fn(sign),
    verify: vi.fn(async (data: string, sig: string) => sig === (await sign(data))),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('finalizeImportedSettings (PBI 2026-10-16-01)', () => {
  it.each([true, false])(
    'apiKeyExcluded=%s: 保存・返却のどちらにも承認状態が残らず両者が一致する',
    async (apiKeyExcluded) => {
      const existing = baseSettings();
      const { repo, saved } = makeFakeRepo(existing as unknown as Record<string, unknown>);
      const imported = baseSettings({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
      // apiKeyExcluded=true の payload はキーを含まない想定
      if (apiKeyExcluded) {
        for (const field of API_KEY_FIELDS) {
          delete (imported as Record<string, unknown>)[field];
        }
      }

      const result = (await finalizeImportedSettings(imported, {
        apiKeyExcluded,
        repo: asRepo(repo),
      })) as unknown as Record<string, unknown>;
      const stored = saved();

      expect(result).not.toHaveProperty(CONFIRMED_KEY);
      expect(stored).not.toHaveProperty(CONFIRMED_KEY);
      expect(result).toEqual(stored);
    }
  );

  it('apiKeyExcluded=true: 既存APIキーが温存される', async () => {
    const existing = baseSettings({ gemini_api_key: 'keep-me' });
    const { repo } = makeFakeRepo(existing as unknown as Record<string, unknown>);
    const imported = baseSettings({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    for (const field of API_KEY_FIELDS) {
      delete (imported as Record<string, unknown>)[field];
    }

    const result = (await finalizeImportedSettings(imported, {
      apiKeyExcluded: true,
      repo: asRepo(repo),
    })) as unknown as Record<string, unknown>;

    expect(result['gemini_api_key']).toBe('keep-me');
  });

  it('apiKeyExcluded=false: payloadの値がそのまま保存される', async () => {
    const existing = baseSettings({ gemini_api_key: 'old' });
    const { repo } = makeFakeRepo(existing as unknown as Record<string, unknown>);
    const imported = baseSettings({ gemini_api_key: 'new-from-payload' });

    const result = (await finalizeImportedSettings(imported, {
      apiKeyExcluded: false,
      repo: asRepo(repo),
    })) as unknown as Record<string, unknown>;

    expect(result['gemini_api_key']).toBe('new-from-payload');
  });
});

describe('importSettings repo/signer注入 (PBI 2026-10-16-01)', () => {
  it('fake repo + fake signerでsettingsRepositoryのmockなしに検証できる', async () => {
    const existing = baseSettings();
    const { repo, saved } = makeFakeRepo(existing as unknown as Record<string, unknown>);
    const signer = makeSigner();
    const settings = baseSettings({ [CONFIRMED_KEY]: CONFIRMED_VALUE });
    for (const field of API_KEY_FIELDS) {
      delete (settings as unknown as Record<string, unknown>)[field];
    }
    const body = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      apiKeyExcluded: true,
    };
    const { signature: _ignored, ...rest } = body;
    void _ignored;
    const dataJson = JSON.stringify(rest, null, 2);
    const signature = await signer.sign(dataJson);
    const json = JSON.stringify({ ...rest, signature });

    const result = (await importSettings(json, {
      repo: asRepo(repo),
      signer,
    })) as unknown as Record<string, unknown>;
    const stored = saved();

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty(CONFIRMED_KEY);
    expect(stored).not.toHaveProperty(CONFIRMED_KEY);
    expect(result).toEqual(stored);
  });
});
