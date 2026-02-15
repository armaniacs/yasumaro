/**
 * Jest設定ファイル
 * ES Modules対応のChrome拡張機能テスト設定
 */

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
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  // Setup files
  setupFilesAfterEnv: ['./jest.setup.js'],

  // File extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // タイムアウト設定 (15秒)
  testTimeout: 15000,

  // 冗長モード
  verbose: true
};
