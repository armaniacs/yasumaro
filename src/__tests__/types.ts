/**
 * テスト共通型定義
 * Vitest + Chrome Extension テストに必要な型を集約
 */

import type { Mock, MockedFunction } from 'vitest';

// ============================================================================
// Vitest Mock 拡張型
// ============================================================================

/** Vitest Mock 関数の汎用型 */
export type JestMock<T extends (...args: any[]) => any> = MockedFunction<T>;

/** 非同期Vitest Mock */
export type JestAsyncMock<T extends (...args: any[]) => Promise<any>> = MockedFunction<T>;

// ============================================================================
// Chrome API モック型
// ============================================================================

export interface ChromeStorageMock {
  local: {
    get: Mock<Promise<Record<string, any>>, [keys?: string | string[] | null]>;
    set: Mock<Promise<void>, [items: Record<string, any>]>;
    remove: Mock<Promise<void>, [keys: string | string[]]>;
    clear: Mock<Promise<void>, []>;
    getBytesInUse: Mock<Promise<number>, []>;
  };
}

export interface ChromeRuntimeMock {
  getURL: Mock<string, [path: string]>;
  sendMessage: Mock<void | Promise<any>, [message: any, callback?: (response: any) => void]>;
  onMessage: {
    addListener: Mock;
  };
}

export interface ChromeNotificationsMock {
  create: Mock<void, [options: any]>;
  getAll: Mock;
  update: Mock;
  clear: Mock;
}

export interface ChromeOffscreenMock {
  createDocument: Mock<Promise<void>, [options: any]>;
  closeDocument: Mock<Promise<void>, []>;
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

/** vi.fn()で作成された関数の型 */
export type AsyncMockFunction<T extends any[] = any[], R = any> = Mock<
  Promise<R>,
  T
>;

/** 非Promise関数のMock */
export type SyncMockFunction<T extends any[] = any[], R = any> = Mock<R, T>;

// ============================================================================
// DOM テスト型
// ============================================================================

/** DOM要素のnull許容型 */
export type MaybeElement = HTMLElement | null;

/** QuerySelector 結果型 */
export type QueryResult<T extends HTMLElement = HTMLElement> = T | null;

// ============================================================================
// Vitest グローバル型の拡張
// ============================================================================

// Vitest provides mockResolvedValue and mockRejectedValue on Mock instances by default
// No need to extend namespace like in Jest

// Chrome API error simulation helpers (defined in vitest.setup.ts)
var simulateSendMessageError: (message: string) => void;
var resetSendMessageError: () => void;
var configureSendMessageReject: (message: string) => void;
var resetSendMessageMock: () => void;
