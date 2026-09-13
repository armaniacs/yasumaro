// @vitest-environment jsdom
/**
 * i18n.test.js
 *
 * i18nヘルパーのテスト
 */

import { vi } from 'vitest';
import { getMessage, getMessageOr, getUserLocale, isRTL } from '../i18n.js';
import { applyI18n, translatePageTitle, setHtmlLangAndDir } from '../i18n-dom.js';

describe('i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      i18n: {
        getMessage: vi.fn((key: string) => {
          const messages: Record<string, string> = {
            'testKey': 'Test Message',
            'testWithArgs': 'Hello {name}',
            'extensionName': 'Yasumaro'
          };
          return messages[key] || '';
        }),
        getUILanguage: vi.fn(() => 'ja-JP')
      },
      runtime: {
        lastError: undefined
      }
    } as unknown as typeof chrome;

    // DOMの初期化
    document.body.innerHTML = '';
  });

  describe('getUserLocale', () => {
    it('exports getUserLocale', () => {
      expect(typeof getUserLocale).toBe('function');
    });

    it('re-exports getUserLocale from localeUtils', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('ja-JP');
      const result = getUserLocale();
      expect(result).toBe('ja-JP');
    });
  });

  describe('getMessage', () => {
    it('retrieves the translated string for a single translation key', () => {
      const result = getMessage('testKey');
      expect(result).toBe('Test Message');
    });

    it('returns an empty string for a missing key', () => {
      const result = getMessage('nonExistentKey');
      expect(result).toBe('');
    });

    it('substitutes variables with replacement parameters', () => {
      const result = getMessage('testWithArgs', { name: 'World' });
      expect(result).toBe('Hello World');
    });

    it('works correctly when called without replacement parameters', () => {
      vi.mocked(global.chrome.i18n.getMessage).mockReturnValue('Test Message');
      const result = getMessage('testKey');
      expect(result).toBe('Test Message');
    });

    it('passes array-form substitution parameters through to chrome.i18n', () => {
      vi.mocked(global.chrome.i18n.getMessage).mockReturnValue('Test Message');
      const result = getMessage('testKey', ['arg1', 'arg2']);
      expect(result).toBe('Test Message');
    });
  });

  describe('applyI18n', () => {
    it('translates elements with the data-i18n attribute', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });

    it('translates the placeholder of input elements', () => {
      const input = document.createElement('input');
      input.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(input);

      applyI18n();

      expect(input.placeholder).toBe('Test Message');
    });

    it('translates the placeholder of textarea elements', () => {
      const textarea = document.createElement('textarea');
      textarea.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(textarea);

      applyI18n();

      expect(textarea.placeholder).toBe('Test Message');
    });

    it('translates the placeholder of elements with the data-i18n-input-placeholder attribute', () => {
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', 'testKey');
      document.body.appendChild(input);

      applyI18n();

      expect(input.placeholder).toBe('Test Message');
    });

    it('translates the aria-label of elements with the data-i18n-aria-label attribute', () => {
      const button = document.createElement('button');
      button.setAttribute('data-i18n-aria-label', 'testKey');
      document.body.appendChild(button);

      applyI18n();

      expect(button.getAttribute('aria-label')).toBe('Test Message');
    });

    it('uses substitution parameters for elements with the data-i18n-args attribute', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testWithArgs');
      div.setAttribute('data-i18n-args', '{"name":"User"}');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Hello User');
    });

    it('ignores invalid JSON args', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      div.setAttribute('data-i18n-args', 'invalid json');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });

    it('resolves the plural key for the English locale with data-i18n-args containing count', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('en-US');
      vi.mocked(global.chrome.i18n.getMessage).mockImplementation((key: string) => {
        const messages: Record<string, string> = {
          'itemCount_one': '1 item',
          'itemCount_other': '{count} items',
        };
        return messages[key] || '';
      });

      const singular = document.createElement('div');
      singular.setAttribute('data-i18n', 'itemCount');
      singular.setAttribute('data-i18n-args', '{"count":"1"}');
      document.body.appendChild(singular);

      const plural = document.createElement('div');
      plural.setAttribute('data-i18n', 'itemCount');
      plural.setAttribute('data-i18n-args', '{"count":"5"}');
      document.body.appendChild(plural);

      applyI18n();

      expect(singular.textContent).toBe('1 item');
      expect(plural.textContent).toBe('5 items');
    });

    it('uses the key without a plural suffix for the Japanese locale even with count', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('ja-JP');
      vi.mocked(global.chrome.i18n.getMessage).mockImplementation((key: string) => {
        const messages: Record<string, string> = { 'itemCount': '{count}件' };
        return messages[key] || '';
      });

      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'itemCount');
      div.setAttribute('data-i18n-args', '{"count":"5"}');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('5件');
    });

    it('behaves as before for data-i18n-args without count', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testWithArgs');
      div.setAttribute('data-i18n-args', '{"name":"NoCount"}');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Hello NoCount');
    });

    it('translates the title of IMG elements with the data-i18n attribute', () => {
      const img = document.createElement('img');
      img.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(img);

      applyI18n();

      expect(img.title).toBe('Test Message');
    });

    it('translates option[data-i18n-opt] inside select elements', () => {
      vi.mocked(global.chrome.i18n.getMessage).mockImplementation((key: string) => {
        if (key === 'optionLabel') return 'Translated Option';
        return '';
      });

      const select = document.createElement('select');
      const option = document.createElement('option');
      option.setAttribute('data-i18n-opt', 'optionLabel');
      select.appendChild(option);
      document.body.appendChild(select);

      applyI18n();

      expect(option.text).toBe('Translated Option');
    });

    it('translates the textContent of [data-i18n-label] buttons', () => {
      vi.mocked(global.chrome.i18n.getMessage).mockImplementation((key: string) => {
        if (key === 'btnLabel') return 'Click Me';
        return '';
      });

      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-label', 'btnLabel');
      document.body.appendChild(btn);

      applyI18n();

      expect(btn.textContent).toBe('Click Me');
    });

    it('translates .help-text[data-i18n] elements', () => {
      vi.mocked(global.chrome.i18n.getMessage).mockImplementation((key: string) => {
        if (key === 'helpMsg') return 'Help text here';
        return '';
      });

      const help = document.createElement('div');
      help.className = 'help-text';
      help.setAttribute('data-i18n', 'helpMsg');
      document.body.appendChild(help);

      applyI18n();

      expect(help.textContent).toBe('Help text here');
    });

    it('throws no error when no elements with the data-i18n attribute exist', () => {
      expect(() => applyI18n()).not.toThrow();
    });

    it('applies translation to a specified element', () => {
      const container = document.createElement('div');
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      const otherDiv = document.createElement('div');
      otherDiv.setAttribute('data-i18n', 'testKey');
      otherDiv.setAttribute('id', 'outside');
      container.appendChild(div);
      document.body.appendChild(container);
      document.body.appendChild(otherDiv);

      applyI18n(container);

      expect(div.textContent).toBe('Test Message');
      expect(otherDiv.textContent).toBe('');
    });
  });

  describe('translatePageTitle', () => {
    it('translates the page title', () => {
      translatePageTitle('extensionName');
      expect(document.title).toBe('Yasumaro');
    });

    it('sets an empty string for a missing key', () => {
      translatePageTitle('nonExistentKey');
      expect(document.title).toBe('');
    });
  });

  describe('setHtmlLangAndDir', () => {
    it('exports isRTL', () => {
      expect(typeof isRTL).toBe('function');
    });

    it('exports setHtmlLangAndDir', () => {
      expect(typeof setHtmlLangAndDir).toBe('function');
    });

    it('sets lang and dir for the Japanese locale', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('ja-JP');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('ja-JP');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('sets lang and dir for the Arabic locale', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('ar-EG');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('ar-EG');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('sets lang and dir for the English locale', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('en-US');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('sets dir to rtl for RTL languages', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('he');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('he');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('falls back to the English locale correctly', () => {
      // Chrome APIを削除してフォールバックをテスト
      delete (global as { chrome?: typeof chrome }).chrome;
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  describe('縮合テスト', () => {
    it('uses getUserLocale combined with getMessage', () => {
      vi.mocked(global.chrome.i18n.getUILanguage).mockReturnValue('ja-JP');
      const locale = getUserLocale();
      expect(locale).toBe('ja-JP');

      const message = getMessage('testKey');
      expect(message).toBe('Test Message');
    });

    it('leaves the DOM correctly translated after applyI18n', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });

    it('preserves fallback text when translation key is missing', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'nonexistentKey');
      div.textContent = 'Fallback text';
      document.body.appendChild(div);

      applyI18n();

      // Should preserve the original fallback text, not overwrite with empty string
      expect(div.textContent).toBe('Fallback text');
    });
  });

  describe('getMessageOr', () => {
    it('returns the translation when the key exists', () => {
      expect(getMessageOr('testKey', 'fallback')).toBe('Test Message');
    });

    it('returns the fallback when the key is missing', () => {
      // getMessage() returns "" here; callers used to reach past this module
      // for `chrome.i18n.getMessage(key) || fallback` because of that.
      expect(getMessage('missingKey')).toBe('');
      expect(getMessageOr('missingKey', 'fallback')).toBe('fallback');
    });

    it('supports passing the key itself as the fallback', () => {
      // Surfaces the missing translation instead of rendering blank UI.
      expect(getMessageOr('missingKey', 'missingKey')).toBe('missingKey');
    });

    it('forwards substitutions to chrome.i18n', () => {
      getMessageOr('testWithArgs', 'fallback', ['Yasu']);
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('testWithArgs', ['Yasu']);
    });

    it('does not pass substitutions when none are given', () => {
      getMessageOr('testKey', 'fallback');
      expect(chrome.i18n.getMessage).toHaveBeenCalledWith('testKey');
    });
  });
});