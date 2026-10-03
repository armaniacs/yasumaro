/**
 * Real crypto + real signer round trips for the encrypted export HMAC.
 * Only the settings repository and logger are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

const repo = vi.hoisted(() => ({
  getAll: vi.fn(),
  setAll: vi.fn(async () => {}),
}));
vi.mock('../storage/SettingsRepository.js', () => ({ settingsRepository: repo }));
vi.mock('../logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: 'asyncNoop',
    logInfo: 'asyncNoop',
    logWarn: 'asyncNoop',
    logDebug: 'asyncNoop',
  }),
);

import {
  exportEncryptedSettings,
  importEncryptedSettings,
  ENCRYPTED_EXPORT_VERSION,
  LEGACY_ENCRYPTED_EXPORT_VERSION,
  type EncryptedExportData,
} from '../settingsExportImport.js';
import { exportHmacSigner } from '../storage/encryptionSession.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { CRYPTO_PARAMS } from '../crypto/cryptoParams.js';
import { deriveKey, encrypt, generateSalt, bytesToBase64 } from '../crypto/index.js';
import { logWarn } from '../logger/api.js';

const PASSWORD = 'test-password-1234567890ABC!';
const HOSTILE_ITERATIONS = 2147483647;

beforeEach(() => {
  repo.getAll.mockReset();
  repo.setAll.mockClear();
  repo.getAll.mockResolvedValue({ ...DEFAULT_SETTINGS });
  vi.mocked(logWarn).mockClear();
});

async function exportOnce(): Promise<EncryptedExportData> {
  const result = await exportEncryptedSettings(PASSWORD);
  expect(result.success).toBe(true);
  return result.encryptedData as EncryptedExportData;
}

/** Builds a file the way releases before v3 wrote it: HMAC over ciphertext:iv:salt. */
async function buildV2(): Promise<EncryptedExportData> {
  const v3 = await exportOnce();
  const hmac = await exportHmacSigner.sign(`${v3.ciphertext}:${v3.iv}:${v3.salt}`);
  return { ...v3, version: LEGACY_ENCRYPTED_EXPORT_VERSION, hmac };
}

describe('settingsExportImport encrypted HMAC', () => {
  describe('exportEncryptedSettings', () => {
    it('writes the v3 version with iterations recorded', async () => {
      const data = await exportOnce();

      expect(data.version).toBe(ENCRYPTED_EXPORT_VERSION);
      expect(ENCRYPTED_EXPORT_VERSION).not.toBe(LEGACY_ENCRYPTED_EXPORT_VERSION);
      expect(data.iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
    });

    it('signs a payload that includes iterations', async () => {
      const data = await exportOnce();

      const payload = `${data.ciphertext}:${data.iv}:${data.salt}:${data.iterations}`;
      expect(await exportHmacSigner.verify(payload, data.hmac)).toBe(true);
    });
  });

  describe('importEncryptedSettings', () => {
    it('round-trips a freshly exported v3 file', async () => {
      const data = await exportOnce();

      const result = await importEncryptedSettings(JSON.stringify(data), PASSWORD);

      expect(result).not.toBeNull();
      expect(repo.setAll).toHaveBeenCalledTimes(1);
    });

    it('rejects a v3 file whose iterations were altered', async () => {
      const data = await exportOnce();
      const tampered = { ...data, iterations: HOSTILE_ITERATIONS };

      const result = await importEncryptedSettings(JSON.stringify(tampered), PASSWORD);

      expect(result).toBeNull();
      expect(repo.setAll).not.toHaveBeenCalled();
    });

    it('rejects a v3 file with iterations removed', async () => {
      const data = await exportOnce();
      const { iterations: _dropped, ...stripped } = data;

      const result = await importEncryptedSettings(JSON.stringify(stripped), PASSWORD);

      expect(result).toBeNull();
    });

    it('rejects a v3 file downgraded to v2 to dodge the iterations signature', async () => {
      const data = await exportOnce();
      const downgraded = { ...data, version: LEGACY_ENCRYPTED_EXPORT_VERSION };

      const result = await importEncryptedSettings(JSON.stringify(downgraded), PASSWORD);

      expect(result).toBeNull();
    });

    it('still imports a v2 file signed over ciphertext:iv:salt', async () => {
      const v2 = await buildV2();

      const result = await importEncryptedSettings(JSON.stringify(v2), PASSWORD);

      expect(result).not.toBeNull();
    });

    it('imports a v2 file with hostile iterations by ignoring the value above the ceiling', async () => {
      const v2 = await buildV2();
      const tampered = { ...v2, iterations: HOSTILE_ITERATIONS };

      const result = await importEncryptedSettings(JSON.stringify(tampered), PASSWORD);

      expect(result).not.toBeNull();
    });

    it('accepts a v1 file without hmac and logs a warning', async () => {
      const salt = generateSalt();
      const key = await deriveKey(PASSWORD, salt, CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
      const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
      const json = JSON.stringify({
        version: '1.1.0',
        exportedAt: new Date().toISOString(),
        settings,
        apiKeyExcluded: true,
      });
      const enc = await encrypt(json, key);
      const v1 = {
        encrypted: true,
        version: '1',
        exportedAt: new Date().toISOString(),
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        salt: bytesToBase64(salt),
      };

      const result = await importEncryptedSettings(JSON.stringify(v1), PASSWORD);

      expect(result).not.toBeNull();
      expect(logWarn).toHaveBeenCalled();
    });
  });
});
