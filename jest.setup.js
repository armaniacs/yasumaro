/**
 * Jestセットアップファイル
 * Chrome Extensions APIのモック設定
 * jsdom環境を利用したテスト設定
 */

// TextEncoder/TextDecoder polyfill (Node.js < 20 compatibility)
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(str) {
      return Buffer.from(str, 'utf-8');
    }
  };
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    decode(buffer) {
      return Buffer.from(buffer).toString('utf-8');
    }
  };
}

// Web Crypto API polyfill for Jest testing environment
// jsdom環境ではcrypto.subtleが利用できないため、常にpolyfillを適用
const { Crypto, CryptoKey } = require('@peculiar/webcrypto');
const webcrypto = new Crypto();
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true
});

// CryptoKey グローバルを追加（テスト環境用）
Object.defineProperty(global, 'CryptoKey', {
  value: CryptoKey,
  writable: true,
  configurable: true
});

// jestをグローバル変数として定義
global.jest = global.jest || {};

// viをグローバル変数として定義
global.vi = global.jest;

// documentはjsdomが提供するため上書きしない
// jsdomにより基本的なDOM操作（getElementById, createElement, querySelector等）が利用可能

// 【改善】：global.documentの上書きを削除しjsdomの機能を活用
// 🟢 信頼性レベル: jest.config.cjsでtestEnvironment: 'jsdom'が設定されているため、
// jsdomによる完全なDOM環境が提供される。手動モックを削除することで、
// DOMの操作（appendChild, remove, classList等）が正しく動作するようになる。

