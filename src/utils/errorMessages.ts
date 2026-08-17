/**
 * errorMessages.ts
 * @deprecated errorClassification.ts の再エクスポートshim。新規コードでは
 * errorClassification.ts を直接使用すること。
 */

export {
  ErrorType,
  classifyError,
  createErrorResponse,
  type ErrorTypeValues,
  type ErrorResponse,
} from './errorClassification.js';

import {
  getUserMessage as _getUserMessage,
  convertKnownErrorMessage as _convertKnownErrorMessage,
} from './errorClassification.js';

/**
 * ユーザー向けエラーメッセージを取得する
 * @deprecated errorClassification.ts の getUserMessage を使用すること
 */
export function getUserMessage(error: unknown): string {
  // chrome.i18n を直接使用（後方互換性）
  const i18n = (key: string): string => {
    try {
      return chrome.i18n.getMessage(key);
    } catch {
      return '';
    }
  };
  return _getUserMessage(error, i18n);
}

/**
 * 既知のエラーメッセージをユーザー向けに変換する
 * @deprecated errorClassification.ts の convertKnownErrorMessage を使用すること
 */
export function convertKnownErrorMessage(errorMessage: string): string {
  const i18n = (key: string): string => {
    try {
      return chrome.i18n.getMessage(key);
    } catch {
      return '';
    }
  };
  return _convertKnownErrorMessage(errorMessage, i18n);
}
