/**
 * Jestセットアップファイル（TypeScript版）
 * Chrome Extensions APIのモック設定
 * jsdom環境を利用したテスト設定
 */

import type { ChromeStorageMock, ChromeRuntimeMock } from './src/__tests__/types.js';
import { Crypto, CryptoKey } from '@peculiar/webcrypto';

// ============================================================================
// Polyfills
// ============================================================================

// TextEncoder/TextDecoder polyfill (Node.js < 20 compatibility)
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(str: string): Uint8Array {
      return Buffer.from(str, 'utf-8') as any;
    }
  } as any;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    decode(buffer: ArrayBuffer | Uint8Array): string {
      return Buffer.from(buffer).toString('utf-8');
    }
  } as any;
}

// Web Crypto API polyfill for Jest testing environment
const webcrypto = new Crypto();
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// CryptoKey グローバルを追加（テスト環境用）
Object.defineProperty(global, 'CryptoKey', {
  value: CryptoKey,
  writable: true,
  configurable: true,
});

// ============================================================================
// Chrome Extensions API Mock
// ============================================================================

// インメモリストレージ
const localStorage: Record<string, any> = {};
const syncStorage: Record<string, any> = {};

// Chrome Storage Mock
const chromeStorageMock: ChromeStorageMock = {
  local: {
    get: jest.fn<Promise<Record<string, any>>, [string | string[] | null | undefined]>(
      (keys?: string | string[] | null) => {
        let result: Record<string, any> = {};

        if (keys === null || keys === undefined) {
          result = { ...localStorage };
        } else if (Array.isArray(keys)) {
          keys.forEach((key) => {
            if (key in localStorage) {
              result[key] = localStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (keys in localStorage) {
            result[keys] = localStorage[keys];
          }
        }

        return Promise.resolve(result);
      }
    ),
    set: jest.fn<Promise<void>, [Record<string, any>]>((items) => {
      Object.assign(localStorage, items);
      return Promise.resolve();
    }),
    remove: jest.fn<Promise<void>, [string | string[]]>((keys) => {
      if (Array.isArray(keys)) {
        keys.forEach((key) => delete localStorage[key]);
      } else {
        delete localStorage[keys];
      }
      return Promise.resolve();
    }),
    clear: jest.fn<Promise<void>, []>(() => {
      Object.keys(localStorage).forEach((key) => delete localStorage[key]);
      return Promise.resolve();
    }),
  },
};

// Chrome Runtime Mock
const chromeRuntimeMock: ChromeRuntimeMock = {
  getURL: jest.fn<string, [string]>((path) => path),
  sendMessage: jest.fn<void | Promise<any>, any[]>((_message, callback) => {
    if (callback && typeof callback === 'function') {
      callback();
    }
  }),
  onMessage: {
    addListener: jest.fn(),
  },
};

// Global chrome object
(global as any).chrome = {
  storage: {
    local: chromeStorageMock.local,
    sync: {
      get: jest.fn<Promise<Record<string, any>>, any[]>((keys?: any) => {
        let result: Record<string, any> = {};
        if (keys === null || keys === undefined) {
          result = { ...syncStorage };
        } else if (Array.isArray(keys)) {
          keys.forEach((key) => {
            if (key in syncStorage) {
              result[key] = syncStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (keys in syncStorage) {
            result[keys] = syncStorage[keys];
          }
        }
        return Promise.resolve(result);
      }),
      set: jest.fn<Promise<void>, [Record<string, any>]>((items) => {
        Object.assign(syncStorage, items);
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    lastError: null as any,
    sendMessage: chromeRuntimeMock.sendMessage,
    onMessage: chromeRuntimeMock.onMessage,
    getURL: chromeRuntimeMock.getURL,
    getBackgroundPage: jest.fn(),
    getContexts: jest.fn(),
    connect: jest.fn(),
    connectNative: jest.fn(),
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn((_tabId, _message, callback) => {
      if (callback && typeof callback === 'function') {
        callback();
      }
    }),
    onUpdated: {
      addListener: jest.fn(),
    },
  },
  notifications: {
    create: jest.fn(),
    update: jest.fn(),
    clear: jest.fn(),
    getAll: jest.fn(),
    onClosed: {
      addListener: jest.fn(),
    },
  },
  offscreen: {
    createDocument: jest.fn(() => Promise.resolve()),
    closeDocument: jest.fn(() => Promise.resolve()),
  },
  i18n: {
    getMessage: jest.fn((key: string, substitutions?: Record<string, string>) => {
      const messages: Record<string, string> = {
        loading: 'Loading...',
        processing: 'Processing...',
        appTitle: 'Smart History',
        recordNow: '📝 Record Now',
        cannotRecordPage: 'Cannot record this page',
        noTitle: 'No title',
        save: 'Save',
        cancel: 'Cancel',
        connectionError: 'Please refresh the page and try again',
        domainBlockedError: 'This domain is not allowed to be recorded. Do you want to record it anyway?',
        success: '✓ Saved to Obsidian',
        cancelled: 'Cancelled',
        unknownError: 'Unknown error occurred',
        errorPrefix: '✗ Error:',
        fetchingContent: 'Fetching content...',
        localAiProcessing: 'Local AI processing...',
        saving: 'Saving...',
        recording: 'Recording...',
        forceRecord: 'Force Record',
        errorColon: 'Error:',
        manualInput: 'Manual Input',
        rulesLabel: 'Rules',
        reload: 'Reload',
        delete: 'Delete',
      };

      let message = messages[key] || key;

      if (substitutions && typeof substitutions === 'object') {
        Object.keys(substitutions).forEach((placeholder) => {
          const value = substitutions[placeholder];
          message = message.replace(`{${placeholder}}`, value);
        });
      }

      return message;
    }),
    getUILanguage: jest.fn(() => 'en'),
  },
};

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  // Chrome APIの状態をリセット
  if ((global as any).chrome && (global as any).chrome.runtime) {
    (global as any).chrome.runtime.lastError = null;
  }
  // ストレージのクリア
  Object.keys(localStorage).forEach((key) => delete localStorage[key]);
  Object.keys(syncStorage).forEach((key) => delete syncStorage[key]);
});

afterEach(() => {
  // DOMのリセット
  document.body.innerHTML = '';
});
