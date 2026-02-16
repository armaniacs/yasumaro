/**
 * テスト共通型定義
 * Jest + Chrome Extension テストに必要な型を集約
 */

import type { Mock } from 'jest-mock';

// ============================================================================
// Jest Mock 拡張型
// ============================================================================

/** Jest Mock 関数の汎用型 */
export type JestMock<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

/** 非同期Jest Mock */
export type JestAsyncMock<T extends (...args: any[]) => Promise<any>> = jest.MockedFunction<T>;

// ============================================================================
// Chrome API モック型
// ============================================================================

export interface ChromeStorageMock {
  local: {
    get: jest.Mock<Promise<Record<string, any>>, [keys?: string | string[] | null]>;
    set: jest.Mock<Promise<void>, [items: Record<string, any>]>;
    remove: jest.Mock<Promise<void>, [keys: string | string[]]>;
    clear: jest.Mock<Promise<void>, []>;
  };
}

export interface ChromeRuntimeMock {
  getURL: jest.Mock<string, [path: string]>;
  sendMessage: jest.Mock<void | Promise<any>, [message: any, callback?: (response: any) => void]>;
  onMessage: {
    addListener: jest.Mock;
  };
}

export interface ChromeNotificationsMock {
  create: jest.Mock<void, [options: any]>;
  getAll: jest.Mock;
  update: jest.Mock;
  clear: jest.Mock;
}

export interface ChromeOffscreenMock {
  createDocument: jest.Mock<Promise<void>, [options: any]>;
  closeDocument: jest.Mock<Promise<void>, []>;
}

// ============================================================================
// テスト設定型
// ============================================================================

export interface TestSettings {
  obsidianUrl: string;
  obsidianApiKey: string;
  obsidianVaultName: string;
  aiProvider: 'openai' | 'gemini' | 'local';
  aiModelName?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  recordingEnabled: boolean;
  enableAutoClose: boolean;
  autoCloseDelayMs: number;
}

// ============================================================================
// テストユーティリティ型
// ============================================================================

/** テストで使用する設定のデフォルト値 */
export const DEFAULT_TEST_SETTINGS: TestSettings = {
  obsidianUrl: 'http://localhost:27123',
  obsidianApiKey: 'test-api-key-12345',
  obsidianVaultName: 'TestVault',
  aiProvider: 'openai',
  openaiApiKey: 'test-openai-key',
  recordingEnabled: true,
  enableAutoClose: true,
  autoCloseDelayMs: 500,
};

// ============================================================================
// モック作成ヘルパー型
// ============================================================================

/** jest.fn()で作成された関数の型 */
export type AsyncMockFunction<T extends any[] = any[], R = any> = jest.Mock<
  Promise<R>,
  T
>;

/** 非Promise関数のMock */
export type SyncMockFunction<T extends any[] = any[], R = any> = jest.Mock<R, T>;

// ============================================================================
// DOM テスト型
// ============================================================================

/** DOM要素のnull許容型 */
export type MaybeElement = HTMLElement | null;

/** QuerySelector 結果型 */
export type QueryResult<T extends HTMLElement = HTMLElement> = T | null;

// ============================================================================
// Jest グローバル型の拡張
// ============================================================================

declare global {
  namespace jest {
    interface Mock<T = any, P extends any[] = any[]> {
      mockResolvedValue(value: T extends (...args: any) => infer R
        ? R extends Promise<infer U>
          ? U
          : R
        : T): this;
      mockResolvedValueOnce(value: T extends (...args: any) => infer R
        ? R extends Promise<infer U>
          ? U
          : R
        : T): this;
      mockRejectedValue(value: any): this;
      mockRejectedValueOnce(value: any): this;
    }
  }
}
