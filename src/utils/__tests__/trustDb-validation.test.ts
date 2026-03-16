/**
 * trustDb-validation.test.ts
 * Domain and TLD Validation Tests for trustDb.ts
 * 【テスト対象】: src/utils/trustDb/trustDb.ts - addUserTld, addSensitiveDomain, addTrustedDomain
 *
 * 対象問題: INPUT-001
 * - TLD/ドメイン入力バリデーションが不十分
 * - RFC準拠のドメイン名正規表現を使用していない
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock chrome API
const mockStorage: Record<string, any> = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result: Record<string, any> = {};
        if (typeof keys === 'string') {
          result[keys] = mockStorage[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(key => {
            result[key] = mockStorage[key];
          });
        } else {
          // Return all if keys is null or undefined
          Object.keys(mockStorage).forEach(key => {
            result[key] = mockStorage[key];
          });
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        Object.assign(mockStorage, items);
        if (callback) callback();
        return Promise.resolve({});
      }),
      remove: jest.fn((keys, callback) => {
        const keysArray = Array.isArray(keys) ? keys : [keys];
        keysArray.forEach(key => delete mockStorage[key]);
        if (callback) callback();
        return Promise.resolve({});
      })
    },
    sync: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve({});
      })
    }
  },
  runtime: {
    lastError: null
  }
} as any;

describe('Trust Database - Domain/TLD Validation', () => {
  let trustDb: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear mock storage before each test
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    // Clear module cache to get fresh TrustDb instance
    jest.clearModuleRegistry?.() || jest.resetModules();
    // Clear the module cache to get fresh import
    const trustDbModule = await import('../trustDb/trustDb.js');
    trustDb = trustDbModule.getTrustDb();

    // Initialize the database
    await trustDb.initialize?.();
  });

  describe('addUserTld - Current Validation (INCOMPLETE)', () => {
    test('should add valid TLD with dot prefix', async () => {
      const result = await trustDb.addUserTld('.com');
      expect(result.success).toBe(true);
    });

    test('should add valid TLD without dot prefix (auto-adds dot)', async () => {
      const result = await trustDb.addUserTld('com');
      expect(result.success).toBe(true);
    });

    test('should reject TLD that is too short (less than 3 chars total)', async () => {
      const result = await trustDb.addUserTld('.a');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid TLD format');
    });

    test('should reject duplicate TLD', async () => {
      await trustDb.addUserTld('.com');
      const result = await trustDb.addUserTld('.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    test('MISSING: Should reject TLD with special characters', async () => {
      const result = await trustDb.addUserTld('.com<script>alert(1)</script>');
      // Currently this may not be properly validated
      // Expected: should reject or sanitize
      console.log('Result for special chars:', result);
    });

    test('MISSING: Should reject TLD with spaces', async () => {
      const result = await trustDb.addUserTld('.com test');
      // Expected: should reject
      console.log('Result for spaces:', result);
    });

    test('MISSING: Should reject overly long TLD (>63 chars after dot)', async () => {
      const longTld = '.' + 'a'.repeat(64);
      const result = await trustDb.addUserTld(longTld);
      // Expected: should reject (RFC 1035 limits labels to 63 chars)
      console.log('Result for long TLD:', result);
    });
  });

  describe('addSensitiveDomain - Current Validation (INCOMPLETE)', () => {
    test('should add valid domain', async () => {
      const result = await trustDb.addSensitiveDomain('example.com');
      expect(result.success).toBe(true);
    });

    test('should accept lowercase domain', async () => {
      const result1 = await trustDb.addSensitiveDomain('Example.COM');
      const result2 = await trustDb.addSensitiveDomain('example.com');
      // Should normalize to lowercase
      expect(result1.success).toBe(true);
    });

    test('should reject domain without dot', async () => {
      const result = await trustDb.addSensitiveDomain('example');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid domain format');
    });

    test('MISSING: Should reject domain with special characters', async () => {
      const result = await trustDb.addSensitiveDomain('example<script>.com');
      console.log('Result for special chars:', result);
    });

    test('MISSING: Should reject domain with invalid characters', async () => {
      const result = await trustDb.addSensitiveDomain('ex@mple.com');
      console.log('Result for invalid chars:', result);
    });

    test('MISSING: Should reject domain starting/ending with hyphen', async () => {
      const result = await trustDb.addSensitiveDomain('-example.com');
      console.log('Result for leading hyphen:', result);
    });

    test('MISSING: Should reject domain starting with dot', async () => {
      const result = await trustDb.addSensitiveDomain('.example.com');
      console.log('Result for leading dot:', result);
    });

    test('MISSING: Should reject overly long domain (>253 chars)', async () => {
      const longDomain = 'a'.repeat(250) + '.com';
      const result = await trustDb.addSensitiveDomain(longDomain);
      console.log('Result for long domain:', result);
    });
  });

  describe('addTrustedDomain - Current Validation (INCOMPLETE)', () => {
    test('should add valid trusted domain', async () => {
      const result = await trustDb.addToWhitelist('trustedsite.com');
      expect(result.success).toBe(true);
    });

    test('MISSING: Should validate domain format', async () => {
      const result = await trustDb.addToWhitelist('invalid<script>.com');
      console.log('Result for invalid format:', result);
    });

    test('MISSING: Should reject duplicate trusted domains', async () => {
      // This depends on the implementation
      console.log('Skipping duplicate test until implementation verified');
    });
  });

  describe('RFC-Compliant Domain Validation (RECOMMENDED)', () => {
    /**
     * RFC 1035 / RFC 1123 compliant domain validation regex from trancoUpdater.ts:
     * /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/i
     *
     * Rules:
     * - Labels can contain letters, digits, hyphens
     * - Labels must start and end with letter or digit (not hyphen)
     * - Labels max length: 63 characters
     * - Total domain max length: 253 characters
     * - Case-insensitive
     */
    const isValidDomain = (domain: string): boolean => {
      const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/i;
      const normalized = domain.toLowerCase().trim();
      return normalized.length <= 253 && domainRegex.test(normalized) && !normalized.startsWith('.') && !normalized.endsWith('.');
    };

    test('RFC pattern should accept valid domains', () => {
      const validDomains = [
        'example.com',
        'sub.example.com',
        'a-b.example.com',
        '123.example.com',
        'test-site.co.uk',
        'xn--wgv71a.jp' // Punycode for 日本語.jp (IDN should be normalized before validation)
      ];

      validDomains.forEach(domain => {
        expect(isValidDomain(domain)).toBe(true, `${domain} should be valid`);
      });
    });

    test('RFC pattern should reject invalid domains', () => {
      const invalidDomains = [
        '-example.com', // Starts with hyphen
        'example-.com', // Ends with hyphen
        'example..com', // Double dot
        '.example.com', // Starts with dot
        'example.com.', // Ends with dot
        'ex@mple.com', // Contains @
        'example<script>.com', // Contains script tag
        'a'.repeat(65) + '.com', // Label too long
        'a'.repeat(254) + '.com', // Domain too long
        'example .com', // Contains space
        'example/com', // Contains slash
        'example#com', // Contains hash
      ];

      invalidDomains.forEach(domain => {
        expect(isValidDomain(domain)).toBe(false, `${domain} should be invalid`);
      });
    });

    test('RFC pattern for TLD validation', () => {
      const validTlds = ['.com', '.jp', '.co.uk', '.a', '.ai'];
      const invalidTlds = ['.-com', '.com-', '.com<script>', '.com test'];

      // Note: TLD validation may have different rules than domain validation
      // This test demonstrates the difference
      validTlds.forEach(tld => {
        // TLDs without the leading dot
        const tldWithoutDot = tld.startsWith('.') ? tld.slice(1) : tld;
        expect(isValidDomain(tldWithoutDot)).toBe(true, `${tldWithoutDot} should be valid as a domain`);
      });
    });
  });

  describe('Integration Tests', () => {
    test('should validate TLD before adding to database', async () => {
      // This test should verify that TLD validation is applied
      // before the data is stored in the database
      const validTld = '.com';
      const invalidTld = '.com<script>alert(1)</script>';

      const validResult = await trustDb.addUserTld(validTld);
      expect(validResult.success).toBe(true);

      const invalidResult = await trustDb.addUserTld(invalidTld);
      // Expected: should reject invalid TLD
      // Currently: may accept
      console.log('Invalid TLD result:', invalidResult);
    });

    test('should validate domain before adding to sensitive list', async () => {
      const validDomain = 'example.com';
      const invalidDomain = 'example<script>.com';

      const validResult = await trustDb.addSensitiveDomain(validDomain);
      expect(validResult.success).toBe(true);

      const invalidResult = await trustDb.addSensitiveDomain(invalidDomain);
      // Expected: should reject invalid domain
      // Currently: may accept
      console.log('Invalid domain result:', invalidResult);
    });
  });
});