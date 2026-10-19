/**
 * settingsMigration-port-unify.test.ts (PBI 2026-10-16-12)
 *
 * Port unification: every migration path must work through an injected
 * StoragePort / opts alone, with no direct chrome.storage.local access.
 * Uses DI (TEST_RULE) — no chrome mock swapping, only call-count spies on
 * the shared setup mock to prove the backdoor is gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyMigrationsAndDecryptWithReEncrypt,
  migrateToSingleSettingsObject,
  tryRestoreFromBackup,
  cleanupExpiredSettingsBackups,
  migrateLoopbackProviderOriginConfirmations,
  SETTINGS_MIGRATED_KEY,
} from '../settingsMigration.js';
import { SettingsRepository } from '../SettingsRepository.js';
import { InMemoryStoragePort, type StoragePort } from '../storagePort.js';
import { StorageKeys } from '../types.js';
import { encryptApiKey } from '../../crypto/index.js';
import { LEGACY_SETTINGS_BACKUP_KEY } from '../settingsBackup.js';

vi.mock('../../logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003' },
  }),
);
vi.mock('../../logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003' },
  }),
);
vi.mock('../../logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'resolved',
    logWarn: 'resolved',
    logError: 'resolved',
    logDebug: 'resolved',
    ErrorCode: { CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002', CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001', CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003' },
  }),
);

async function generateKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Call counts on the shared chrome.storage.local mock — must not move. */
function chromeStorageCallCounts(): Record<'get' | 'set' | 'remove', number> {
  const local = globalThis.chrome.storage.local as unknown as Record<string, { mock: { calls: unknown[] } }>;
  return {
    get: (local.get as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    set: (local.set as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    remove: (local.remove as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
  };
}

describe('settingsMigration port unify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyMigrationsAndDecryptWithReEncrypt legacy fallback', () => {
    it('decrypts via the injected legacy key without touching chrome.storage', async () => {
      const currentKey = await generateKey();
      const legacyKey = await generateKey();
      const ciphertext = await encryptApiKey('sk-legacy-value', legacyKey, StorageKeys.GEMINI_API_KEY);
      const before = chromeStorageCallCounts();

      const result = await applyMigrationsAndDecryptWithReEncrypt(
        { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
        {
          getEncryptionKey: async () => currentKey,
          isMasterPasswordEnabled: false,
          deriveLegacyKey: async () => legacyKey,
        },
      );

      expect(result.settings[StorageKeys.GEMINI_API_KEY]).toBe('sk-legacy-value');
      expect(result.unrecoverable).toHaveLength(0);
      expect(result.reEncrypted[StorageKeys.GEMINI_API_KEY as string]).toBeDefined();
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    it('reports unrecoverable without touching chrome.storage when no legacy key is injected', async () => {
      const currentKey = await generateKey();
      const otherKey = await generateKey();
      const ciphertext = await encryptApiKey('sk-secret-value', otherKey, StorageKeys.GEMINI_API_KEY);
      const before = chromeStorageCallCounts();

      const result = await applyMigrationsAndDecryptWithReEncrypt(
        { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
        {
          getEncryptionKey: async () => currentKey,
          isMasterPasswordEnabled: false,
          deriveLegacyKey: async () => null,
        },
      );

      expect(result.settings[StorageKeys.GEMINI_API_KEY]).toEqual(ciphertext);
      expect(result.unrecoverable).toContain(StorageKeys.GEMINI_API_KEY);
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    it('skips legacy derivation in master-password mode without touching storage', async () => {
      const currentKey = await generateKey();
      const otherKey = await generateKey();
      const ciphertext = await encryptApiKey('sk-secret-value', otherKey, StorageKeys.GEMINI_API_KEY);
      const deriveLegacyKey = vi.fn(async () => otherKey);
      const before = chromeStorageCallCounts();

      const result = await applyMigrationsAndDecryptWithReEncrypt(
        { [StorageKeys.GEMINI_API_KEY]: ciphertext } as never,
        {
          getEncryptionKey: async () => currentKey,
          isMasterPasswordEnabled: true,
          deriveLegacyKey,
        },
      );

      expect(result.unrecoverable).toContain(StorageKeys.GEMINI_API_KEY);
      expect(deriveLegacyKey).not.toHaveBeenCalled();
      expect(chromeStorageCallCounts()).toEqual(before);
    });
  });

  describe('migrateToSingleSettingsObject', () => {
    it('migrates scattered keys through the injected port without touching chrome.storage', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ [StorageKeys.GEMINI_API_KEY]: 'plain-key-value' });
      const before = chromeStorageCallCounts();

      const migrated = await migrateToSingleSettingsObject({ port });

      expect(migrated).toBe(true);
      const blob = (await port.get('settings'))['settings'] as Record<string, unknown>;
      expect(blob[StorageKeys.GEMINI_API_KEY]).toBe('plain-key-value');
      expect(await port.get(StorageKeys.GEMINI_API_KEY)).toEqual({});
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    it('rejects when the port cannot remove instead of falling back to chrome.storage', async () => {
      const backing = new InMemoryStoragePort();
      backing.seed({ [StorageKeys.GEMINI_API_KEY]: 'plain-key-value' });
      const portWithoutRemove: StoragePort = {
        get: (keys) => backing.get(keys),
        set: (items) => backing.set(items),
      };
      const before = chromeStorageCallCounts();

      await expect(migrateToSingleSettingsObject({ port: portWithoutRemove })).rejects.toThrow(/remove/);
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    // PBI 2026-10-19-03: the consent record, its ack version and the denial
    // counters are ONE unit read top-level by privacyConsent.ts. Folding only
    // the record into the blob splits the unit across two stores: the version
    // says "acknowledged at vX" while the record reads as absent, so the consent
    // modal returns and recording is blocked by the gate.
    it('keeps the consent unit top-level instead of folding it into the blob', async () => {
      const port = new InMemoryStoragePort();
      const consent = {
        hasConsented: true,
        consentDate: '2026-10-01T00:00:00Z',
        consentVersion: '2026-09-08',
      };
      port.seed({
        [StorageKeys.PRIVACY_CONSENT]: consent,
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 2,
        [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: 1700000000000,
        [StorageKeys.PRIVACY_CONSENT_VERSION]: '2026-09-08',
        [StorageKeys.GEMINI_API_KEY]: 'plain-key-value',
      });

      await migrateToSingleSettingsObject({ port });

      expect(await port.get([StorageKeys.PRIVACY_CONSENT])).toEqual({
        [StorageKeys.PRIVACY_CONSENT]: consent,
      });
      expect(await port.get([StorageKeys.PRIVACY_CONSENT_DENIED_COUNT])).toEqual({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 2,
      });
      expect(await port.get([StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME])).toEqual({
        [StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]: 1700000000000,
      });

      const blob = (await port.get('settings'))['settings'] as Record<string, unknown>;
      expect(blob[StorageKeys.PRIVACY_CONSENT]).toBeUndefined();
      expect(blob[StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]).toBeUndefined();
      expect(blob[StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME]).toBeUndefined();
      // Unrelated keys still migrate.
      expect(blob[StorageKeys.GEMINI_API_KEY]).toBe('plain-key-value');
      expect(await port.get([StorageKeys.GEMINI_API_KEY])).toEqual({});
    });

    // Profiles migrated before the allowlist fix already have the record inside
    // the blob and nothing top-level. Promoting it back is the only way to heal
    // them without asking every user to consent again.
    it('promotes a consent unit folded by an earlier run back to top-level', async () => {
      const port = new InMemoryStoragePort();
      const consent = { hasConsented: true, consentDate: '2026-10-01T00:00:00Z' };
      port.seed({
        settings: {
          [StorageKeys.PRIVACY_CONSENT]: consent,
          [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 3,
        },
        [StorageKeys.PRIVACY_CONSENT_VERSION]: '2026-09-08',
        [SETTINGS_MIGRATED_KEY]: { schemaVersion: 2, stage: 'completed' },
      });

      const migrated = await migrateToSingleSettingsObject({ port });

      // The migration itself is already complete; the heal runs regardless.
      expect(migrated).toBe(false);
      expect(await port.get([StorageKeys.PRIVACY_CONSENT])).toEqual({
        [StorageKeys.PRIVACY_CONSENT]: consent,
      });
      expect(await port.get([StorageKeys.PRIVACY_CONSENT_DENIED_COUNT])).toEqual({
        [StorageKeys.PRIVACY_CONSENT_DENIED_COUNT]: 3,
      });
    });

    it('leaves a profile that never consented untouched (heal is idempotent)', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ settings: { [StorageKeys.OBSIDIAN_PORT]: '27123' } });

      await migrateToSingleSettingsObject({ port });
      await migrateToSingleSettingsObject({ port });

      expect(await port.get([StorageKeys.PRIVACY_CONSENT])).toEqual({});
      const blob = (await port.get('settings'))['settings'] as Record<string, unknown>;
      expect(blob[StorageKeys.OBSIDIAN_PORT]).toBe('27123');
    });
  });

  describe('backup helpers', () => {
    it('restores the latest backup through the injected port', async () => {
      const port = new InMemoryStoragePort();
      port.seed({
        [`${LEGACY_SETTINGS_BACKUP_KEY}_123`]: {
          data: { [StorageKeys.GEMINI_API_KEY]: 'backed-up' },
          createdAt: 123,
        },
      });
      const before = chromeStorageCallCounts();

      const restored = await tryRestoreFromBackup(port);

      expect(restored).toMatchObject({ [StorageKeys.GEMINI_API_KEY]: 'backed-up' });
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    it('cleans expired backups through the injected port', async () => {
      const port = new InMemoryStoragePort();
      const oldKey = `${LEGACY_SETTINGS_BACKUP_KEY}_1`;
      port.seed({ [oldKey]: { data: {}, createdAt: 1 } });
      const before = chromeStorageCallCounts();

      await cleanupExpiredSettingsBackups(port);

      expect(await port.get(oldKey)).toEqual({});
      expect(chromeStorageCallCounts()).toEqual(before);
    });
  });

  describe('migrateLoopbackProviderOriginConfirmations', () => {
    it('seeds a stored loopback URL through the injected port without touching chrome.storage', async () => {
      const port = new InMemoryStoragePort();
      port.seed({
        settings: { [StorageKeys.PROVIDER_BASE_URL]: 'http://localhost:11434/v1' },
      });
      const before = chromeStorageCallCounts();

      const seeded = await migrateLoopbackProviderOriginConfirmations({ port });

      expect(seeded).toBe(true);
      const blob = (await port.get('settings'))['settings'] as Record<string, unknown>;
      const confirmed = blob[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]>;
      expect(confirmed[StorageKeys.PROVIDER_BASE_URL]).toEqual(['http://localhost:11434']);
      expect((await port.get('provider_loopback_origin_grandfather_done'))['provider_loopback_origin_grandfather_done']).toBe(true);
      expect(chromeStorageCallCounts()).toEqual(before);
    });
  });

  describe('SettingsRepository', () => {
    it('serves getAll from the port without touching chrome.storage', async () => {
      const key = await generateKey();
      const port = new InMemoryStoragePort();
      port.seed({
        settings: { [StorageKeys.GEMINI_API_KEY]: 'plain-key-value' },
        [SETTINGS_MIGRATED_KEY]: { schemaVersion: 2, stage: 'completed' },
      });
      const repo = new SettingsRepository(port, { keyProvider: async () => key });
      const before = chromeStorageCallCounts();

      const settings = await repo.getAll();

      expect(settings[StorageKeys.GEMINI_API_KEY]).toBe('plain-key-value');
      expect(chromeStorageCallCounts()).toEqual(before);
    });

    it('takes the master-password flag from the port in the decrypt path', async () => {
      const currentKey = await generateKey();
      const otherKey = await generateKey();
      const ciphertext = await encryptApiKey('sk-secret-value', otherKey, StorageKeys.GEMINI_API_KEY);
      const port = new InMemoryStoragePort();
      port.seed({
        settings: { [StorageKeys.GEMINI_API_KEY]: ciphertext },
        [SETTINGS_MIGRATED_KEY]: { schemaVersion: 2, stage: 'completed' },
        [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
      });
      const repo = new SettingsRepository(port, { keyProvider: async () => currentKey });
      const before = chromeStorageCallCounts();

      const settings = await repo.getAll();

      // Master mode: legacy fallback is skipped, ciphertext preserved as unrecoverable
      expect(settings[StorageKeys.GEMINI_API_KEY]).toEqual(ciphertext);
      expect(chromeStorageCallCounts()).toEqual(before);
    });
  });
});
