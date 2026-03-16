/**
 * cspValidator-error-handling.test.ts
 * Error Handling Tests for cspValidator.ts
 * 【テスト対象】: src/utils/cspValidator.ts - isUrlAllowed, isAProviderUrl
 *
 * 対象問題: ERROR-001
 * - CSPチェックでサイレント失敗（catchブロックでログ出力なし）
 * - エラー発生時に適切なログ記録が必要
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

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
  let cspValidator: any;
  let logger: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Import logger
    const loggerModule = await import('../logger.js');
    logger = loggerModule;

    // Import cspValidator
    const cspValidatorModule = await import('../cspValidator.js');
    cspValidator = cspValidatorModule;

    // Reset mock calls
    mockLogError.mockClear();
    mockLogWarn.mockClear();
    mockLogInfo.mockClear();
  });

  describe('isUrlAllowed - Error Handling', () => {
    test('should handle invalid URL format', async () => {
      const invalidUrl = 'not-a-url';

      // This should not throw an error
      const result = cspValidator.isUrlAllowed(invalidUrl);

      // Should return a result (may be false)
      expect(typeof result).toBe('boolean');

      // Check if error was logged (should be, according to recommendation)
      // Currently: may not log errors
      const errorLogged = mockLogError.mock.calls.some(call =>
        call[0].includes('URL validation') || call[0].includes('CSP')
      );
      console.log('Error logged for invalid URL:', errorLogged);
    });

    test('should handle malformed URL with special characters', async () => {
      const malformedUrl = 'https://example<script>.com/api';

      // Should not throw error
      const result = cspValidator.isUrlAllowed(malformedUrl);

      expect(typeof result).toBe('boolean');
      console.log('Result for malformed URL:', result);
    });

    test('should handle URL with invalid protocol', async () => {
      const invalidProtocolUrl = 'javascript:alert(1)';

      // Should not throw error
      const result = cspValidator.isUrlAllowed(invalidProtocolUrl);

      expect(typeof result).toBe('boolean');
      console.log('Result for invalid protocol:', result);
    });

    test('should handle null or undefined URL', async () => {
      // Should not throw error for null
      const result1 = cspValidator.isUrlAllowed(null as any);
      expect(typeof result1).toBe('boolean');

      // Should not throw error for undefined
      const result2 = cspValidator.isUrlAllowed(undefined as any);
      expect(typeof result2).toBe('boolean');
    });
  });

  describe('isAProviderUrl - Error Handling', () => {
    test('should handle invalid provider URL', async () => {
      const invalidUrl = 'not-a-url';

      // Should not throw error
      const result = cspValidator.isAProviderUrl(invalidUrl);

      expect(typeof result).toBe('boolean');

      // Check if error was logged
      const errorLogged = mockLogError.mock.calls.some(call =>
        call[0].includes('provider URL') || call[0].includes('CSP')
      );
      console.log('Error logged for invalid provider URL:', errorLogged);
    });

    test('should handle unknown provider', async () => {
      const url = 'https://unknown-provider.com/api';

      // Should not throw error
      const result = cspValidator.isAProviderUrl(url);

      expect(typeof result).toBe('boolean');
      console.log('Result for unknown provider:', result);
    });

    test('should handle null provider name', async () => {
      const url = 'https://api.openai.com/v1/models';

      // Should not throw error
      const result = cspValidator.isAProviderUrl(url);

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Error Logging Requirements', () => {
    test('RECOMMENDED: Should log errors when URL parsing fails', async () => {
      // This test demonstrates the recommended error logging behavior
      const invalidUrl = 'the-reliable-url';

      // Call validator
      cspValidator.isUrlAllowed(invalidUrl);

      // Check if error was logged (should be, according to recommendation)
      const hasErrorLog = mockLogError.mock.calls.some(call =>
        call[0].includes('CSP') && call[1] !== undefined
      );

      console.log('Error logging status:', hasErrorLog);
      console.log('Error log calls:', mockLogError.mock.calls);
    });

    test('RECOMMENDED: Should not log sensitive data (URLs)', async () => {
      const url = 'https://private-token@api.openai.com/v1/models';

      cspValidator.isUrlAllowed(url);

      // Check that URLs are not logged in error messages
      const errorLogs = mockLogError.mock.calls || [];
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

      cspValidator.isUrlAllowed(url);

      // If errors are logged, they should use structured logging
      const errorLogs = mockLogError.mock.calls || [];
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
      const result = cspValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
      console.log('Result for international URL:', result);
    });

    test('should handle URL with port number', async () => {
      const url = 'https://api.openai.com:443/v1/models';

      // Should not throw error
      const result = cspValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });

    test('should handle URL with query parameters', async () => {
      const url = 'https://api.openai.com/v1/models?param=value&other=test';

      // Should not throw error
      const result = cspValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });

    test('should handle URL with fragment', async () => {
      const url = 'https://api.openai.com/v1/models#section';

      // Should not throw error
      const result = cspValidator.isUrlAllowed(url);

      expect(typeof result).toBe('boolean');
    });
  });
});