/**
 * localeUtils.test.ts
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
const mockGetUILanguage = vi.fn();

describe('localeUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // テスト環境ではchrome APIをモック
    global.chrome = {
      i18n: {
        getUILanguage: mockGetUILanguage
      },
      runtime: {
        lastError: null
      },
      storage: {}
    } as any;
  });

  describe('getUserLocale', () => {
    it('returns the correct locale in a browser environment', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(getUserLocale()).toBe('ja-JP');
    });

    it('returns the English locale correctly', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(getUserLocale()).toBe('en-US');
    });

    it('returns a bare language code correctly', () => {
      mockGetUILanguage.mockReturnValue('ja');
      expect(getUserLocale()).toBe('ja');
    });

    it('returns the fallback when chrome.i18n is undefined', () => {
      global.chrome = undefined as any;
      const result = getUserLocale();
      expect(result).toBe('en-US');
    });

    it('returns the fallback when chrome.i18n.getUILanguage is undefined', () => {
      global.chrome = { i18n: {} } as any;
      expect(getUserLocale()).toBe('en-US');
    });

    it('returns the fallback when an exception is thrown', () => {
  
      mockGetUILanguage.mockImplementation(() => {
        throw new Error('API error');
      });
      expect(getUserLocale()).toBe('en-US');
    });
  });

  describe('isRTL', () => {
    // RTL言語テスト
    it('returns true for Arabic', () => {
      mockGetUILanguage.mockReturnValue('ar');
      expect(isRTL()).toBe(true);
    });

    it('returns true for regional Arabic', () => {
      mockGetUILanguage.mockReturnValue('ar-SA');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Hebrew', () => {
      mockGetUILanguage.mockReturnValue('he');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Persian', () => {
      mockGetUILanguage.mockReturnValue('fa');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Urdu', () => {
      mockGetUILanguage.mockReturnValue('ur');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Yiddish', () => {
      mockGetUILanguage.mockReturnValue('yi');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Kurdish (Sorani)', () => {
      mockGetUILanguage.mockReturnValue('ckb');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Sindhi', () => {
      mockGetUILanguage.mockReturnValue('sd');
      expect(isRTL()).toBe(true);
    });

    it('returns true for Pashto', () => {
      mockGetUILanguage.mockReturnValue('ps');
      expect(isRTL()).toBe(true);
    });

    // LTR言語テスト
    it('returns false for English', () => {
      mockGetUILanguage.mockReturnValue('en');
      expect(isRTL()).toBe(false);
    });

    it('returns false for regional English', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(isRTL()).toBe(false);
    });

    it('returns false for Japanese', () => {
      mockGetUILanguage.mockReturnValue('ja');
      expect(isRTL()).toBe(false);
    });

    it('returns false for regional Japanese', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(isRTL()).toBe(false);
    });

    it('returns false for Chinese', () => {
      mockGetUILanguage.mockReturnValue('zh');
      expect(isRTL()).toBe(false);
    });

    it('returns false for Korean', () => {
      mockGetUILanguage.mockReturnValue('ko');
      expect(isRTL()).toBe(false);
    });

    it('returns false for Spanish', () => {
      mockGetUILanguage.mockReturnValue('es');
      expect(isRTL()).toBe(false);
    });

    it('returns false for French', () => {
      mockGetUILanguage.mockReturnValue('fr');
      expect(isRTL()).toBe(false);
    });

    it('returns false for German', () => {
      mockGetUILanguage.mockReturnValue('de');
      expect(isRTL()).toBe(false);
    });

    it('returns false for an unknown locale', () => {
      mockGetUILanguage.mockReturnValue('xx');
      expect(isRTL()).toBe(false);
    });

    // 明示的なロケール指定テスト
    it('judges with the given locale when a locale parameter is specified', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(isRTL('ar')).toBe(true);
      expect(isRTL('ja')).toBe(false);
    });
  });

  describe('formatDate', () => {
    it('formats the date correctly', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11');
      const result = formatDate(date);
      expect(result).toContain('2026');
      expect(result).toContain('02');
      expect(result).toContain('11');
    });

    it('uses the current date and time for null input', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const result = formatDate(null as unknown as Date);
      expect(typeof result).toBe('string');
    });

    it('uses the current date and time for undefined input', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const result = formatDate(undefined);
      expect(typeof result).toBe('string');
    });

    it('uses the current date and time for an invalid date', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const result = formatDate('invalid-date' as any);
      expect(result).toBeTruthy();
    });

    it('applies custom options', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11');
      const result = formatDate(date, { year: 'numeric', month: 'short' });
      expect(result).toBeTruthy();
    });

    it('accepts a numeric timestamp', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const timestamp = Date.now();
      const result = formatDate(timestamp);
      expect(result).toBeTruthy();
    });

    it('accepts a string-form date', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const dateString = '2026-02-11T12:00:00Z';
      const result = formatDate(dateString);
      expect(result).toBeTruthy();
    });
  });

  describe('formatDateTime', () => {
    it('formats the date and time correctly', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11T14:30:00');
      const result = formatDateTime(date);
      expect(result).toBeTruthy();
      expect(result).toContain('2026');
    });

    it('uses the current date and time for null input', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const result = formatDateTime(null as unknown as Date);
      expect(typeof result).toBe('string');
    });

    it('applies custom options', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const date = new Date('2026-02-11T14:30:00');
      const result = formatDateTime(date, { hour: '2-digit', minute: '2-digit' });
      expect(result).toBeTruthy();
    });

    it('uses the current date and time for an invalid date', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const result = formatDateTime('invalid-date' as any);
      expect(result).toBeTruthy();
    });

    it('accepts a string-form date', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const dateString = '2026-02-11T12:00:00Z';
      const result = formatDateTime(dateString);
      expect(result).toBeTruthy();
    });

    it('accepts a numeric timestamp', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      const timestamp = Date.now();
      const result = formatDateTime(timestamp);
      expect(result).toBeTruthy();
    });
  });

  describe('getDateSeparator', () => {
    it('returns a hyphen by default', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      expect(getDateSeparator()).toBe('-');
    });

    it('returns a hyphen for the Japanese locale as well', () => {
      mockGetUILanguage.mockReturnValue('ja-JP');
      expect(getDateSeparator()).toBe('-');
    });

    it('returns a hyphen for the Arabic locale as well', () => {
      mockGetUILanguage.mockReturnValue('ar-SA');
      expect(getDateSeparator()).toBe('-');
    });
  });

  describe('縮合テスト', () => {
    it('verifies the combined locale workflow end to end', () => {
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

  describe('Intl.DateTimeFormat フォールバック', () => {
    const originalIntl = global.Intl;

    afterEach(() => {
      global.Intl = originalIntl;
    });

    it('formatDate: returns the date part of the ISO string when Intl is unavailable', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      global.Intl = {
        ...originalIntl,
        DateTimeFormat: class {
          constructor() {
            throw new Error('Intl not supported');
          }
        } as any
      };

      const date = new Date('2026-03-15T10:30:00Z');
      const result = formatDate(date);
      expect(result).toBe('2026-03-15');
    });

    it('formatDateTime: returns the ISO string when Intl is unavailable', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      global.Intl = {
        ...originalIntl,
        DateTimeFormat: class {
          constructor() {
            throw new Error('Intl not supported');
          }
        } as any
      };

      const date = new Date('2026-03-15T10:30:00.000Z');
      const result = formatDateTime(date);
      expect(result).toBe(date.toISOString());
    });

    it('formatDate: returns the ISO string when toLocaleDateString fails', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const originalToLocaleDateString = Date.prototype.toLocaleDateString;
      Date.prototype.toLocaleDateString = function () {
        throw new Error('format error');
      };

      const date = new Date('2026-03-15T10:30:00Z');
      const result = formatDate(date);
      expect(result).toBe(date.toISOString());

      Date.prototype.toLocaleDateString = originalToLocaleDateString;
    });

    it('formatDateTime: returns the ISO string when toLocaleString fails', () => {
      mockGetUILanguage.mockReturnValue('en-US');
      const originalToLocaleString = Date.prototype.toLocaleString;
      Date.prototype.toLocaleString = function () {
        throw new Error('format error');
      };

      const date = new Date('2026-03-15T10:30:00Z');
      const result = formatDateTime(date);
      expect(result).toBe(date.toISOString());

      Date.prototype.toLocaleString = originalToLocaleString;
    });
  });
});