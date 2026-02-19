/**
 * i18n.test.js
 *
 * i18nヘルパーのテスト
 */

import {
  getMessage,
  applyI18n,
  translatePageTitle,
  getUserLocale,
  setHtmlLangAndDir,
  isRTL
} from '../i18n.js';

describe('i18n', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Chrome i18n APIのモック
    global.chrome = {
      i18n: {
        getMessage: jest.fn((key) => {
          const messages = {
            'testKey': 'Test Message',
            'testWithArgs': 'Hello {name}',
            'extensionName': 'Obsidian Smart History'
          };
          return messages[key] || '';
        }),
        getUILanguage: jest.fn(() => 'ja-JP')
      },
      runtime: {
        lastError: null
      }
    };

    // DOMの初期化
    document.body.innerHTML = '';
  });

  describe('getUserLocale', () => {
    it('getUserLocaleがエクスポートされていること', () => {
      expect(typeof getUserLocale).toBe('function');
    });

    it('getUserLocaleがlocaleUtilsから取り込まれていること', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('ja-JP');
      const result = getUserLocale();
      expect(result).toBe('ja-JP');
    });
  });

  describe('getMessage', () => {
    it('単一の翻訳キーから翻訳文字列を取得できる', () => {
      const result = getMessage('testKey');
      expect(result).toBe('Test Message');
    });

    it('存在しないキーの場合は空文字を返す', () => {
      const result = getMessage('nonExistentKey');
      expect(result).toBe('');
    });

    it('置換パラメータで変数を置換できる', () => {
      const result = getMessage('testWithArgs', { name: 'World' });
      expect(result).toBe('Hello World');
    });

    it('置換パラメータなしの呼び出しで正しく動作する', () => {
      global.chrome.i18n.getMessage.mockReturnValue('Test Message');
      const result = getMessage('testKey');
      expect(result).toBe('Test Message');
    });

    it('配列形式の置換パラメータはそのまま返す', () => {
      global.chrome.i18n.getMessage.mockReturnValue('Test Message');
      const result = getMessage('testKey', ['arg1', 'arg2']);
      expect(result).toBe('Test Message');
    });
  });

  describe('applyI18n', () => {
    it('data-i18n属性を持つ要素を翻訳する', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });

    it('入力要素のプレースホルダーを翻訳する', () => {
      const input = document.createElement('input');
      input.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(input);

      applyI18n();

      expect(input.placeholder).toBe('Test Message');
    });

    it('textarea要素のプレースホルダーを翻訳する', () => {
      const textarea = document.createElement('textarea');
      textarea.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(textarea);

      applyI18n();

      expect(textarea.placeholder).toBe('Test Message');
    });

    it('data-i18n-input-placeholder属性を持つ要素のプレースホルダーを翻訳する', () => {
      const input = document.createElement('input');
      input.setAttribute('data-i18n-input-placeholder', 'testKey');
      document.body.appendChild(input);

      applyI18n();

      expect(input.placeholder).toBe('Test Message');
    });

    it('data-i18n-aria-label属性を持つ要素のaria-labelを翻訳する', () => {
      const button = document.createElement('button');
      button.setAttribute('data-i18n-aria-label', 'testKey');
      document.body.appendChild(button);

      applyI18n();

      expect(button.getAttribute('aria-label')).toBe('Test Message');
    });

    it('data-i18n-args属性を持つ要素で置換パラメータを使用する', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testWithArgs');
      div.setAttribute('data-i18n-args', '{"name":"User"}');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Hello User');
    });

    it('無効なJSON argsの場合は無視する', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      div.setAttribute('data-i18n-args', 'invalid json');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });

    it('data-i18n属性を持つ要素が存在しない場合にエラーを投げない', () => {
      expect(() => applyI18n()).not.toThrow();
    });

    it('特定の要素を指定して翻訳を適用できる', () => {
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
    it('ページタイトルを翻訳する', () => {
      translatePageTitle('extensionName');
      expect(document.title).toBe('Obsidian Smart History');
    });

    it('存在しないキーの場合は空文字を設定する', () => {
      translatePageTitle('nonExistentKey');
      expect(document.title).toBe('');
    });
  });

  describe('setHtmlLangAndDir', () => {
    it('isRTLがエクスポートされていること', () => {
      expect(typeof isRTL).toBe('function');
    });

    it('setHtmlLangAndDirがエクスポートされていること', () => {
      expect(typeof setHtmlLangAndDir).toBe('function');
    });

    it('日本語ロケールでlangとdirを設定する', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('ja-JP');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('ja-JP');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('アラビア語ロケールでlangとdirを設定する', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('ar-EG');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('ar-EG');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('英語ロケールでlangとdirを設定する', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('en-US');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });

    it('RTL言語でdirがrtlになる', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('he');
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('he');
      expect(document.documentElement.dir).toBe('rtl');
    });

    it('フォールバックの英語ロケールで正しく設定する', () => {
      // Chrome APIを削除してフォールバックをテスト
      delete global.chrome;
      setHtmlLangAndDir();

      expect(document.documentElement.lang).toBe('en-US');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  describe('縮合テスト', () => {
    it('getUserLocaleとgetMessageを kombinatして使用する', () => {
      global.chrome.i18n.getUILanguage.mockReturnValue('ja-JP');
      const locale = getUserLocale();
      expect(locale).toBe('ja-JP');

      const message = getMessage('testKey');
      expect(message).toBe('Test Message');
    });

    it('applyI18n後にDOMが正しく翻訳されていること', () => {
      const div = document.createElement('div');
      div.setAttribute('data-i18n', 'testKey');
      document.body.appendChild(div);

      applyI18n();

      expect(div.textContent).toBe('Test Message');
    });
  });
});