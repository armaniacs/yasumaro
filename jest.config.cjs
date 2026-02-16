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

  // JavaScript/TypeScript transformation
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: './babel.config.cjs' }]
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(jest|@jest)/)'
  ],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
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
  setupFilesAfterEnv: ['./jest.setup.ts'],

  // File extensions - Jestが解決すべき拡張子のリスト（順序が重要）
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // タイムアウト設定 (15秒)
  testTimeout: 15000,

  // 冗長モード
  verbose: true
};
