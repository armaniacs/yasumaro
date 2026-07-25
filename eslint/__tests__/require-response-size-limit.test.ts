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
    // 偽陽性テスト: 文字列リテラル内のキーワードに反応しない
    {
      name: 'should not trigger on string literal containing content-length',
      code: `
async function handler(response) {
  const key = "content-length";
  const text = await response.text();
}
      `.trim(),
    },
    // 偽陽性テスト: 無関係なメソッド呼び出し
    {
      name: 'should not trigger on response.json()',
      code: `
async function handler(response) {
  const data = await response.json();
}
      `.trim(),
    },
    // ハッピーパス: byteLength チェック
    {
      name: 'response.text() after byteLength check',
      code: `
async function handler(response) {
  const data = await response.arrayBuffer();
  if (data.byteLength > 1024 * 1024) throw new Error('too large');
  const text = await response.text();
}
      `.trim(),
    },
    // ハッピーパス: アロー関数 + Content-Length チェック
    {
      name: 'arrow function with Content-Length check',
      code: `
const handler = async (response) => {
  const cl = response.headers.get('content-length');
  if (cl > 1024 * 1024) throw new Error();
  const text = await response.text();
};
      `.trim(),
    },
    // ハッピーパス: res 変数名
    {
      name: 'res.text() after Content-Length check',
      code: `
async function handler(res) {
  const contentLength = res.headers.get('content-length');
  if (contentLength > 5 * 1024 * 1024) throw new Error('too large');
  const text = await res.text();
}
      `.trim(),
    },
    // ハッピーパス: 複数の response.text() 呼び出し（2回目以降はチェック済み）
    {
      name: 'second response.text() after Content-Length check should not trigger',
      code: `
async function handler(response) {
  const cl = response.headers.get('content-length');
  if (cl > 1024 * 1024) throw new Error('too large');
  const first = await response.text();
  const second = await response.text();
}
      `.trim(),
    },
  ],

  invalid: [
    {
      name: 'response.text() without size limit check',
      code: 'const text = await response.text();',
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // 偽陰性テスト: 深いネスト内での違反
    {
      name: 'should trigger on deeply nested function without check',
      code: `
async function outer() {
  async function inner(response) {
    const text = await response.text();
  }
}
      `.trim(),
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // 偽陰性テスト: アロー関数内での違反
    {
      name: 'should trigger on arrow function without check',
      code: `
const handler = async (response) => {
  const text = await response.text();
};
      `.trim(),
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // 偽陰性テスト: res 変数名での違反
    {
      name: 'res.text() without size limit check',
      code: 'const text = await res.text();',
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // 偽陰性テスト: 先頭の response.text() で違反（後続にチェックがあるが最初の呼び出しは未チェック）
    {
      name: 'first of multiple response.text() calls without prior check should trigger',
      code: `
async function handler(response) {
  const text1 = await response.text();
  const cl = response.headers.get('content-length');
  if (cl > 1024 * 1024) throw new Error();
  const text2 = await response.text();
}
      `.trim(),
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // 偽陰性テスト: コメント内のキーワードはチェックとして扱われない
    {
      name: 'should trigger despite comment containing content-length (no actual check)',
      code: `
async function handler(response) {
  // content-length のチェックを忘れずに
  const text = await response.text();
}
      `.trim(),
      errors: [{ messageId: 'missingSizeLimit' }],
    },
    // エッジケース: トップレベルでの違反
    {
      name: 'should trigger on top-level response.text()',
      code: 'response.text();',
      errors: [{ messageId: 'missingSizeLimit' }],
    },
  ],
});

// Export empty so vitest doesn't complain about no tests
export {};