// Chrome Extensions APIのモック（jsdomが提供しないもののみ）
// インメモリストレージ
const localStorage = {};
const syncStorage = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        // keysが配列の場合、それらのキーの値を返す
        // keysがnullや未指定の場合、全ての値を返す
        let result = {};
        if (keys === null || keys === undefined) {
          result = { ...localStorage };
        } else if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (key in localStorage) {
              result[key] = localStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (keys in localStorage) {
            result[keys] = localStorage[keys];
          }
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        Object.assign(localStorage, items);
        if (callback) callback();
        return Promise.resolve();
      })
    },
    sync: {
      get: jest.fn((keys, callback) => {
        let result = {};
        if (keys === null || keys === undefined) {
          result = { ...syncStorage };
        } else if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (key in syncStorage) {
              result[key] = syncStorage[key];
            }
          });
        } else if (typeof keys === 'string') {
          if (keys in syncStorage) {
            result[keys] = syncStorage[keys];
          }
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        Object.assign(syncStorage, items);
        if (callback) callback();
        return Promise.resolve();
      })
    }
  },
  runtime: {
    lastError: null,
    sendMessage: jest.fn((_message, callback) => {
      if (callback && typeof callback === 'function') {
        callback();
      }
    }),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn((_tabId, _message, callback) => {
      if (callback && typeof callback === 'function') {
        callback();
      }
    }),
    onUpdated: {
      addListener: jest.fn()
    }
  },
  i18n: {
    getMessage: jest.fn((key, substitutions) => {
      // テスト用のデフォルトメッセージを返す
      const messages = {
        'loading': 'Loading...',
        'processing': 'Processing...',
        'appTitle': 'Smart History',
        'recordNow': '📝 Record Now',
        'cannotRecordPage': 'Cannot record this page',
        'noTitle': 'No title',
        'save': 'Save',
        'cancel': 'Cancel',
        'connectionError': 'Please refresh the page and try again',
        'domainBlockedError': 'This domain is not allowed to be recorded. Do you want to record it anyway?',
        'success': '✓ Saved to Obsidian',
        'cancelled': 'Cancelled',
        'unknownError': 'Unknown error occurred',
        'errorPrefix': '✗ Error:',
        'fetchingContent': 'Fetching content...',
        'localAiProcessing': 'Local AI processing...',
        'saving': 'Saving...',
        'recording': 'Recording...',
        'forceRecord': 'Force Record',
        'errorColon': 'Error:',
        'manualInput': 'Manual Input',
        'rulesLabel': 'Rules',
        'reload': 'Reload',
        'delete': 'Delete',
        'fileLoaded': 'Loaded "{filename}"',
        'fileReadError': 'File read error',
        'exportError': 'Export error',
        'copyError': 'Copy error',
        'deleteError': 'Delete error',
        'reloadError': 'Reload error',
        'textFileOnly': 'Only text files are supported',
        'noTextToCopy': 'No text to copy',
        'copiedToClipboard': 'Copied to clipboard',
        'nothingToExport': 'Nothing to export',
        'fileExported': 'File exported',
        'loadEmptyUrl': 'Please enter a URL',
        'loadingUrl': 'Loading...',
        'importFromUrl': 'Import from URL',
        'loadedFromUrl': 'Loaded filters from "{url}"',
        'sourceUpdated': 'Source updated ({ruleCount} rules)',
        'clipboardCopyFailed': 'Failed to copy to clipboard',
        'generatedBy': '! Generated by Obsidian Weave',
        'previousMaskedItem': 'Previous masked item',
        'nextMaskedItem': 'Next masked item',
        'maskStatusCount': 'Masked {count} items of personal information',
        'maskStatusDetails': 'Masked {details}',
        'itemsCount': '{count} items',
        'items': ', ',
        'modeRequired': 'Please select a mode',
        'saveError': 'Save error',
        'privacySaved': 'Privacy settings saved',
        'testingConnection': 'Testing connection...',
        'successConnected': 'Success! Connected to Obsidian. Settings Saved.',
        'connectionFailed': 'Connection Failed: {message}',
        'acceptCertificate': 'Click here to accept self-signed certificate',
        'errorProtocol': 'Error: Protocol must be "http" or "https".',
        'errorPort': 'Error: Port must be a number between 1 and 65535.',
        'errorDuration': 'Error: Minimum visit duration must be a non-negative number.',
        'errorScrollDepth': 'Error: Minimum scroll depth must be a number between 0 and 100.',
        'domainListError': 'Domain list errors:',
        'noActiveTab': 'No active tab found',
        'filterModeRequired': 'Please select a filter mode',
        'domainFilterSaved': 'Domain filter settings saved',
        'cannotRecordHttpHttps': 'Current page is not an HTTP/HTTPS page',
        'failedToExtractDomain': 'Failed to extract domain',
        'domainAdded': 'Added domain "{domain}"',
        'domainAlreadyExists': 'Domain "{domain}" already exists in the list',
        'domainList': 'Domain List (1 domain per line)',
        'closeModalBtn': '×',
        'cancelPreviewBtn': 'Cancel',
        'sendBtn': 'Send',
        'confirmContent': 'Review Content',
        'confirmContentDesc': 'You can review and edit the content to be saved to Obsidian.',
        'confirmContentNote': 'Note: Check masked items.',
        'mainTab': 'General',
        'domainTab': 'Domain Filter',
        'privacyTab': 'Privacy',
        'back': '←',
        'apiKey': 'Obsidian API Key',
        'apiKeyPlaceholder': 'Paste your key here...',
        'protocol': 'Protocol (http/https)',
        'port': 'Port',
        'dailyNotePath': 'Daily Note Path',
        'dailyNotePathPlaceholder': 'e.g. 092.Daily',
        'aiProvider': 'AI Provider',
        'googleGemini': 'Google Gemini',
        'openaiCompatible': 'OpenAI Compatible (Groq, etc.)',
        'openaiCompatible2': 'OpenAI Compatible 2 (Local, etc.)',
        'geminiApiKey': 'Gemini API Key',
        'geminiApiKeyPlaceholder': 'Paste your Gemini key here...',
        'modelName': 'Model Name (e.g. gemini-1.5-flash)',
        'baseUrl': 'Base URL',
        'openaiBaseUrlPlaceholder': 'https://api.openai.com/v1',
        'openaiApiKeyPlaceholder': 'sk-...',
        'openaiModelPlaceholder': 'gpt-3.5-turbo',
        'openai2BaseUrlPlaceholder': 'http://127.0.0.1:11434/v1',
        'openai2ApiKeyPlaceholder': 'Optional for some local LLMs',
        'openai2ModelPlaceholder': 'llama3',
        'minVisitDuration': 'Min Visit Duration (seconds)',
        'minScrollDepth': 'Min Scroll Depth (%)',
        'saveAndTest': 'Save & Test Connection',
        'domainFilterMode': 'Domain Filter Mode',
        'filterDisabled': 'Disabled (record all)',
        'filterWhitelist': 'Whitelist (record only specified domains)',
        'filterBlacklist': 'Blacklist (exclude specified domains)',
        'filterFormat': 'Filter Format (can be combined)',
        'simpleFormat': 'Simple (1 domain per line)',
        'ublockFormat': 'uBlock Origin Format',
        'domainListPlaceholder': 'example.com\n*.example.org\ncompany.net',
        'wildcardHelp': 'Wildcards are supported (e.g. *.example.com)',
        'addCurrentDomain': 'Add Current Page Domain',
        'saveDomainSettings': 'Save',
        'ublockFilter': 'uBlock Filter',
        'ublockFilterPlaceholder': '||example.com^\n@@||trusted.com^\n0.0.0.0 ads.example.com\n! Comment line',
        'ublockHelp': 'Paste uBlock Origin or hosts format filters\nuBlock: ||hostname^, @@||hostname^, *, !Comments\nhosts: 0.0.0.0/127.0.0.1 hostname (#comments supported)',
        'loadFromFile': 'Load from file (.txt)',
        'selectFile': 'Select File',
        'dropFileHere': 'Drop file here',
        'loadFromUrl': 'Load from URL',
        'urlPlaceholder': 'https://example.com/filters.txt',
        'registeredFilterSources': 'Registered Filter Sources',
        'noSourcesRegistered': 'No sources registered',
        'loadPreview': 'Load Preview',
        'ruleCount': 'Rules: {count}',
        'exceptionCount': 'Exceptions: {count}',
        'errorCount': 'Errors: {count}',
        'export': 'Export',
        'copyToClipboard': 'Copy to Clipboard',
        'privacyMode': 'Privacy Mode',
        'modeA': 'Mode A: Local Only',
        'modeADesc': 'Summarize page content using only local AI, without sending data externally.\nCurrently not supported on most browsers.',
        'modeADetail': '(Under development)',
        'modeB': 'Mode B: Full Pipeline',
        'modeBDesc': 'Local AI summary → PII masking → Cloud AI refinement.\nCurrently not supported on most browsers.',
        'modeBCurrently': '(Under development)',
        'modeC': 'Mode C: Masked Cloud',
        'modeCDesc': 'Send only masked data to cloud AI.\nFor environments where local AI is not available.',
        'modeCRecommended': '(Recommended)',
        'modeD': 'Mode D: Cloud Only',
        'modeDDesc': 'Send raw text directly to cloud AI.\nPrioritize speed.',
        'confirmSettings': 'Confirmation Settings',
        'confirmBeforeSending': 'Confirm masking result before sending',
        'savePrivacySettings': 'Save',
        'settings': 'Settings',
        'piiCreditCard': 'Credit Card Number',
        'piiMyNumber': 'My Number',
        'piiBankAccount': 'Bank Account Number',
        'piiEmail': 'E-mail',
        'piiPhoneJp': 'Phone Number',
        // エラーメッセージ用キー
        'errorNetwork': 'ネットワークエラーが発生しました。接続を確認してください。',
        'errorAuth': '認証エラーが発生しました。APIキーを確認してください。',
        'errorValidation': '入力内容を確認してください。',
        'errorNotFound': 'リソースが見つかりません。',
        'errorRateLimit': 'リクエスト制限を超えました。しばらく待ってから再試行してください。',
        'errorServer': 'サーバーエラーが発生しました。',
        'errorGeneric': 'エラーが発生しました。',
        'errorUrlNotAllowed': 'このURLは記録できません。',
        'errorDomainBlocked': 'このドメインはブロックされています。',
        'errorInvalidUrlGeneric': '無効なURLです。',
        'errorObsidianConnection': 'Obsidianとの接続に失敗しました。',
        'errorDailyNoteSave': 'デイリーノートの保存に失敗しました。',
        'errorAiSummarize': 'AI要約に失敗しました。',
        'errorContentEmpty': 'コンテンツが空です。'
      };

      let message = messages[key] || key;

      // 置換処理
      if (substitutions && typeof substitutions === 'object') {
        Object.keys(substitutions).forEach((placeholder) => {
          const value = substitutions[placeholder];
          message = message.replace(`{${placeholder}}`, value);
        });
      }

      return message;
    }),
    getUILanguage: jest.fn(() => 'en'),
  }
};

// 【簡略化】：getElementByIdの複雑なモックを削除
// 🟡 黄信号: これは既存テストとの互換性を保つための暫定対策
// 将来的には各テストファイルでbeforeEachで必要な要素を作成する方式へ移行推奨
//
// 【移行計画】:
// 1. uBlock関連の要素モックは、ublockImport.test.js等でbeforeEachで動的に作成
// 2. domainFilter関連の要素モックは、domainFilter.test.jsでbeforeEachで動的に作成
// 3. 共通要素（modal, spinnerなど）は、共通beforeEachフックを作成

// グローバル変数のリセット（各テスト前に実行）
beforeEach(() => {
  jest.clearAllMocks();
  // Chrome APIの状態をリセット（防御的に処理）
  if (global.chrome && global.chrome.runtime) {
    global.chrome.runtime.lastError = null;
  }
  // ストレージのクリア
  Object.keys(localStorage).forEach(key => delete localStorage[key]);
  Object.keys(syncStorage).forEach(key => delete syncStorage[key]);
});

// テスト終了後のクリーンアップ
afterEach(() => {
  // DOMの状態をリセット（jsdomのdomNodesプロパティをクリア）
  document.body.innerHTML = '';
});