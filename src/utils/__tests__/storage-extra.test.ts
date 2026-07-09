import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage module dependencies
vi.mock('../logger.js', () => ({
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  logSanitize: vi.fn(() => Promise.resolve()),
  ErrorCode: {
    INTERNAL_ERROR: 'INT_001',
    API_REQUEST_FAILURE: 'API_REQ_001',
    CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
    STORAGE_QUOTA_EXCEEDED: 'STO_001',
    STORAGE_WRITE_FAILURE: 'STO_003',
  },
}));

vi.mock('../crypto.js', () => ({
  generateSalt: vi.fn(() => new Uint8Array(32).fill(1)),
  deriveKey: vi.fn(() => Promise.resolve({} as CryptoKey)),
  encryptApiKey: vi.fn((v: string) => Promise.resolve(`encrypted:${v}`)),
  decryptApiKey: vi.fn(() => Promise.resolve('decrypted-key')),
  isEncrypted: vi.fn((v: unknown) => typeof v === 'string' && v.startsWith('encrypted:')),
  hashPasswordWithPBKDF2: vi.fn(() => Promise.resolve('hash')),
  verifyPasswordWithPBKDF2: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../optimisticLock.js', () => ({
  withOptimisticLock: vi.fn(async (key: string, fn: (data: unknown) => unknown) => {
    const result = await chrome.storage.local.get(key);
    const current = result[key];
    const updated = fn(current ?? []);
    await chrome.storage.local.set({ [key]: updated });
    return updated;
  }),
}));

vi.mock('../masterPassword.js', () => ({
  calculatePasswordStrength: vi.fn(() => ({ score: 80, level: 'strong' })),
}));

vi.mock('../migration.js', () => ({
  migrateUblockSettings: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../urlUtils.js', () => ({
  normalizeUrl: vi.fn((url: string) => url),
}));

