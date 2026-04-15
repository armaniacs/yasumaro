/**
 * Jest設定ファイル
 * ES Modules対応のChrome拡張機能テスト設定
 */

const path = require('path');

/**
 * カスタムモジュールリゾルバー
 * .js 拡張子のインポートを .ts ファイルに解決する
 */
function customResolver(modulePath, options) {
  // 元のリゾルバーを呼び出す
  const resolved = options.defaultResolver(modulePath, options);
  
  // 解決済みの場合、有効性をチェック
  if (resolved) {
    return resolved;
  }
  
  return resolved;
}

module.exports = {
  // テスト環境: jsdom（ブラウザAPIを必要とするテスト用）
  testEnvironment: 'jsdom',

  // 並列実行設定
  // workerThreads は Node 24 + Jest 30 の組み合わせで module resolution に問題が発生するため無効化
  maxWorkers: '50%',

  // JavaScript/TypeScript transformation
  // babel-jest から ts-jest に切り替え（Node 24 + Jest 30 の互換性のため）
  // module: commonjs を明示して CJS 出力に強制
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        target: 'ESNext',
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        types: ['chrome', 'jest', 'node'],
      },
      diagnostics: false,
    }],
    // bloomfilter.mjs も ts-jest で処理（babel-jest 廃止）
    '^.+\\.mjs$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ESNext',
        allowJs: true,
        skipLibCheck: true,
      },
      diagnostics: false,
    }],
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(bloomfilter)/)'
  ],

  // Test file patterns (exclude e2e and docs.spec.ts which is a standalone script)
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/!(docs).*spec.[jt]s?(x)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
    '/.kilo/',
    'video-'
  ],

  // Coverage collection
  collectCoverageFrom: [
    'src/**/*.{js,ts,jsx,tsx}',
    '!src/**/*.test.{js,ts,jsx,tsx}',
    '!src/**/*.spec.{js,ts,jsx,tsx}',
    '!src/**/__tests__/**'
  ],

  // Module name mapping
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '@/(.*)$': '<rootDir>/src/$1'
  },

  // カスタムリゾルバー - .js -> .ts の解決
  resolver: path.resolve(__dirname, 'jest.resolver.cjs'),

  // Setup files (TypeScript)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // File extensions - Jestが解決すべき拡張子のリスト（順序が重要）
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'jsx', 'json', 'node'],

  // タイムアウト設定 (15秒)
  testTimeout: 15000,

  // 冗長モード
  verbose: true
};
