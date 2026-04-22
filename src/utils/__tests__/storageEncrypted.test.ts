/**
 * storageEncrypted.test.ts
 * Unit tests for encrypted storage utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getOrCreateEncryptionKey,
  getOrCreateHmacSecret,
  clearEncryptionKeyCache,
  clearHmacSecretCache,
} from '../storageEncrypted.js';

// Mock chrome API
const mockStorage = new Map<string, unknown>();

const mockChrome = {
  runtime: {
    id: 'test-extension-id',
  },
  storage: {
    local: {
      get: vi.fn().mockImplementation(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        for (const key of keyArray) {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        }
        return result;
      }),
      set: vi.fn().mockImplementation(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          mockStorage.set(key, value);
        }
      }),
    },
  },
};

describe('storageEncrypted', () => {
  const StorageKeys = {
    ENCRYPTION_SALT: 'encryption_salt',
    ENCRYPTION_SECRET: 'encryption_secret',
    HMAC_SECRET: 'hmac_secret',
  };

  beforeEach(() => {
    mockStorage.clear();
    clearEncryptionKeyCache();
    clearHmacSecretCache();
    vi.stubGlobal('chrome', mockChrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getOrCreateEncryptionKey', () => {
    it('should generate new key when none exists', async () => {
      const key = await getOrCreateEncryptionKey(StorageKeys);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');

      // Should have stored salt and secret
      expect(mockStorage.has(StorageKeys.ENCRYPTION_SALT)).toBe(true);
      expect(mockStorage.has(StorageKeys.ENCRYPTION_SECRET)).toBe(true);
    });

    it('should return cached key on subsequent calls', async () => {
      const key1 = await getOrCreateEncryptionKey(StorageKeys);
      const key2 = await getOrCreateEncryptionKey(StorageKeys);

      expect(key1).toBe(key2);
    });

    it('should regenerate key when extension id changes', async () => {
      const key1 = await getOrCreateEncryptionKey(StorageKeys);

      // Change extension ID
      mockChrome.runtime.id = 'different-extension-id';
      clearEncryptionKeyCache();

      const key2 = await getOrCreateEncryptionKey(StorageKeys);

      expect(key1).not.toBe(key2);
      expect(key2).toBeDefined();
    });

    it('should reuse stored salt and secret if available', async () => {
      // Pre-populate storage
      mockStorage.set(StorageKeys.ENCRYPTION_SALT, btoa(String.fromCharCode(...new Uint8Array(16).fill(1))));
      mockStorage.set(StorageKeys.ENCRYPTION_SECRET, btoa(String.fromCharCode(...new Uint8Array(32).fill(2))));

      const key = await getOrCreateEncryptionKey(StorageKeys);

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });
  });

  describe('getOrCreateHmacSecret', () => {
    it('should generate new secret when none exists', async () => {
      const secret = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);

      expect(secret).toBeDefined();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);

      expect(mockStorage.has(StorageKeys.HMAC_SECRET)).toBe(true);
    });

    it('should return cached secret on subsequent calls', async () => {
      const secret1 = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);
      const secret2 = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);

      expect(secret1).toBe(secret2);
    });

    it('should reuse stored secret if available', async () => {
      const existingSecret = 'existing-hmac-secret';
      mockStorage.set(StorageKeys.HMAC_SECRET, existingSecret);

      const secret = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);

      expect(secret).toBe(existingSecret);
    });
  });

  describe('clearEncryptionKeyCache', () => {
    it('should clear encryption key cache', async () => {
      const key1 = await getOrCreateEncryptionKey(StorageKeys);
      clearEncryptionKeyCache();
      const key2 = await getOrCreateEncryptionKey(StorageKeys);

      // After clearing cache, should generate new key (but from same stored salt/secret)
      expect(key1).not.toBe(key2);
    });
  });

  describe('clearHmacSecretCache', () => {
    it('should clear HMAC secret cache', async () => {
      const secret1 = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);
      clearHmacSecretCache();
      const secret2 = await getOrCreateHmacSecret(StorageKeys.HMAC_SECRET);

      // After clearing cache, should read from storage (same value)
      expect(secret1).toBe(secret2);
    });
  });
});
