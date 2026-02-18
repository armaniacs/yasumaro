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
        fileLoaded: 'Loaded "{filename}"',
        fileReadError: 'File read error',
        exportError: 'Export error',
        copyError: 'Copy error',
        deleteError: 'Delete error',
        reloadError: 'Reload error',
        textFileOnly: 'Only text files are supported',
        noTextToCopy: 'No text to copy',
        copiedToClipboard: 'Copied to clipboard',
        nothingToExport: 'Nothing to export',
        fileExported: 'File exported',
        loadEmptyUrl: 'Please enter a URL',
        loadingUrl: 'Loading...',
        importFromUrl: 'Import from URL',
        loadedFromUrl: 'Loaded filters from "{url}"',
        sourceUpdated: 'Source updated ({ruleCount} rules)',
        clipboardCopyFailed: 'Failed to copy to clipboard',
        generatedBy: '! Generated by Obsidian Smart History',
        previousMaskedItem: 'Previous masked item',
        nextMaskedItem: 'Next masked item',
        maskStatusCount: 'Masked {count} items of personal information',
        maskStatusDetails: 'Masked {details}',
        itemsCount: '{count} items',
        items: ', ',
        modeRequired: 'Please select a mode',
        saveError: 'Save error',
        privacySaved: 'Privacy settings saved',
        testingConnection: 'Testing connection...',
        successConnected: 'Success! Connected to Obsidian. Settings Saved.',
        connectionFailed: 'Connection Failed: {message}',
        acceptCertificate: 'Click here to accept self-signed certificate',
        errorProtocol: 'Error: Protocol must be "http" or "https".',
        errorPort: 'Error: Port must be a number between 1 and 65535.',
        errorDuration: 'Error: Minimum visit duration must be a non-negative number.',
        errorScrollDepth: 'Error: Minimum scroll depth must be a number between 0 and 100.',
        domainListError: 'Domain list errors:',
        noActiveTab: 'No active tab found',
        filterModeRequired: 'Please select a filter mode',
        domainFilterSaved: 'Domain filter settings saved',
        cannotRecordHttpHttps: 'Current page is not an HTTP/HTTPS page',
        failedToExtractDomain: 'Failed to extract domain',
        domainAdded: 'Added domain "{domain}"',
        domainAlreadyExists: 'Domain "{domain}" already exists in the list',
        domainList: 'Domain List (1 domain per line)',
        closeModalBtn: '×',
        cancelPreviewBtn: 'Cancel',
        sendBtn: 'Send',
        confirmContent: 'Review Content',
        confirmContentDesc: 'You can review and edit the content to be saved to Obsidian.',
        confirmContentNote: 'Note: Check masked items.',
        mainTab: 'General',
        domainTab: 'Domain Filter',
        privacyTab: 'Privacy',
        back: '←',
        apiKey: 'Obsidian API Key',
        apiKeyPlaceholder: 'Paste your key here...',
        protocol: 'Protocol (http/https)',
        port: 'Port',
        dailyNotePath: 'Daily Note Path',
        dailyNotePathPlaceholder: 'e.g. 092.Daily',
        aiProvider: 'AI Provider',
        googleGemini: 'Google Gemini',
        openaiCompatible: 'OpenAI Compatible (Groq, etc.)',
        openaiCompatible2: 'OpenAI Compatible 2 (Local, etc.)',
        geminiApiKey: 'Gemini API Key',
        geminiApiKeyPlaceholder: 'Paste your Gemini key here...',
        modelName: 'Model Name (e.g. gemini-1.5-flash)',
        baseUrl: 'Base URL',
        openaiBaseUrlPlaceholder: 'https://api.openai.com/v1',
        openaiApiKeyPlaceholder: 'sk-...',
        openaiModelPlaceholder: 'gpt-3.5-turbo',
        openai2BaseUrlPlaceholder: 'http://127.0.0.1:11434/v1',
        openai2ApiKeyPlaceholder: 'Optional for some local LLMs',
        openai2ModelPlaceholder: 'llama3',
        minVisitDuration: 'Min Visit Duration (seconds)',
        minScrollDepth: 'Min Scroll Depth (%)',
        saveAndTest: 'Save & Test Connection',
        domainFilterMode: 'Domain Filter Mode',
        filterDisabled: 'Disabled (record all)',
        filterWhitelist: 'Whitelist (record only specified domains)',
        filterBlacklist: 'Blacklist (exclude specified domains)',
        filterFormat: 'Filter Format (can be combined)',
        simpleFormat: 'Simple (1 domain per line)',
        ublockFormat: 'uBlock Origin Format',
        domainListPlaceholder: 'example.com\n*.example.org\ncompany.net',
        wildcardHelp: 'Wildcards are supported (e.g. *.example.com)',
        addCurrentDomain: 'Add Current Page Domain',
        saveDomainSettings: 'Save',
        ublockFilter: 'uBlock Filter',
        ublockFilterPlaceholder: '||example.com^\n@@||trusted.com^\n0.0.0.0 ads.example.com\n! Comment line',
        ublockHelp: 'Paste uBlock Origin or hosts format filters\nuBlock: ||hostname^, @@||hostname^, *, !Comments\nhosts: 0.0.0.0/127.0.0.1 hostname (#comments supported)',
        loadFromFile: 'Load from file (.txt)',
        selectFile: 'Select File',
        dropFileHere: 'Drop file here',
        loadFromUrl: 'Load from URL',
        urlPlaceholder: 'https://example.com/filters.txt',
        registeredFilterSources: 'Registered Filter Sources',
        noSourcesRegistered: 'No sources registered',
        loadPreview: 'Load Preview',
        ruleCount: 'Rules: {count}',
        exceptionCount: 'Exceptions: {count}',
        errorCount: 'Errors: {count}',
        export: 'Export',
        copyToClipboard: 'Copy to Clipboard',
        privacyMode: 'Privacy Mode',
        modeA: 'Mode A: Local Only',
        modeADesc: 'Summarize page content using only local AI, without sending data externally.\nCurrently not supported on most browsers.',
        modeADetail: '(Under development)',
        modeB: 'Mode B: Full Pipeline',
        modeBDesc: 'Local AI summary → PII masking → Cloud AI refinement.\nCurrently not supported on most browsers.',
        modeBCurrently: '(Under development)',
        modeC: 'Mode C: Masked Cloud',
        modeCDesc: 'Send only masked data to cloud AI.\nFor environments where local AI is not available.',
        modeCRecommended: '(Recommended)',
        modeD: 'Mode D: Cloud Only',
        modeDDesc: 'Send raw text directly to cloud AI.\nPrioritize speed.',
        confirmSettings: 'Confirmation Settings',
        confirmBeforeSending: 'Confirm masking result before sending',
        savePrivacySettings: 'Save',
        settings: 'Settings',
        piiCreditCard: 'Credit Card Number',
        piiMyNumber: 'My Number',
        piiBankAccount: 'Bank Account Number',
        piiEmail: 'E-mail',
        piiPhoneJp: 'Phone Number',
        seconds: 'seconds',
        importPreviewSummary: 'Summary:',
        importPreviewNote: 'Note: Full settings will be applied. API keys and lists are included in the file.',
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
