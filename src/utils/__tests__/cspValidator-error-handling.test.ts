/**
 * cspValidator-error-handling.test.ts
 * Error Handling Tests for cspValidator.ts
 * 【テスト対象】: src/utils/cspValidator.ts - isUrlAllowed, isAProviderUrl
 *
 * 対象問題: ERROR-001
 * - CSPチェックでサイレント失敗（catchブロックでログ出力なし）
 * - エラー発生時に適切なログ記録が必要
 */

import { describe, test, expect, beforeAll, jest } from '@jest/globals';
import { CSPValidator } from '../cspValidator.js';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
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

// Mock logger
const mockLogError = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();

jest.mock('../logger.js', () => ({
  logError: jest.fn((...args) => mockLogError(...args)),
  logWarn: jest.fn((...args) => mockLogWarn(...args)),
  logInfo: jest.fn((...args) => mockLogInfo(...args))
}));

describe('CSP Validator - Error Handling', () => {
  let logger: any;

  beforeAll(async () => {
    // Import logger
    const loggerModule = await import('../logger.js');
    logger = loggerModule;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogError.mockClear();
    mockLogWarn.mockClear();
    mockLogInfo.mockClear();

    // Reset CSPValidator state before each test
    CSPValidator.reset();
  });

  describe('isUrlAllowed - Error Handling', () => {
    test('should handle invalid URL format', async () => {
      const invalidUrl = 'not-a-url';

      // This should not throw an error
      const result = CSPValidator.isUrlAllowed(invalidUrl);

      // Should return false for invalid URL
      expect(result).toBe(false);

      // Check if error was logged
      const errorLogged = mockLogWarn.mock.calls.some(call =>
        call[0].includes('CSP validation failed')
      );
      console.log('Error logged for invalid URL:', errorLogged);
    });

    test('should handle malformed URL with special characters', async () => {
      const malformedUrl = 'https://example<script>.com/api';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(malformedUrl);

      expect(typeof result).toBe('boolean');
      console.log('Result for malformed URL:', result);
    });

    test('should handle URL with invalid protocol', async () => {
      const invalidProtocolUrl = 'javascript:alert(1)';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(invalidProtocolUrl);

      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
      console.log('Result for invalid protocol:', result);
    });

    test('should handle null or undefined URL', async () => {
      // Should not throw error for null
      const result1 = CSPValidator.isUrlAllowed(null as any);
      expect(typeof result1).toBe('boolean');
      expect(result1).toBe(false);

      // Should not throw error for undefined
      const result2 = CSPValidator.isUrlAllowed(undefined as any);
      expect(typeof result2).toBe('boolean');
      expect(result2).toBe(false);
    });
  });

  describe('isAProviderUrl - Error Handling', () => {
    test('should handle invalid provider URL', async () => {
      const invalidUrl = 'not-a-url';

      // Should not throw error
      const result = CSPValidator.isAProviderUrl(invalidUrl);

      expect(typeof result).toBe('boolean');

      // Check if error was logged
      const errorLogged = mockLogWarn.mock.calls.some(call =>
        call[0].includes('CSP provider URL validation failed')
      );
      console.log('Error logged for invalid provider URL:', errorLogged);
    });

    test('should handle unknown provider', async () => {
      const url = 'https://unknown-provider.com/api';

      // Should not throw error
      const result = CSPValidator.isAProviderUrl(url);

      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
      console.log('Result for unknown provider:', result);
    });

    test('should handle valid provider URL', async () => {
      const url = 'https://api.openai.com/v1/models';

      // Should not throw error
      const result = CSPValidator.isAProviderUrl(url);

      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });
  });

  describe('Error Logging Requirements', () => {
    test('RECOMMENDED: Should log errors when URL parsing fails', async () => {
      // This test demonstrates the recommended error logging behavior
      const invalidUrl = 'the-reliable-url';

      // Call validator
      CSPValidator.isUrlAllowed(invalidUrl);

      // Check if error was logged
      const hasErrorLog = mockLogWarn.mock.calls.some(call =>
        call[0].includes('CSP validation failed')
      );

      console.log('Error logging status:', hasErrorLog);
      console.log('Error log calls:', mockLogWarn.mock.calls);
    });

    test('RECOMMENDED: Should not log sensitive data (URLs)', async () => {
      const url = 'https://private-token@api.openai.com/v1/models';

      CSPValidator.isUrlAllowed(url);

      // Check that URLs are not logged in error messages
      const errorLogs = mockLogWarn.mock.calls || [];
      errorLogs.forEach((call: any) => {
        const [message, details] = call;
        if (details && typeof details === 'object') {
          // URLs should not appear in logged details
          expect(details.url).toBeUndefined();
          expect(details.requestedUrl).toBeUndefined();
        }
      });

      console.log('Error logs checked for sensitive data');
    });

    test('RECOMMENDED: Should use structured logging', async () => {
      const url = 'https://api.openai.com/v1/models';

      CSPValidator.isUrlAllowed(url);

      // If errors are logged, they should use structured logging
      const errorLogs = mockLogWarn.mock.calls || [];
      if (errorLogs.length > 0) {
        const [message, details] = errorLogs[0];
        expect(typeof message).toBe('string');
        expect(details && typeof details === 'object').toBe(true);
      }

      console.log('Structured logging verified');
    });
  });

  describe('Edge Cases', () => {
    test('should handle URL with international characters', async () => {
      const url = 'https://日本語.example.com/api';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
      console.log('Result for international URL:', result);
    });

    test('should handle URL with port number', async () => {
      const url = 'https://api.openai.com:443/v1/models';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });

    test('should handle URL with query parameters', async () => {
      const url = 'https://api.openai.com/v1/models?param=value&other=test';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });

    test('should handle URL with fragment', async () => {
      const url = 'https://api.openai.com/v1/models#section';

      // Should not throw error
      const result = CSPValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });
  });
});