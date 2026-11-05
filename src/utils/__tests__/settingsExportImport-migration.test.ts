/**
 * settingsExportImport-migration.test.ts
 * PBI 2026-11-06-03: プロファイル間移行モード。
 * 異鍵プロファイルの署名付きファイルを `importSettingsForMigration` で
 * 適用できること、通常 `importSettings` は拒否し続けること (VULN-009/035)。
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
  importSettings,
  importSettingsForMigration,
} from '../settingsExportImport.js';
import type { SettingsImportRepo } from '../settingsExportImport.js';
import { hmacSignerForSecret } from '../crypto/hmacSigner.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { API_KEY_FIELDS } from '../storage/settingsMigration.js';
import { StorageKeys } from '../storage/types.js';
import type { Settings } from '../storage/types.js';

/** プロファイル固有 HMAC 鍵に束縛されたテスト用 signer (異鍵環境の再現)。 */
function profileSigner(secret: string): ReturnType<typeof hmacSignerForSecret> {
  return hmacSignerForSecret(async () => secret, 'base64');
}

const PROFILE_A_SECRET = 'profile-a-hmac-secret-for-migration-test';
const PROFILE_B_SECRET = 'profile-b-hmac-secret-for-migration-test';

const CONSENT_KEYS = [
  StorageKeys.PRIVACY_CONSENT,
  StorageKeys.PRIVACY_CONSENT_VERSION,
  StorageKeys.PRIVACY_CONSENT_DENIED_COUNT,
  StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME,
] as string[];
const CONFIRMED_KEY = StorageKeys.CONFIRMED_PROVIDER_ORIGINS as string;

/** 実エクスポーター相当のペイロード設定 (APIキー・同意記録・承認状態なし)。 */
function payloadSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
  };
  for (const field of API_KEY_FIELDS) {
    delete settings[field];
  }
  for (const key of CONSENT_KEYS) {
    delete settings[key];
  }
  delete settings[CONFIRMED_KEY];
  return settings;
}

async function signedFixture(
  secret: string,
  mutate?: (body: Record<string, unknown>) => void
): Promise<string> {
  const signer = profileSigner(secret);
  const body: Record<string, unknown> = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: payloadSettings(),
    apiKeyExcluded: true,
  };
  if (mutate) mutate(body);
  const unsigned = JSON.stringify(body, null, 2);
  const signature = await signer.sign(unsigned);
  return JSON.stringify({ ...body, signature });
}

function makeFakeRepo(existing: Record<string, unknown>): {
  repo: SettingsImportRepo;
  savedPatch: () => Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...existing };
  const getAll = vi.fn(async () => ({ ...store }));
  const setAll = vi.fn(async (patch: Record<string, unknown>) => {
    Object.assign(store, patch);
  });
  return {
    repo: { getAll, setAll } as unknown as SettingsImportRepo,
    savedPatch: (): Record<string, unknown> => {
      expect(setAll).toHaveBeenCalledTimes(1);
      return setAll.mock.calls[0]![0] as Record<string, unknown>;
    },
  };
}

function existingTargetSettings(): Record<string, unknown> {
  return {
    ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
    gemini_api_key: 'target-live-key-must-survive',
    [CONFIRMED_KEY]: { gemini: ['https://target.example.com'] },
    [StorageKeys.PRIVACY_CONSENT as string]: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settingsExportImport profile migration', () => {
  describe('importSettingsForMigration', () => {
    it('applies a file signed by a different profile key', async () => {
      const json = await signedFixture(PROFILE_A_SECRET);
      const { repo, savedPatch } = makeFakeRepo(existingTargetSettings());

      const result = await importSettingsForMigration(json, { repo });

      expect(result).not.toBeNull();
      expect(savedPatch().obsidian_port).toBe(
        (DEFAULT_SETTINGS as unknown as Record<string, unknown>).obsidian_port
      );
    });

    it('applies an unsigned file while the normal path still rejects it', async () => {
      const body: Record<string, unknown> = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: payloadSettings(),
        apiKeyExcluded: true,
      };
      const json = JSON.stringify(body);
      const { repo } = makeFakeRepo(existingTargetSettings());

      const migrated = await importSettingsForMigration(json, { repo });
      const normal = await importSettings(json, {
        repo,
        signer: profileSigner(PROFILE_B_SECRET),
      });

      expect(migrated).not.toBeNull();
      expect(normal).toBeNull();
    });

    it('applies a file signed by its own key', async () => {
      const json = await signedFixture(PROFILE_B_SECRET);
      const { repo } = makeFakeRepo(existingTargetSettings());

      const result = await importSettingsForMigration(json, { repo });

      expect(result).not.toBeNull();
    });

    it('rejects a structurally invalid payload even in migration mode', async () => {
      const json = await signedFixture(PROFILE_A_SECRET, (body) => {
        delete (body.settings as Record<string, unknown>).obsidian_port;
      });
      const { repo } = makeFakeRepo(existingTargetSettings());

      const result = await importSettingsForMigration(json, { repo });

      expect(result).toBeNull();
    });

    it('keeps existing API keys and strips device-local state on migration', async () => {
      const json = await signedFixture(PROFILE_A_SECRET);
      const { repo, savedPatch } = makeFakeRepo(existingTargetSettings());

      await importSettingsForMigration(json, { repo });

      const saved = savedPatch();
      expect(saved.gemini_api_key).toBe('target-live-key-must-survive');
      expect(CONFIRMED_KEY in saved).toBe(false);
      for (const key of CONSENT_KEYS) {
        expect(key in saved).toBe(false);
      }
      expect('privacy_mode' in saved).toBe(false);
    });

    it('records an audit log entry when migration is applied', async () => {
      const json = await signedFixture(PROFILE_A_SECRET);
      const { repo } = makeFakeRepo(existingTargetSettings());

      await importSettingsForMigration(json, { repo });

      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('migration'),
        expect.objectContaining({ hadSignature: true }),
        // 成功時の監査ログに失敗用エラーコードを付けない (実装の意図をpin)。
        undefined,
        'settingsExportImport.ts'
      );
    });
  });

  describe('importSettings normal path (VULN-009/035 regression)', () => {
    it('rejects a file signed by a different profile key', async () => {
      const json = await signedFixture(PROFILE_A_SECRET);
      const { repo } = makeFakeRepo(existingTargetSettings());

      const result = await importSettings(json, {
        repo,
        signer: profileSigner(PROFILE_B_SECRET),
      });

      expect(result).toBeNull();
      expect(mockLogError).toHaveBeenCalled();
    });
  });
});
