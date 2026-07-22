/**
 * RuleTester tests for require-response-size-limit
 *
 * Uses ESLint's RuleTester with flat config API (ESLint 9+).
 */
import { RuleTester } from 'eslint';
import requireResponseSizeLimit from '../rules/require-response-size-limit.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('require-response-size-limit', requireResponseSizeLimit, {
  valid: [
    {
      name: 'response.text() after Content-Length check',
      code: `
async function handler(response) {
  const contentLength = response.headers.get('content-length');
  if (contentLength > 5 * 1024 * 1024) throw new Error('too large');
  const text = await response.text();
}
      `.trim(),
    },
    {
      name: 'response.text() after size limit check with maxSize',
      code: `
async function handler(response) {
  const maxSize = 1024 * 1024;
  if (response.headers.get('content-length') > maxSize) return;
  const text = await response.text();
}
      `.trim(),
    },
    {
      name: 'test file is excluded',
      code: 'const text = await response.text();',
      filename: '/path/to/__tests__/some.test.ts',
    },
    {
      name: 'mock file is excluded',
      code: 'const text = await response.text();',
      filename: '/path/to/__mocks__/some.ts',
    },
  ],

  invalid: [
    {
      name: 'response.text() without size limit check',
      code: 'const text = await response.text();',
      errors: [{ messageId: 'missingSizeLimit' }],
    },
  ],
});

// Export empty so vitest doesn't complain about no tests
export {};
