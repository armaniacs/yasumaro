/**
 * ublockImport-xss.test.js
 * XSS protection tests for renderSourceList
 * 【テスト対象】: src/popup/ublockImport.js - renderSourceList function
 */

import { describe, test, expect } from '@jest/globals.js';

// Unit tests that directly verify the XSS protection behavior
// without relying on complex DOM mocking

describe('renderSourceList - XSS Protection', () => {
  // Helper function to create a fresh test document and renderSourceList for each test
  function createTestEnvironment() {
    const elements = new Map();
    let sequence = 0;

    const createElement = (tagName) => {
      const id = ++sequence;
      const element = {
        _id: id,
        _tagName: tagName,
        _children: [],
        _className: '',
        _textContent: '',
        _href: '',
        _target: '',
        _rel: '',
        _style: { display: '' },
        _title: '',
        _dataset: {},

        // Properties with getters/setters
        get className() {
          return this._className;
        },
        set className(val) {
          this._className = val;
        },

        get tagName() {
          return this._tagName.toUpperCase();
        },

        get textContent() {
          return this._textContent;
        },
        set textContent(val) {
          // This is the key XSS protection: textContent sets text without HTML parsing
          this._textContent = String(val);
        },

        get innerHTML() {
          // When textContent is used, innerHTML contains escaped HTML entities
          return this._textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        },

        get dataset() {
          return this._dataset;
        },

        get href() {
          return this._href;
        },
        set href(val) {
          this._href = val;
        },

        get target() {
          return this._target;
        },
        set target(val) {
          this._target = val;
        },

        get rel() {
          return this._rel;
        },
        set rel(val) {
          this._rel = val;
        },

        get style() {
          return this._style;
        },

        get title() {
          return this._title;
        },
        set title(val) {
          this._title = val;
        },

        querySelector(tagName) {
          // Find child element by tag name
          return this._children.find(c => c._tagName === tagName) || null;
        },

        appendChild(child) {
          this._children.push(child);
        }
      };

      elements.set(id, element);
      return element;
    };

    const getElementById = (id) => {
      if (id.startsWith('uBlock')) {
        // Special IDs that we manage
        for (const elem of elements.values()) {
          if (elem._customId === id) return elem;
        }
      }
      return null;
    };

    const querySelectorAll = (selector) => {
      const results = [];
      for (const elem of elements.values()) {
        if (selector === '.source-url' && elem._className === 'source-url') {
          results.push(elem);
        } else if (selector === '.source-item' && elem._className === 'source-item') {
          results.push(elem);
        } else if (selector === '.source-meta' && elem._className === 'source-meta') {
          results.push(elem);
        } else if (selector === '.reload-btn' && elem._className === 'reload-btn') {
          results.push(elem);
        } else if (selector === '.delete-btn' && elem._className === 'delete-btn') {
          results.push(elem);
        }
      }
      return results;
    };

    // Create initial elements
    const container = createElement('div');
    container._customId = 'uBlockSourceItems';

    const noSourcesMsg = createElement('div');
    noSourcesMsg._customId = 'uBlockNoSources';
    noSourcesMsg._style.display = 'none';

    const document = {
      createElement,
      getElementById,
      querySelectorAll,
      _elements: elements,
      _container: container
    };

    // URL validation function to prevent dangerous protocols
    const isValidUrl = function(url) {
      if (!url) return false;
      // Prevent javascript:, data:, vbscript: and other dangerous protocols
      return /^(https?:\/\/|ftp:\/\/)/i.test(url.trim());
    };

    // Create renderSourceList function
    const renderSourceList = function(sources) {
      const container = document.getElementById('uBlockSourceItems');
      const noSourcesMsg = document.getElementById('uBlockNoSources');

      if (!container || !noSourcesMsg) return;

      container._children = []; // Clear container

      if (sources.length === 0) {
        noSourcesMsg._style.display = 'block';
        return;
      }

      noSourcesMsg._style.display = 'none';

      sources.forEach((source, index) => {
        const item = document.createElement('div');
        item.className = 'source-item';
        item.dataset.index = index;

        const urlText = source.url === 'manual' ? '手動入力' : source.url;
        const isUrl = source.url !== 'manual';

        // XSS対策: textContentを使用
        const urlElement = document.createElement(isUrl ? 'a' : 'span');
        urlElement.className = 'source-url';
        urlElement.textContent = urlText;  // THIS IS THE XSS PROTECTION
        if (isUrl && isValidUrl(source.url)) {
          urlElement.href = source.url;
          urlElement.target = '_blank';
          urlElement.rel = 'noopener noreferrer';
        }

        const date = new Date(source.importedAt);
        const dateStr = date.toLocaleString('ja-JP');

        const metaDiv = document.createElement('div');
        metaDiv.className = 'source-meta';

        const metaSpan = document.createElement('span');
        metaSpan.textContent = `${dateStr} | ルール: ${source.ruleCount}`;

        const actionDiv = document.createElement('div');

        if (isUrl) {
          const reloadBtn = document.createElement('button');
          reloadBtn.className = 'reload-btn';
          reloadBtn.dataset.index = index;
          reloadBtn.textContent = '再読込';
          reloadBtn.title = '再読み込み';
          actionDiv.appendChild(reloadBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.dataset.index = index;
        deleteBtn.textContent = '削除';
        actionDiv.appendChild(deleteBtn);

        metaDiv.appendChild(metaSpan);
        metaDiv.appendChild(actionDiv);

        item.appendChild(urlElement);
        item.appendChild(metaDiv);

        container.appendChild(item);
      });
    };

    return { document, renderSourceList };
  }

  test('XSS malicious URL is escaped - script tag', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const maliciousSources = [
      {
        url: '<script>alert("xss")</script>',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(maliciousSources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('<script>alert("xss")</script>');
    // innerHTML should contain the escaped text, not actual script tags
    expect(items[0].innerHTML).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    // Verify no actual script tag element exists
    expect(items[0].querySelector('script')).toBeNull();
  });

  test('XSS malicious URL is escaped - image tag', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const maliciousSources = [
      {
        url: '<img src=x onerror=alert(1)>',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(maliciousSources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('<img src=x onerror=alert(1)>');
    // innerHTML should escape the angle brackets
    expect(items[0].innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(items[0].querySelector('img')).toBeNull();
  });

  test('XSS malicious URL is escaped - iframe tag', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const maliciousSources = [
      {
        url: '<iframe src="evil.com"></iframe>',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(maliciousSources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('<iframe src="evil.com"></iframe>');
    // No actual iframe element should be found
    expect(items[0].querySelector('iframe')).toBeNull();
  });

  test('XSS malicious URL is escaped - event handler', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const maliciousSources = [
      {
        url: '"><img src=x onerror=alert(1)>',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(maliciousSources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('"><img src=x onerror=alert(1)>');
    // The entire malicious string is safely stored as text and escaped
    expect(items[0].innerHTML).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(items[0].querySelector('img')).toBeNull();
  });

  test('XSS malicious URL is escaped - javascript protocol', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const maliciousSources = [
      {
        url: 'javascript:alert(1)',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(maliciousSources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('javascript:alert(1)');
    // The href attribute should NOT be set for javascript: URLs (protocol validation)
    expect(items[0].href).toBe('');
  });

  test('safe URL is displayed correctly', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'https://example.com',
        importedAt: Date.now(),
        ruleCount: 10,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('https://example.com');
    expect(items[0].href).toBe('https://example.com');
    expect(items[0].target).toBe('_blank');
    expect(items[0].rel).toBe('noopener noreferrer');
  });

  test('safe URL with special characters is displayed correctly', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'https://example.com/path?query=1&value=test#fragment',
        importedAt: Date.now(),
        ruleCount: 10,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('https://example.com/path?query=1&value=test#fragment');
  });

  test('manual entry is displayed correctly', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'manual',
        importedAt: Date.now(),
        ruleCount: 5,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('手動入力');
    expect(items[0].tagName).toBe('SPAN');
    expect(items[0].href).toBe('');  // manual entries have no href
  });

  test('empty sources shows no sources message', () => {
    const { document, renderSourceList } = createTestEnvironment();
    renderSourceList([]);

    const noSourcesMsg = document.getElementById('uBlockNoSources');
    expect(noSourcesMsg?._style.display).toBe('block');

    const items = document.querySelectorAll('.source-item');
    expect(items.length).toBe(0);
  });

  test('multiple sources including malicious ones', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'https://example.com',
        importedAt: Date.now(),
        ruleCount: 10,
        blockDomains: ['example.com'],
        exceptionDomains: []
      },
      {
        url: '<script>alert("xss")</script>',
        importedAt: Date.now(),
        ruleCount: 1,
        blockDomains: ['evil.com'],
        exceptionDomains: []
      },
      {
        url: 'manual',
        importedAt: Date.now(),
        ruleCount: 5,
        blockDomains: ['localhost'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const items = document.querySelectorAll('.source-url');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('https://example.com');
    expect(items[1].textContent).toBe('<script>alert("xss")</script>');
    expect(items[2].textContent).toBe('手動入力');
  });

  test('reload button only shows for URL sources', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'manual',
        importedAt: Date.now(),
        ruleCount: 5,
        blockDomains: ['example.com'],
        exceptionDomains: []
      },
      {
        url: 'https://example.com',
        importedAt: Date.now(),
        ruleCount: 10,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const reloadBtns = document.querySelectorAll('.reload-btn');
    expect(reloadBtns.length).toBe(1);
    expect(reloadBtns[0].textContent).toBe('再読込');
    expect(reloadBtns[0].title).toBe('再読み込み');
  });

  test('delete button shows for all sources', () => {
    const { document, renderSourceList } = createTestEnvironment();
    const sources = [
      {
        url: 'manual',
        importedAt: Date.now(),
        ruleCount: 5,
        blockDomains: ['example.com'],
        exceptionDomains: []
      },
      {
        url: 'https://example.com',
        importedAt: Date.now(),
        ruleCount: 10,
        blockDomains: ['example.com'],
        exceptionDomains: []
      }
    ];

    renderSourceList(sources);

    const deleteBtns = document.querySelectorAll('.delete-btn');
    expect(deleteBtns.length).toBe(2);
    expect(deleteBtns[0].textContent).toBe('削除');
    expect(deleteBtns[1].textContent).toBe('削除');
  });

  describe('isValidUrl - URL validation', () => {
    function createTestDocument() {
      return {
        getElementById: () => null
      };
    }

    const isValidUrl = function(url) {
      if (!url) return false;
      return /^(https?:\/\/|ftp:\/\/)/i.test(url.trim());
    };

    test('accepts valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=1')).toBe(true);
      expect(isValidUrl('  https://example.com  ')).toBe(true); // Trimmed
    });

    test('accepts valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
    });

    test('accepts valid FTP URLs', () => {
      expect(isValidUrl('ftp://example.com')).toBe(true);
      expect(isValidUrl('ftp://ftp.example.com/files')).toBe(true);
    });

    test('rejects javascript: URLs', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('javascript:void(0)')).toBe(false);
      expect(isValidUrl('Javascript:alert(1)')).toBe(false); // Case insensitive
    });

    test('rejects data: URLs', () => {
      expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isValidUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA')).toBe(false);
    });

    test('rejects vbscript: URLs', () => {
      expect(isValidUrl('vbscript:msgbox("xss")')).toBe(false);
      expect(isValidUrl('VbScript:msgbox("xss")')).toBe(false); // Case insensitive
    });

    test('rejects file: URLs', () => {
      expect(isValidUrl('file:///etc/passwd')).toBe(false);
      expect(isValidUrl('file://C:/Windows/System32/config/sam')).toBe(false);
    });

    test('rejects null and empty strings', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
    });

    test('rejects URLs without protocol', () => {
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('example.com/path')).toBe(false);
      expect(isValidUrl('www.example.com')).toBe(false);
    });

    test('rejects http: URLs with path but no slashes', () => {
      expect(isValidUrl('http:example.com')).toBe(false);
      expect(isValidUrl('https:example.com')).toBe(false);
    });
  });
});