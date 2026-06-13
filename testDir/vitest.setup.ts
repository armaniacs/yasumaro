/**
 * Vitest Setup File (Migrated from jest.setup.ts)
 * Chrome Extensions API mock settings for jsdom environment
 */

// ============================================================================
// jsdom Unimplemented Feature Warning Suppression (MUST be before any imports)
// ============================================================================
// Suppress jsdom "Not implemented" warnings for features this project does not use.
// This must be at the top of the file to execute before jsdom emits warnings.
// jsdom routes "Not implemented" warnings through both console.warn and console.error.
const _originalConsoleWarn = console.warn;
const _originalConsoleError = console.error;

const _isJSDOMNotImplemented = (msg: string): boolean => {
  return (
    msg.includes('Not implemented: navigation to another Document') ||
    msg.includes('Not implemented: HTMLCanvasElement') ||
    msg.includes('without installing the canvas npm package')
  );
};

console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (_isJSDOMNotImplemented(msg)) return;
  _originalConsoleWarn.apply(console, args);
};

console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (_isJSDOMNotImplemented(msg)) return;
  _originalConsoleError.apply(console, args);
};

import { Crypto, CryptoKey } from '@peculiar/webcrypto';
import { vi } from 'vitest';

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

// btoa/atob polyfill for Node.js environment (used by urlNotificationHandlers)
if (typeof global.btoa === 'undefined') {
  global.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof global.atob === 'undefined') {
  global.atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
}

// Web Crypto API polyfill for Vitest testing environment
const webcrypto = new Crypto();
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// CryptoKey global for test environment
Object.defineProperty(global, 'CryptoKey', {
  value: CryptoKey,
  writable: true,
  configurable: true,
});

// CSS.escape polyfill for tests
Object.defineProperty(global, 'CSS', {
  value: {
    escape: (str: string): string => {
      // Basic implementation of CSS.escape
      return str.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    },
  },
  writable: true,
  configurable: true,
});

// ============================================================================
// Vite Environment Variables Mock
// ============================================================================

// import.meta.env mock for Vitest (used by logger.ts isDevelopment)
vi.stubGlobal('import.meta', {
  env: {
    DEV: process.env.NODE_ENV === 'development',
    PROD: process.env.NODE_ENV === 'production',
    MODE: process.env.NODE_ENV || 'test',
  },
});

// ============================================================================
// Chrome Extensions API Mock
// ============================================================================

// In-memory storage
const localStorage: Record<string, any> = {};
const syncStorage: Record<string, any> = {};

// Session storage (ephemeral)
const sessionStorage: Record<string, any> = {};