vi.mock('../errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

import {
  getStorageUsage,
  isDomainInWhitelist,
  getSavedUrls,
  getSavedUrlsWithTimestamps,
  setSavedUrls,
  addSavedUrl,
  removeSavedUrl,
  isUrlSaved,
  getSavedUrlCount,
  setSavedUrlsWithTimestamps,
  purgeLegacyStorage,
  clearSettingsCache,
  isMasterPasswordEnabled,
  isEncryptionLocked,
  clearEncryptionKeyCache,
  getOrCreateHmacSecret,
  ALLOWED_AI_PROVIDER_DOMAINS,
} from '../storage.js';

import { StorageKeys } from '../storage/types.js';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';

describe('isDomainInWhitelist', () => {
  it('returns true for exact match in whitelist', () => {
    expect(isDomainInWhitelist('https://api.openai.com/v1')).toBe(true);
  });

  it('returns true for wildcard match (subdomain of a *. domain)', () => {
    // The ALLOWED_AI_PROVIDER_DOMAINS includes 'api.ai.sakura.ad.jp'
    expect(isDomainInWhitelist('https://api.ai.sakura.ad.jp/v1')).toBe(true);
  });

  it('returns true for exact match on a wildcard domain', () => {
    // There should be a domain ending with .sakura.ad.jp
    const wildcardDomain = ALLOWED_AI_PROVIDER_DOMAINS.find(d => d.startsWith('*.'));
    if (wildcardDomain) {
      const suffix = wildcardDomain.substring(2);
      expect(isDomainInWhitelist(`https://${suffix}/test`)).toBe(true);
    }
  });

  it('returns false for domain not in whitelist', () => {
    expect(isDomainInWhitelist('https://evil-phishing.com/api')).toBe(false);
  });

  it('returns false for invalid URL', () => {
    expect(isDomainInWhitelist('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDomainInWhitelist('')).toBe(false);
  });

  it('matches against localhost', () => {
    expect(isDomainInWhitelist('http://localhost:8080')).toBe(true);
    expect(isDomainInWhitelist('http://127.0.0.1:8080')).toBe(true);
  });
});

describe('getStorageUsage', () => {
  it('returns bytes from chrome.storage', async () => {
    const usage = await getStorageUsage();
    expect(typeof usage).toBe('number');
    expect(usage).toBeGreaterThanOrEqual(0);
  });
});

describe('URL set functions', () => {
  beforeEach(async () => {
    // Reset storage via chrome mock
    const keys = Object.keys(await chrome.storage.local.get(null));
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
  });

  describe('getSavedUrls', () => {
    it('returns empty Set when no saved URLs', async () => {
      const urls = await getSavedUrls();
      expect(urls).toBeInstanceOf(Set);
      expect(urls.size).toBe(0);
    });

    it('returns saved URLs as a Set', async () => {
      await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
      const urls = await getSavedUrls();
      expect(urls.size).toBe(2);
      expect(urls.has('https://a.com')).toBe(true);
      expect(urls.has('https://b.com')).toBe(true);
    });
  });

  describe('getSavedUrlsWithTimestamps', () => {
    it('returns empty Map when no entries', async () => {
      const map = await getSavedUrlsWithTimestamps();
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(0);
    });

    it('returns URL->timestamp Map from storage', async () => {
      await chrome.storage.local.set({
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 1000 },
          { url: 'https://b.com', timestamp: 2000 },
        ],
      });
      const map = await getSavedUrlsWithTimestamps();
      expect(map.get('https://a.com')).toBe(1000);
      expect(map.get('https://b.com')).toBe(2000);
    });
  });

  describe('isUrlSaved', () => {
    it('returns false for unsaved URL', async () => {
      expect(await isUrlSaved('https://x.com')).toBe(false);
    });

    it('returns true for saved URL', async () => {
      await chrome.storage.local.set({ savedUrls: ['https://x.com'] });
      expect(await isUrlSaved('https://x.com')).toBe(true);
    });
  });

  describe('getSavedUrlCount', () => {
    it('returns 0 when no URLs saved', async () => {
      expect(await getSavedUrlCount()).toBe(0);
    });

    it('returns count of saved URLs', async () => {
      await chrome.storage.local.set({ savedUrls: ['a', 'b', 'c'] });
      expect(await getSavedUrlCount()).toBe(3);
    });
  });

  describe('clearSettingsCache', () => {
    it('is a function that does not throw', () => {
      expect(typeof clearSettingsCache).toBe('function');
      expect(() => clearSettingsCache()).not.toThrow();
    });
  });

  describe('isMasterPasswordEnabled', () => {
    it('returns false when not set', async () => {
      const enabled = await isMasterPasswordEnabled();
      expect(enabled).toBe(false);
    });

    it('returns true when set', async () => {
      await chrome.storage.local.set({ [StorageKeys.MASTER_PASSWORD_ENABLED]: true });
      const enabled = await isMasterPasswordEnabled();
      expect(enabled).toBe(true);
    });
  });

  describe('isEncryptionLocked', () => {
    it('returns false when master password not enabled', async () => {
      expect(await isEncryptionLocked()).toBe(false);
    });
  });

  describe('clearEncryptionKeyCache', () => {
    it('is a function that does not throw', () => {
      expect(typeof clearEncryptionKeyCache).toBe('function');
      expect(() => clearEncryptionKeyCache()).not.toThrow();
    });
  });

  describe('getOrCreateHmacSecret', () => {
    it('creates a new secret when none exists', async () => {
      const secret = await getOrCreateHmacSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(0);
    });

    it('returns cached secret on subsequent calls', async () => {
      const s1 = await getOrCreateHmacSecret();
      const s2 = await getOrCreateHmacSecret();
      expect(s1).toBe(s2);
    });
  });

  describe('purgeLegacyStorage', () => {
    it('cleans up savedUrlsWithTimestamps entries', async () => {
      const entries = Array.from({ length: 600 }, (_, i) => ({
        url: `https://x${i}.com`,
        timestamp: i,
        content: 'x'.repeat(100),
        aiSummary: 'y'.repeat(50),
      }));
      await chrome.storage.local.set({ savedUrlsWithTimestamps: entries, savedUrls: ['a', 'b'] });

      const freed = await purgeLegacyStorage();

      expect(typeof freed).toBe('number');
      const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
      const cleaned = stored.savedUrlsWithTimestamps as any[];
      expect(cleaned.length).toBeLessThanOrEqual(500);
      // Verify large fields were stripped
      expect(cleaned[0].content).toBeUndefined();
      expect(cleaned[0].aiSummary).toBeUndefined();
    });

    it('handles empty entries gracefully', async () => {
      const freed = await purgeLegacyStorage();
      expect(typeof freed).toBe('number');
    });

    it('handles storage error gracefully', async () => {
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('Storage error'));
      const freed = await purgeLegacyStorage();
      expect(freed).toBe(0);
    });
  });

  describe('removeSavedUrl', () => {
    it('removes URL from both savedUrls and timestamps', async () => {
      await chrome.storage.local.set({
        savedUrls: ['https://a.com', 'https://b.com'],
        savedUrlsWithTimestamps: [
          { url: 'https://a.com', timestamp: 100 },
          { url: 'https://b.com', timestamp: 200 },
        ],
      });
      await removeSavedUrl('https://a.com');
      const saved = await chrome.storage.local.get(['savedUrls', 'savedUrlsWithTimestamps']);
      expect(saved.savedUrls).not.toContain('https://a.com');
      expect(saved.savedUrlsWithTimestamps).toHaveLength(1);
    });
  });
});
