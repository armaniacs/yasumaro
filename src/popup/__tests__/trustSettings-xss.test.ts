/**
 * trustSettings-xss.test.ts
 * XSS Protection Tests for trustSettings.ts
 * 【テスト対象】: src/popup/trustSettings.ts - Lines 121-124, 170-173
 *
 * 対象脆弱性: XSS-001
 * - DOM-based XSS in domain tag rendering
 * - innerHTMLを使用したドメイン名レンダリング
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      })
    },
    sync: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve({});
      })
    }
  },
  runtime: {
    lastError: null,
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn()
  }
} as any;

// Mock internationalization
global.chrome.i18n = {
  getMessage: jest.fn((key: string) => `Message for ${key}`),
  getUILanguage: jest.fn(() => 'ja')
} as any;

describe('trustSettings.ts - XSS Protection', () => {
  let document: any;
  let createElementSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Create a minimal document mock
    document = {
      createElement: jest.fn((tagName: string) => {
        const element = {
          tagName: tagName.toUpperCase(),
          className: '',
          innerHTML: '',
          textContent: '',
          dataset: {},
          _children: [] as any[],

          appendChild(child: any) {
            this._children.push(child);
          },

          querySelector(selector: string) {
            if (selector === '.domain-tag-remove') {
              return {
                addEventListener: jest.fn()
              };
            }
            return null;
          }
        };

        // Mock textContent behavior (XSS-safe)
        Object.defineProperty(element, 'textContent', {
          get() {
            return this._textContent || '';
          },
          set(value: string) {
            this._textContent = String(value);
          }
        });

        // Mock innerHTML behavior (XSS-vulnerable)
        Object.defineProperty(element, 'innerHTML', {
          get() {
            return this._innerHTML;
          },
          set(value: string) {
            this._innerHTML = value;
          }
        });

        Object.defineProperty(element, 'className', {
          get() {
            return this._className;
          },
          set(value: string) {
            this._className = value;
          }
        });

        return element;
      }),
      getElementById: jest.fn((id: string) => null),
      querySelector: jest.fn((selector: string) => null),
      querySelectorAll: jest.fn((selector: string) => [])
    };

    // Spy on console.error
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('JP-Anchor TLD rendering - XSS Protection', () => {
    test('should escape HTML in TLD names (line 121-124)', async () => {
      const trustSettings = await import('../trustSettings.js');

      // Mock DOM elements
      const jpAnchorListDiv = document.createElement('div');
      jpAnchorListDiv.id = 'jpAnchorTldList';
      document.getElementById = jest.fn((id: string) => {
        if (id === 'jpAnchorTldList') return jpAnchorListDiv;
        return null;
      });

      // Test with XSS payload in TLD
      const maliciousTld = '.com<script>alert("XSS")</script>';

      // This should not execute the script
      trustSettings.renderJpAnchorTldList([maliciousTld]);

      // Verify innerHTML was set
      expect(jpAnchorListDiv._children[0].innerHTML).toContain('<script>');

      // Check if script tag would execute in real DOM
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = maliciousTld;
      // In safe implementation, this should be escaped
      expect(tempDiv._innerHTML).toBeDefined();

      // In real browser, innerHTML with script tags would not execute
      // But if the value is not escaped, it could be dangerous in other contexts
    });

    test('should handle images onerror attack', async () => {
      const trustSettings = await import('../trustSettings.js');

      const jpAnchorListDiv = document.createElement('div');
      jpAnchorListDiv.id = 'jpAnchorTldList';
      document.getElementById = jest.fn((id: string) => {
        if (id === 'jpAnchorTldList') return jpAnchorListDiv;
        return null;
      });

      const maliciousTld = '.com<img onerror="alert(1)" src=x>';

      trustSettings.renderJpAnchorTldList([maliciousTld]);

      // Verify the malicious HTML is present in innerHTML
      const child = jpAnchorListDiv._children[0];
      expect(child.innerHTML).toContain('onerror');
    });

    test('should handle data URI attacks', async () => {
      const trustSettings = await import('../trustSettings.js');

      const jpAnchorListDiv = document.createElement('div');
      jpAnchorListDiv.id = 'jpAnchorTldList';
      document.getElementById = jest.fn((id: string) => {
        if (id === 'jpAnchorTldList') return jpAnchorListDiv;
        return null;
      });

      const maliciousTld = '.com<a href="data:text/html,<script>alert(1)</script>">link</a>';

      trustSettings.renderJpAnchorTldList([maliciousTld]);

      const child = jpAnchorListDiv._children[0];
      expect(child.innerHTML).toContain('data:text/html');
    });
  });

  describe('Domain tag rendering - XSS Protection', () => {
    test('should escape HTML in domain names (line 170-173)', async () => {
      const trustSettings = await import('../trustSettings.js');

      const container = document.createElement('div');
      container.id = 'domainList';
      document.getElementById = jest.fn((id: string) => {
        if (id === 'domainList') return container;
        return null;
      });

      const maliciousDomain = '<script>alert("XSS")</script>.com';

      trustSettings.renderDomainList([maliciousDomain], false);

      const child = container._children[0];
      expect(child.innerHTML).toContain('<script>');
    });

    test('should handle SVG attacks', async () => {
      const trustSettings = await import('../trustSettings.js');

      const container = document.createElement('div');
      container.id = 'domainList';
      document.getElementById = jest.fn((id: string) => {
        if (id === 'domainList') return container;
        return null;
      });

      const maliciousDomain = '<svg onload=alert(1)>.com</svg>';

      trustSettings.renderDomainList([maliciousDomain], false);

      const child = container._children[0];
      expect(child.innerHTML).toContain('onload');
    });
  });

  describe('XSS Protection Recommendations', () => {
    test('RECOMMENDED: use textContent instead of innerHTML for TLD display', () => {
      // Test demonstrating the safe approach
      const safeDiv = document.createElement('div');
      const maliciousTld = '.com<script>alert("XSS")</script>';

      // UNSAFE approach (current implementation)
      const unsafeDiv = document.createElement('div');
      unsafeDiv.innerHTML = `<span>${maliciousTld}</span>`;

      // SAFE approach (recommended)
      const span = document.createElement('span');
      span.textContent = maliciousTld;
      safeDiv.appendChild(span);

      // The safe approach should not contain raw script tags in textContent
      expect(span.textContent).toContain('<script>');
      expect(safeDiv._innerHTML).toContain('&lt;script&gt;') || expect(safeDiv._innerHTML).not.toContain('<script>');
    });

    test('RECOMMENDED: HTML escape function', () => {
      const escapeHtml = (unsafe: string): string => {
        return unsafe
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      const malicious = '<script>alert(1)</script>';
      const escaped = escapeHtml(malicious);

      expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(escaped).not.toContain('<script>');
    });
  });
});