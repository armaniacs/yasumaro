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
import enMessages from '../public/_locales/en/messages.json' with { type: 'json' };

// ============================================================================
// chrome.i18n.getMessage mock backed by the real en messages.json
// ============================================================================
// This project's `getMessage` wrapper (src/utils/i18n.ts) fetches the raw
// message via `chrome.i18n.getMessage(key)` (no substitutions) and performs
// its own `{name}` replacement, so the mock must return the message
// unexpanded in that case. Chrome's native positional `$NAME$` placeholders
// only apply when an array of substitutions is passed directly to
// `chrome.i18n.getMessage`.
type MessagesJson = Record<
  string,
  { message: string; placeholders?: Record<string, { content: string }> }
>;

function buildGetMessageMock(messages: MessagesJson) {
  return vi.fn((key: string, substitutions?: string | Array<string | number>): string => {
    const entry = messages[key];
    if (!entry) return key;

    let message = entry.message;
    if (substitutions !== undefined && entry.placeholders) {
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
      for (const [name, { content }] of Object.entries(entry.placeholders)) {
        const positionalMatch = /^\$(\d+)$/.exec(content);
        if (!positionalMatch) continue;
        const index = Number(positionalMatch[1]) - 1;
        const value = subs[index] !== undefined ? String(subs[index]) : '';
        message = message.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, 'g'), value);
      }
    }

    return message;
  });
}

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
  getURL: vi.fn<string, [string]>((path) => `chrome-extension://test-extension-id/${path}`),
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
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
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
  declarativeNetRequest: {
    updateDynamicRules: vi.fn(() => Promise.resolve()),
    getDynamicRules: vi.fn(() => Promise.resolve([])),
  },
  contextMenus: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    removeAll: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(() => false),
    },
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
    getMessage: buildGetMessageMock(enMessages as MessagesJson),
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
