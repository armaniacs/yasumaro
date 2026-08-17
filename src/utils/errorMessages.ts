/**
 * errorMessages.ts
 * エラーメッセージの管理と分離
 *
 * 注意: このモジュールは後方互換性のために維持されている。
 * 新規コードでは errorClassification.ts を直接使用すること。
 */

import {
  ErrorType as _ErrorType,
  classifyError as _classifyError,
  getUserMessage as _getUserMessage,
  convertKnownErrorMessage as _convertKnownErrorMessage,
  sanitizeContext as _sanitizeContext,
  type ErrorTypeValues as _ErrorTypeValues,
} from './errorClassification.js';

/**
 * エラータイプの定義
 * @deprecated errorClassification.ts の ErrorType を使用すること
 */
export const ErrorType = _ErrorType;

export type ErrorTypeValues = _ErrorTypeValues;

/**
 * エラーを分類する
 * @deprecated errorClassification.ts の classifyError を使用すること
 */
export function classifyError(error: unknown): ErrorTypeValues {
  return _classifyError(error);
}

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

export interface ErrorResponse {
  success: boolean;
  error: string;
  errorType: ErrorTypeValues;
}

/**
 * エラーレスポンスオブジェクトを作成する
 * @deprecated errorClassification.ts の関数を使用すること
 */
export function createErrorResponse(error: unknown, context: Record<string, unknown> = {}): ErrorResponse {
  const errorType = classifyError(error);
  const userMessage = getUserMessage(error);

  // ログには詳細情報を含める（ただしAPIキーなどの機密情報は除く）
  const err = error instanceof Error ? error : null;
  console.error('[Service Worker Error]', {
    type: errorType,
    name: err?.name,
    message: err?.message,
    context: _sanitizeContext(context)
  });

  // ユーザーには簡潔なメッセージのみ返す
  return {
    success: false,
    error: userMessage,
    errorType: errorType
  };
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
