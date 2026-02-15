/**
 * localeUtils.ts
 *
 * ロケール関連のヘルパー関数を提供します。
 * ユーザーの言語設定を動的に取得し、i18n対応のインフラを提供します。
 */

/**
 * ユーザーロケールを取得します
 *
 * Chrome Extension環境内では chrome.i18n.getUILanguage() を使用します。
 * テスト環境などChrome APIが利用できない場合はフォールバックを返します。
 *
 * @returns {string} ユーザーロケールコード (例: 'ja', 'ja-JP', 'en-US', 'ar')
 */
export function getUserLocale(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      return chrome.i18n.getUILanguage();
    }
  } catch (e) {
    // Chrome APIのアクセスに失敗した場合
    console.warn('Failed to get user locale:', e);
  }
  // フォールバック: デフォルトは英語
  return 'en-US';
}

/**
 * RTL（右から左へ書く）言語かどうかを判定します
 *
 * @param {string} locale - 判定するロケールコード（省略時は現在のユーザーロケール）
 * @returns {boolean} RTL言語の場合はtrue、それ以外はfalse
 */
export function isRTL(locale?: string): boolean {
  const targetLocale = locale || getUserLocale();
  const localeCode = targetLocale.toLowerCase().split('-')[0];

  // RTL言語リスト（主要なRTL言語）
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'yi', 'ckb', 'sd', 'ps'];

  return rtlLanguages.includes(localeCode);
}

/**
 * 日付をユーザーロケールでフォーマットします
 *
 * @param {Date|string|number} date - フォーマットする日付（省略時は現在日時）
 * @param {Intl.DateTimeFormatOptions} options - Intl.DateTimeFormatのオプション（省略時はデフォルト）
 * @returns {string} フォーマットされた日時文字列
 */
export function formatDate(date?: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const locale = getUserLocale();
  const targetDate = date ? new Date(date) : new Date();

  // 不正な日付の場合は現在日時を使用
  if (isNaN(targetDate.getTime())) {
    // console.warn('Invalid date provided, using current date');
    return new Date().toLocaleDateString(locale, options);
  }

  try {
    if (isValidTimeZone()) {
      return targetDate.toLocaleDateString(locale, options || {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } else {
      // Intl APIが未対応の場合のフォールバック
      return targetDate.toISOString().split('T')[0];
    }
  } catch (e) {
    // フォーマット失敗時のフォールバック
    return targetDate.toISOString();
  }
}

/**
 * Intl.DateTimeFormatが使用可能かどうかを判定します
 *
 * @returns {boolean} 使用可能な場合はtrue
 */
function isValidTimeZone(): boolean {
  try {
    // テスト用のフォーマットを試行
    const testDate = new Date();
    new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(testDate);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 日時をユーザーロケールでフォーマットします（時間を含む）
 *
 * @param {Date|string|number} date - フォーマットする日付（省略時は現在日時）
 * @param {Intl.DateTimeFormatOptions} options - Intl.DateTimeFormatのオプション（省略時はデフォルト）
 * @returns {string} フォーマットされた日時文字列
 */
export function formatDateTime(date?: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const locale = getUserLocale();
  const targetDate = date ? new Date(date) : new Date();

  // 不正な日付の場合は現在日時を使用
  if (isNaN(targetDate.getTime())) {
    // console.warn('Invalid date provided, using current date');
    return new Date().toLocaleString(locale, options);
  }

  try {
    if (isValidTimeZone()) {
      return targetDate.toLocaleString(locale, options || {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      // Intl APIが未対応の場合のフォールバック
      return targetDate.toISOString();
    }
  } catch (e) {
    // フォーマット失敗時のフォールバック
    return targetDate.toISOString();
  }
}

/**
 * 日付パス用の区切り文字を取得します
 *
 * ロケールに応じた区切り文字を返します。
 * 将来的にロケールごとのカスタマイズが可能です。
 *
 * @returns {string} 区切り文字（デフォルト: '-'）
 */
export function getDateSeparator(): string {
  // const locale = getUserLocale().toLowerCase();
  // ロケールに応じた区切り文字
  // 将来的に拡張可能
  return '-';
}