// Chrome Storage Mock
const chromeStorageMock = {
  local: {
    get: vi.fn<Promise<Record<string, any>>, [string | string[] | null | undefined]>(
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
    set: vi.fn<Promise<void>, [Record<string, any>]>((items) => {
      Object.assign(localStorage, items);
      return Promise.resolve();
    }),
    remove: vi.fn<Promise<void>, [string | string[]]>((keys) => {
      if (Array.isArray(keys)) {
        keys.forEach((key) => delete localStorage[key]);
      } else {
        delete localStorage[keys];
      }
      return Promise.resolve();
    }),
    clear: vi.fn<Promise<void>, []>(() => {
      Object.keys(localStorage).forEach((key) => delete localStorage[key]);
      return Promise.resolve();
    }),
    getBytesInUse: vi.fn<Promise<number>, []>(() => Promise.resolve(1024)),
  },
  session: {
    get: vi.fn<Promise<Record<string, any>>, [string | string[] | null | undefined]>(
      (keys?: string | string[] | null) => {
        let result: Record<string, any> = {};

        if (keys === null || keys === undefined) {
          result = { ...sessionStorage };
        } else if (Array.isArray(keys)) {
          keys.forEach((key) => {
            if (key in sessionStorage) {
              result[key] = sessionStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (keys in sessionStorage) {
            result[keys] = sessionStorage[keys];
          }
        }

        return Promise.resolve(result);
      }
    ),
    set: vi.fn<Promise<void>, [Record<string, any>]>((items) => {
      Object.assign(sessionStorage, items);
      return Promise.resolve();
    }),
    remove: vi.fn<Promise<void>, [string | string[]]>((keys) => {
      if (Array.isArray(keys)) {
        keys.forEach((key) => delete sessionStorage[key]);
      } else {
        delete sessionStorage[keys];
      }
      return Promise.resolve();
    }),
    clear: vi.fn<Promise<void>, []>(() => {
      Object.keys(sessionStorage).forEach((key) => delete sessionStorage[key]);
      return Promise.resolve();
    }),
  },
};

// Chrome Runtime Mock
const chromeRuntimeMock = {
  getURL: vi.fn<string, [string]>((path) => path),
  sendMessage: vi.fn<void | Promise<any>, any[]>((_message, callback) => {
    const lastError = (global as any).chrome.runtime?.lastError;
    if (callback && typeof callback === 'function') {
      if (lastError) {
        callback();
      } else {
        callback({ success: true });
      }
    }
  }),
  onMessage: {
    addListener: vi.fn(),
  },
};

// ============================================================================
// Chrome API Error Simulation Helpers
// ============================================================================

/**
 * Simulate a chrome.runtime.lastError for the next sendMessage call
 * Usage in tests: simulateSendMessageError('Could not establish connection');
 */
(global as any).simulateSendMessageError = (message: string) => {
  (global as any).chrome.runtime.lastError = { message };
};

/**
 * Reset chrome.runtime.lastError to null
 * Usage in tests: resetSendMessageError();
 */
(global as any).resetSendMessageError = () => {
  (global as any).chrome.runtime.lastError = null;
};

/**
 * Configure sendMessage mock to reject with a specific error (Promise-based)
 * Usage in tests: configureSendMessageReject('Extension context invalidated');
 */
(global as any).configureSendMessageReject = (message: string) => {
  (global as any).chrome.runtime.sendMessage = vi.fn(() => Promise.reject(new Error(message)));
};

/**
 * Reset sendMessage mock to default behavior
 * Usage in tests: resetSendMessageMock();
 */
(global as any).resetSendMessageMock = () => {
  (global as any).chrome.runtime.sendMessage = chromeRuntimeMock.sendMessage;
};

// Global chrome object
(global as any).chrome = {
  storage: {
    local: chromeStorageMock.local,
    session: chromeStorageMock.session,
    sync: {
      get: vi.fn<Promise<Record<string, any>>, any[]>((keys?: any) => {
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
      set: vi.fn<Promise<void>, [Record<string, any>]>((items) => {
        Object.assign(syncStorage, items);
        return Promise.resolve();
      }),
    },
  },
   runtime: {
     lastError: null as any,
     sendMessage: chromeRuntimeMock.sendMessage,
     onMessage: chromeRuntimeMock.onMessage,
     onInstalled: {
       addListener: vi.fn(),
     },
     onStartup: {
       addListener: vi.fn(),
     },
     getURL: chromeRuntimeMock.getURL,
     getBackgroundPage: vi.fn(),
     getContexts: vi.fn(),
     connect: vi.fn(),
     connectNative: vi.fn(),
   },
   tabs: {
     query: vi.fn(),
     sendMessage: vi.fn((_tabId, _message, callback) => {
       if (callback && typeof callback === 'function') {
         callback();
       }
     }),
     onRemoved: {
       addListener: vi.fn(),
     },
     onActivated: {
       addListener: vi.fn(),
     },
     onUpdated: {
       addListener: vi.fn(),
     },
   },
  notifications: {
    create: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
    getAll: vi.fn(),
    onClosed: {
      addListener: vi.fn(),
    },
    onButtonClicked: {
      addListener: vi.fn(),
    },
    onClicked: {
      addListener: vi.fn(),
    },
  },
  offscreen: {
    createDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
  },
  permissions: {
    contains: vi.fn<Promise<boolean>, any[]>(() => Promise.resolve(true)),
    request: vi.fn<Promise<boolean>, any[]>(() => Promise.resolve(true)),
    remove: vi.fn<Promise<boolean>, any[]>(() => Promise.resolve(true)),
  },
  alarms: {
    create: vi.fn((name: string, alarmInfo: any, callback?: () => void) => {
      if (callback) callback();
    }),
    clear: vi.fn((name: string, callback?: (wasCleared: boolean) => void) => {
      if (callback) callback(true);
    }),
    clearAll: vi.fn((callback?: (wasCleared: boolean) => void) => {
      if (callback) callback(true);
    }),
    get: vi.fn((name: string, callback?: (alarm: any) => void) => {
      if (callback) callback(undefined);
    }),
    getAll: vi.fn((callback?: (alarms: any[]) => void) => {
      if (callback) callback([]);
    }),
    onAlarm: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve([{ result: null }])),
    insertCSS: vi.fn(() => Promise.resolve()),
    removeCSS: vi.fn(() => Promise.resolve()),
  },
  action: {
    setBadgeText: vi.fn((details: any, callback?: () => void) => {
      if (callback) callback();
    }),
    setBadgeBackgroundColor: vi.fn((details: any, callback?: () => void) => {
      if (callback) callback();
    }),
    setTitle: vi.fn((details: any, callback?: () => void) => {
      if (callback) callback();
    }),
    setIcon: vi.fn((details: any, callback?: () => void) => {
      if (callback) callback();
    }),
  },
  i18n: {
    getMessage: vi.fn((key: string, substitutions?: Record<string, string>) => {
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
        generatedBy: '! Generated by Obsidian Weave',
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
        // Error message keys
        errorNetwork: 'ネットワークエラーが発生しました。接続を確認してください。',
        errorAuth: '認証エラーが発生しました。APIキーを確認してください。',
        errorValidation: '入力内容を確認してください。',
        errorNotFound: 'リソースが見つかりません。',
        errorRateLimit: 'リクエスト制限を超えました。しばらく待ってから再試行してください。',
        errorServer: 'サーバーエラーが発生しました。',
        errorGeneric: 'エラーが発生しました。',
        errorUrlNotAllowed: 'このURLは記録できません。',
        errorDomainBlocked: 'このドメインはブロックされています。',
        errorInvalidUrlGeneric: '無効なURLです。',
        errorObsidianConnection: 'Obsidianとの接続に失敗しました。',
        errorDailyNoteSave: 'デイリーノートの保存に失敗しました。',
        errorAiSummarize: 'AI要約に失敗しました。',
        errorContentEmpty: 'コンテンツが空です。',
        importPreviewNote: 'Note: Full settings will be applied. API keys and lists are included in the file.',
        importNoSignatureWarning: '⚠️ This settings file contains no signature.\n\nSignatures are used to prevent settings file tampering.\n\nIt is recommended not to import files from untrusted sources.\n\nDo you want to continue importing?',
        importNoSignature: 'Settings file does not contain a signature. Only signed files can be imported.',
        hmacVerificationFailedConfirm: 'Settings file signature verification failed.\n\nReason: HMAC secret may have changed (extension update/reload, etc.).\n\nIf this is a trusted settings file, click "OK" to force import.\nIf not, click "Cancel".',
        cleansingStatsNoData: '削減率データがありません。クレンジングを有効にして数件記録すると統計が表示されます。',
        cleansingStatsAvgRate: '平均削減率',
        cleansingStatsTotalSaved: '累計削減量',
        cleansingStatsCount: '集計対象',
        cleansingStatsCountSuffix: '件',
        cleansingFunnelDom: 'DOM全体',
        cleansingFunnelCandidate: '候補絞込',
        cleansingFunnelAi: 'AI要約\nクレンジング',
        cleansingFunnelFooter: '平均',
        cleansingReduction: '削減',
        fallbackStorageWarning: '簡易ストレージモードで動作中です。お使いの環境ではOPFSが利用できないため、chrome.storage.localを使用しています。検索機能が制限されます。',
        historyToggleStar: 'スターの切り替え',
        historyDeleteRecord: '削除',
        historyDeleteRecordAria: 'この記録を削除',
        historyDateYear: '年',
        historyDateMonth: '月',
        historyDateDay: '日',
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
    getUILanguage: vi.fn(() => 'en'),
  },
};

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Reset Chrome API state
  if ((global as any).chrome && (global as any).chrome.runtime) {
    (global as any).chrome.runtime.lastError = null;
    // Reset sendMessage mock to default
    (global as any).chrome.runtime.sendMessage = chromeRuntimeMock.sendMessage;
  }
  // Clear storage
  Object.keys(localStorage).forEach((key) => delete localStorage[key]);
  Object.keys(syncStorage).forEach((key) => delete syncStorage[key]);
  Object.keys(sessionStorage).forEach((key) => delete sessionStorage[key]);
});

afterEach(() => {
  // Reset DOM - guard against tests that set global.document = undefined
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});

// ============================================================================
// HTMLCanvasElement getContext Mock
// ============================================================================

// Provide a minimal mock for canvas.getContext() so tests that create <canvas>
// elements do not trigger jsdom warnings. This is sufficient for tests that
// only verify the function does not throw (e.g. renderFunnelChart).
const _mockCanvasRenderingContext2D = {
  fillRect: () => {},
  fillText: () => {},
  strokeText: () => {},
  measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  arc: () => {},
  fill: () => {},
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  setTransform: () => {},
  createLinearGradient: () => ({ addColorStop: () => {} }),
  roundRect: () => {},
  rect: () => {},
  closePath: () => {},
  clip: () => {},
  scale: () => {},
  rotate: () => {},
  translate: () => {},
  transform: () => {},
  setLineDash: () => {},
  getLineDash: () => [],
  lineWidth: 1,
  strokeStyle: '',
  fillStyle: '',
  font: '',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
} as unknown as CanvasRenderingContext2D;

// Only mock canvas in jsdom environment (HTMLCanvasElement is undefined in node)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function(_contextId: string): CanvasRenderingContext2D | null {
    return _mockCanvasRenderingContext2D;
  };
}

// ============================================================================
// matchMedia Mock (required for canvas/chart rendering tests)
// ============================================================================

// Only mock matchMedia in jsdom environment
if (typeof global.matchMedia === 'undefined') {
  global.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Global alert and confirm mocks
global.alert = vi.fn(() => {});
global.confirm = vi.fn(() => false); // Default to cancel
