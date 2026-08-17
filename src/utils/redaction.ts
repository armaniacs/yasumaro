/**
 * redaction.ts
 * コンソールログの機密情報削除モジュール
 * APIキー、パスワードなどの機密情報をログ出力から保護
 *
 * 注意: このモジュールは後方互換性のために維持されている。
 * 新規コードでは sensitiveDataMask.ts を直接使用すること。
 */

import {
  maskSensitiveData as _maskSensitiveData,
  redactHeaderValue as _redactHeaderValue,
  consoleSecureError as _consoleSecureError,
} from './sensitiveDataMask.js';

/**
 * 再帰的に機密情報を削除する
 * @deprecated sensitiveDataMask.ts の maskSensitiveData('full') を使用すること
 */
export function redactSensitiveData(data: unknown, depth = 0): unknown {
  return _maskSensitiveData(data, 'full', depth);
}

/**
 * Reasons that indicate sensitive header values requiring redaction.
 * @deprecated sensitiveDataMask.ts の SENSITIVE_HEADER_REASONS を使用すること
 */
export const SENSITIVE_HEADER_REASONS = ['authorization'] as const;
export type SensitiveHeaderReason = typeof SENSITIVE_HEADER_REASONS[number];

/**
 * Redact header values for sensitive privacy reasons (e.g., Authorization).
 * @deprecated sensitiveDataMask.ts の redactHeaderValue を使用すること
 */
export function redactHeaderValue(headerValue: string, reason: string): string {
  return _redactHeaderValue(headerValue, reason);
}

/**
 * セキュアなエラーログを出力する
 * @deprecated sensitiveDataMask.ts の consoleSecureError を使用すること
 */
export function consoleSecureError(message: string, data?: unknown): void {
  return _consoleSecureError(message, data);
}
