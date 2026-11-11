/**
 * localeUtils.ts
 *
 * ロケール関連のヘルパー関数を提供します。
 * ユーザーの言語設定を動的に取得し、i18n対応のインフラを提供します。
 */

import { logWarn } from './logger/api.js';
import { ErrorCode } from './logger/types.js';
import { errorMessage } from './errorUtils.js';
import { getMessage, getMessageOr } from './i18n.js';
import { getPluralKey } from './i18nPlural.js';

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
    void logWarn('Failed to get user locale', { error: errorMessage(e) }, ErrorCode.INTERNAL_ERROR, 'localeUtils');
  }
  // フォールバック: デフォルトは英語
  return 'en-US';
}

/**
 * Project the canonical UI locale onto the two supported document languages.
 *
 * This is the single owner of the ja/en decision for the whole extension. It is
 * derived from `getUserLocale()` (`chrome.i18n.getUILanguage()`), the same source
 * `getMessage()` uses, so prompt defaults can never disagree with the language of
 * the surrounding labels. Do not re-derive it from `navigator.language`.
 *
 * @returns {'ja' | 'en'} Document language to use for prompt defaults and text
 */
export function getUiLanguage(): 'ja' | 'en' {
  return getUserLocale().toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/**
 * RTL（右から左へ書く）言語かどうかを判定します
 *
 * @param {string} locale - 判定するロケールコード（省略時は現在のユーザーロケール）
 * @returns {boolean} RTL言語の場合はtrue、それ以外はfalse
 */
export function isRTL(locale?: string): boolean {
  const targetLocale = locale || getUserLocale();
  const localeCode = targetLocale.toLowerCase().split('-')[0] ?? '';

  // RTL言語リスト（正本）。ckb / sd / ps はアラビア系派生、ku は Chrome UI
  // ロケールで Sorani（アラビア文字）を指し、dv は Thaana 文字。いずれも右向き。
  const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'yi', 'ckb', 'sd', 'ps', 'ku', 'dv'];

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
      return targetDate.toISOString().split('T')[0] ?? '';
    }
  } catch (_e) {
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
  } catch (_e) {
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
  } catch (_e) {
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

/**
 * 相対時刻 + 絶対時刻のペア (PBI 2026-11-11-05)。
 *
 * 正規の置き場所はこのモジュール。`src/popup/statusChecker.ts` は
 * 再exportする互換ラッパーであり、実装はここに一本化されている。
 */
export interface TimeFormat {
  timeAgo: string;
  formatted: string;
}

/**
 * 相対時刻と絶対時刻を同時に取得します (PBI 2026-11-11-05)。
 *
 * `src/popup/statusChecker.ts` からの逐語移動。表示文字列不変のため、
 * 相対部の i18n キー解決も絶対部の手組み (`HH:MM` / `MM/DD HH:MM`) も
 * 一切変えていない。
 *
 * @param {number} timestamp - 基準となる epoch-ms
 * @returns {TimeFormat} 相対表示と絶対表示のペア
 */
export function formatTimeAgo(timestamp: number): TimeFormat {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);

  // 相対時間
  // 意図的な英文フォールバック: locale バンドルにキーが無い場合の最終防衛で、
  // 未翻訳の放置ではない (getMessageOr 契約。privacy.ts の loadPrivacyPolicy
  // エラー表示と同規約)。
  let timeAgo: string;
  if (diff < 60 * 1000) {
    timeAgo = getMessageOr('timeJustNow', 'Just now');
  } else if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    const msg = getMessage(getPluralKey('timeMinutesAgo', minutes), { count: minutes });
    timeAgo = msg || `${minutes} minutes ago`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const msg = getMessage(getPluralKey('timeHoursAgo', hours), { count: hours });
    timeAgo = msg || `${hours} hours ago`;
  } else if (diff < 48 * 60 * 60 * 1000) {
    timeAgo = getMessageOr('timeYesterday', 'Yesterday');
  } else {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const msg = getMessage(getPluralKey('timeDaysAgo', days), { count: days });
    timeAgo = msg || `${days} days ago`;
  }

  // 絶対時間
  const today = new Date(now);
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  let formatted: string;

  if (isToday) {
    formatted = `${hours}:${minutes}`;
  } else {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    formatted = `${month}/${day} ${hours}:${minutes}`;
  }

  return { timeAgo, formatted };
}

/**
 * 短い月日+時刻表示 (PBI 2026-11-11-05)。
 *
 * 正規seam。`pendingRowRenderer.formatTimestamp` はこの委譲ラッパーであり、
 * 既存 importer (sqliteHistoryPanelView 経由の savedCollectionsPanelView を
 * 含む) は公開名のまま動き続ける。
 *
 * 等価性 pin: `new Date(ts).toLocaleString(undefined, { month: 'short',
 * day: 'numeric', hour: '2-digit', minute: '2-digit' })` とバイト等価。
 * locale ソースの正規化 (undefined → chrome UI 言語) は表示文字列を変えうる
 * ため本 PBI では行わない (台帳送り)。
 *
 * @param {number} ts - epoch-ms
 * @returns {string} 短い日時文字列 (例: "Feb 11, 2:30 PM")
 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 既定ロケール・既定オプションの日時表示 (PBI 2026-11-11-05)。
 *
 * 旧 inline `new Date(x).toLocaleString()` 群 (cleansingFeedbackView /
 * exportImport / diagnosticsPanel / researchSessionsPanel 範囲行) の置換先
 * seam。元式とバイト等価。
 *
 * @param {Date|string|number} value - フォーマットする日時
 * @returns {string} 既定ロケール表示の日時文字列
 */
export function formatLocaleDateTime(value: Date | string | number): string {
  return new Date(value).toLocaleString();
}

/**
 * 中形式の日付+短形式時刻の表示 (PBI 2026-11-11-05)。
 *
 * 旧 researchSessionsPanel:190
 * `new Date(session.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`
 * の置換先 seam。元式とバイト等価。
 *
 * @param {Date|string|number} value - フォーマットする日時
 * @returns {string} 中形式日付+短形式時刻の文字列
 */
export function formatMediumDateTime(value: Date | string | number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}