/**
 * localeUtils.test.js
 *
 * Locale Utilitiesのユニットテスト
 */

import {
  getUserLocale,
  isRTL,
  formatDate,
  formatDateTime,
  getDateSeparator
} from '../localeUtils.js';

// Chrome APIのモック
const mockGetUILanguage = jest.fn();

describe('localeUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // テスト環境ではchrome APIをモック
    global.chrome = {
      i18n: {
        getUILanguage: mockGetUILanguage
      },
      runtime: {
        lastError: null
      },
      storage: {}
    };
  });

  describe('getUserLocale', () => {
    it('ブラウザ環境で正しいロケールを返す', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(getUserLocale()).toBe('ja-JP');
    });

    it('英語のロケールを正しく返す', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(getUserLocale()).toBe('en-US');
    });

    it('シンプルな言語コードも正しく返す', () => {
      mockGetUILanguage.mockReturnValue('ja');
      expect(getUserLocale()).toBe('ja');
    });

    it('chrome.i18nが未定義の場合はフォールバックを返す', () => {
      global.chrome = undefined;
      const result = getUserLocale();
      expect(result).toBe('en-US');
    });

    it('chrome.i18n.getUILanguageが未定義の場合はフォールバックを返す', () => {
      global.chrome = { i18n: {} };
      expect(getUserLocale()).toBe('en-US');
    });

    it('例外がスローされた場合はフォールバックを返す', () => {
      mockGetUILanguage.mockImplementation(() => {
        throw new Error('API error');
      });
      expect(getUserLocale()).toBe('en-US');
    });
  });

  describe('isRTL', () => {
    // RTL言語テスト
    it('アラビア語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('ar');
      expect(isRTL()).toBe(true);
    });

    it('アラビア語の地域指定でもtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('ar-SA');
      expect(isRTL()).toBe(true);
    });

    it('ヘブライ語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('he');
      expect(isRTL()).toBe(true);
    });

    it('ペルシャ語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('fa');
      expect(isRTL()).toBe(true);
    });

    it('ウルドゥー語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('ur');
      expect(isRTL()).toBe(true);
    });

    it('イディッシュ語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('yi');
      expect(isRTL()).toBe(true);
    });

    it('クルド語（ソラニー）でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('ckb');
      expect(isRTL()).toBe(true);
    });

    it('シンド語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('sd');
      expect(isRTL()).toBe(true);
    });

    it('パシュトー語でtrueを返す', () => {
      mockGetUILanguage.mockReturnValue('ps');
      expect(isRTL()).toBe(true);
    });

    // LTR言語テスト
    it('英語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('en');
      expect(isRTL()).toBe(false);
    });

    it('英語の地域指定でもfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(isRTL()).toBe(false);
    });

    it('日本語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('ja');
      expect(isRTL()).toBe(false);
    });

    it('日本語の地域指定でもfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(isRTL()).toBe(false);
    });

    it('中国語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('zh');
      expect(isRTL()).toBe(false);
    });

    it('韓国語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('ko');
      expect(isRTL()).toBe(false);
    });

    it('スペイン語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('es');
      expect(isRTL()).toBe(false);
    });

    it('フランス語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('fr');
      expect(isRTL()).toBe(false);
    });

    it('ドイツ語でfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('de');
      expect(isRTL()).toBe(false);
    });

    it('不明なロケールでfalseを返す', () => {
      mockGetUILanguage.mockReturnValue('xx');
      expect(isRTL()).toBe(false);
    });

    // 明示的なロケール指定テスト
    it('ロケールパラメータを指定した場合、そのロケールで判定する', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(isRTL('ar')).toBe(true);
      expect(isRTL('ja')).toBe(false);
    });
  });

  describe('formatDate', () => {
    it('日付を正しくフォーマットする', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11');
      const result = formatDate(date);
      expect(result).toContain('2026');
      expect(result).toContain('02');
      expect(result).toContain('11');
    });

    it('null入力で現在日時を使用する', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const result = formatDate(null);
      expect(typeof result).toBe('string');
    });

    it('undefined入力で現在日時を使用する', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const result = formatDate(undefined);
      expect(typeof result).toBe('string');
    });

    it('無効な日付に対して現在日時を使用する', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const result = formatDate('invalid-date');
      expect(result).toBeTruthy();
    });

    it('カスタムオプションを適用する', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11');
      const result = formatDate(date, { year: 'numeric', month: 'short' });
      expect(result).toBeTruthy();
    });

    it('数値（タイムスタンプ）を受け付ける', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const timestamp = Date.now();
      const result = formatDate(timestamp);
      expect(result).toBeTruthy();
    });

    it('文字列形式の日付を受け付ける', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const dateString = '2026-02-11T12:00:00Z';
      const result = formatDate(dateString);
      expect(result).toBeTruthy();
    });
  });

  describe('formatDateTime', () => {
    it('日時を正しくフォーマットする', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11T14:30:00');
      const result = formatDateTime(date);
      expect(result).toBeTruthy();
      expect(result).toContain('2026');
    });

    it('null入力で現在日時を使用する', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const result = formatDateTime(null);
      expect(typeof result).toBe('string');
    });

    it('カスタムオプションを適用する', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11T14:30:00');
      const result = formatDateTime(date, { hour: '2-digit', minute: '2-digit' });
      expect(result).toBeTruthy();
    });
  });

  describe('getDateSeparator', () => {
    it('デフォルトでハイフンを返す', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(getDateSeparator()).toBe('-');
    });

    it('日本語ロケールでもハイフンを返す', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(getDateSeparator()).toBe('-');
    });

    it('アラビア語ロケールでもハイフンを返す', () => {
      mockGetUILanguage.mockReturnValue('ar-SA');
      expect(getDateSeparator()).toBe('-');
    });
  });

  describe('縮合テスト', () => {
    it('一連の動作を確認する', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');

      // ロケール確認
      expect(getUserLocale()).toBe('ja-JP');
      // RTL確認（日本語はLTR）
      expect(isRTL()).toBe(false);
      // 日付フォーマット
      const date = new Date('2026-02-11');
      const formatted = formatDate(date);
      expect(formatted).toContain('2026');
      // 区切り文字
      expect(getDateSeparator()).toBe('-');
    });
  });
});