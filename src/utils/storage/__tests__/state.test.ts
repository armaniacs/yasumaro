/**
 * state.test.ts
 * Unit tests for storage mutable state module
 */

import { describe, it, expect } from 'vitest';
import {
  cachedEncryptionKey,
  cachedExtensionId,
  cachedServerKey,
  cachedMasterPassword,
  isMasterPasswordRequired,
  cachedSettings,
  cachedHmacSecret,
  SETTINGS_CACHE_TTL,
  STORAGE_QUOTA_BYTES,
  setCachedEncryptionKey,
  setCachedExtensionId,
  setCachedMasterPassword,
  setCachedSettings,
  setCachedHmacSecret,
  setIsMasterPasswordRequired,
} from '../../storage/state.js';

describe('storage/state', () => {
  // Note: These tests mutate module-level state.
  // Since vitest runs tests sequentially within a file in node environment,
  // we restore defaults after each test to prevent cross-test contamination.

  afterEach(() => {
    setCachedEncryptionKey(null);
    setCachedExtensionId(null);
    setCachedMasterPassword(null);
    setCachedSettings(null);
    setCachedHmacSecret(null);
    setIsMasterPasswordRequired(false);
  });

  describe('constants', () => {
    it('should have 1 second settings cache TTL', () => {
      expect(SETTINGS_CACHE_TTL).toBe(1000);
    });

    it('should have 5MB storage quota', () => {
      expect(STORAGE_QUOTA_BYTES).toBe(5 * 1024 * 1024);
    });
  });

  describe('setCachedEncryptionKey', () => {
    it('should set and get encryption key', async () => {
      const mockKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      setCachedEncryptionKey(mockKey);
      expect(cachedEncryptionKey).toBe(mockKey);
    });

    it('should allow null reset', () => {
      setCachedEncryptionKey(null);
      expect(cachedEncryptionKey).toBeNull();
    });
  });

  describe('setCachedExtensionId', () => {
    it('should set and get extension id', () => {
      setCachedExtensionId('test-extension-id');
      expect(cachedExtensionId).toBe('test-extension-id');
    });

    it('should allow null reset', () => {
      setCachedExtensionId(null);
      expect(cachedExtensionId).toBeNull();
    });
  });

  describe('setCachedServerKey', () => {
    // cachedServerKey has no setter exported, but we can verify initial state
    it('should be initially null', () => {
      expect(cachedServerKey).toBeNull();
    });
  });

  describe('setCachedMasterPassword', () => {
    it('should set and get master password', () => {
      setCachedMasterPassword('super-secret');
      expect(cachedMasterPassword).toBe('super-secret');
    });

    it('should allow null reset', () => {
      setCachedMasterPassword(null);
      expect(cachedMasterPassword).toBeNull();
    });
  });

  describe('setIsMasterPasswordRequired', () => {
    it('should toggle master password requirement', () => {
      expect(isMasterPasswordRequired).toBe(false);
      setIsMasterPasswordRequired(true);
      expect(isMasterPasswordRequired).toBe(true);
    });
  });

  describe('setCachedSettings', () => {
    it('should set and get cached settings', () => {
      const settings = {
        data: { obsidianUrl: 'http://localhost:27123' } as import('../../storage/types.js').Settings,
        timestamp: Date.now(),
      };
      setCachedSettings(settings);
      expect(cachedSettings).toBe(settings);
    });

    it('should allow null reset', () => {
      setCachedSettings(null);
      expect(cachedSettings).toBeNull();
    });
  });

  describe('setCachedHmacSecret', () => {
    it('should set and get HMAC secret', () => {
      setCachedHmacSecret('secret-value');
      expect(cachedHmacSecret).toBe('secret-value');
    });

    it('should allow null reset', () => {
      setCachedHmacSecret(null);
      expect(cachedHmacSecret).toBeNull();
    });
  });
});
