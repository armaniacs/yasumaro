/**
 * Jest設定ファイル
 * ES Modules対応のChrome拡張機能テスト設定
 */

module.exports = {
  // テスト環境: jsdom（ブラウザAPIを必要とするテスト用）
  testEnvironment: 'jsdom',

  // JavaScriptの変換設定
  transform: {
    '^.+\\.js$': ['babel-jest', { configFile: './babel.config.cjs' }]
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(jest|@jest)/)'
  ],

  // テストファイルのパターン
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],

  // カバレッジ収集対象
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/**/__tests__/**'
  ],

  // モジュール解決
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  // セットアップファイル
  setupFilesAfterEnv: ['./jest.setup.js'],

  // 拡張子の認識
  moduleFileExtensions: ['js', 'json'],

  // 冗長モード
  verbose: true
};
