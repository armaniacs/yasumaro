/**
 * errorClassification.ts
 * エラー分類の統一モジュール。
 * errorMessages.ts と errorUtils.ts の二つの並列システムを統合し、
 * 単一ソースオブトゥルースを提供する。
 */

// ─── Error types ───────────────────────────────────────────────────────

/**
 * 統一エラータイプ定義。
 * errorMessages.ts の ErrorType と errorUtils.ts の ErrorType を統合。
 */
export const ErrorType = {
  NETWORK: 'NETWORK',
  CONNECTION: 'CONNECTION',
  AUTH: 'AUTH',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER: 'SERVER',
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorTypeValues = typeof ErrorType[keyof typeof ErrorType];

// ─── Type guards ───────────────────────────────────────────────────────

/**
 * Type guard for error-like objects (duck-typing for external data)
 */
function isErrorLike(value: unknown): value is { message?: unknown; name?: unknown } {
  return typeof value === 'object' && value !== null && ('message' in value || 'name' in value);
}

/**
 * Type guard for errors with source field (popup error system)
 */
function hasSource(error: unknown): error is { source: string } {
  return typeof error === 'object' && error !== null && 'source' in error;
}

// ─── Classification ────────────────────────────────────────────────────

/**
 * エラーを分類する（統一版）。
 * errorMessages.ts の classifyError と errorUtils.ts の分類ロジックを統合。
 *
 * @param error - 発生したエラー
 * @returns エラータイプ
 */
export function classifyError(error: unknown): ErrorTypeValues {
  if (!error) return ErrorType.UNKNOWN;

  // Popup の source ベース分類を優先
  if (hasSource(error)) {
    switch (error.source) {
      case 'obsidian':
        return ErrorType.SERVER;
      case 'ai':
        return ErrorType.SERVER;
      case 'network':
        return ErrorType.NETWORK;
      case 'user':
        return ErrorType.VALIDATION;
      case 'system':
        return ErrorType.SERVER;
    }
  }

  // 既存のメッセージベース分類
  const err = error instanceof Error ? error : null;
  const errorLike = !err && isErrorLike(error) ? error : null;
  const message = (err?.message ?? (errorLike ? String(errorLike.message) : '')).toLowerCase();
  const name = (err?.name ?? (errorLike ? String(errorLike.name) : '')).toLowerCase();

  // ネットワークエラー
  if (name === 'typeerror' && message.includes('fetch')) {
    return ErrorType.NETWORK;
  }
  if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
    return ErrorType.NETWORK;
  }

  // 認証エラー
  if (message.includes('401') || message.includes('unauthorized') || message.includes('api key')) {
    return ErrorType.AUTH;
  }
  if (message.includes('invalid api key') || message.includes('authentication')) {
    return ErrorType.AUTH;
  }

  // バリデーションエラー
  if (message.includes('invalid') || message.includes('validation') || message.includes('not allowed')) {
    return ErrorType.VALIDATION;
  }

  // ドメインブロック
  if (message.includes('domain') && message.includes('block')) {
    return ErrorType.DOMAIN_BLOCKED;
  }

  // Not Found
  if (message.includes('404') || message.includes('not found')) {
    return ErrorType.NOT_FOUND;
  }

  // レート制限
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many')) {
    return ErrorType.RATE_LIMIT;
  }

  // サーバーエラー
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server')) {
    return ErrorType.SERVER;
  }

  return ErrorType.UNKNOWN;
}

// ─── Message formatting ────────────────────────────────────────────────

/**
 * i18nメッセージ取得関数の型。
 * errorMessages.ts は chrome.i18n.getMessage、
 * errorUtils.ts はキャッシュ付きの getMessage を使用する。
 */
export type I18nGetter = (key: string, substitutions?: string | string[]) => string;

/**
 * エラータイプに対応するi18nキーを取得する。
 */
export function getErrorI18nKey(errorType: ErrorTypeValues): string {
  switch (errorType) {
    case ErrorType.NETWORK:
    case ErrorType.CONNECTION:
      return 'errorNetwork';
    case ErrorType.AUTH:
      return 'errorAuth';
    case ErrorType.VALIDATION:
      return 'errorValidation';
    case ErrorType.NOT_FOUND:
      return 'errorNotFound';
    case ErrorType.RATE_LIMIT:
      return 'errorRateLimit';
    case ErrorType.SERVER:
      return 'errorServer';
    case ErrorType.DOMAIN_BLOCKED:
      return 'errorDomainBlocked';
    case ErrorType.UNKNOWN:
    default:
      return 'errorGeneric';
  }
}

/**
 * ユーザー向けエラーメッセージを取得する。
 *
 * @param error - 発生したエラー
 * @param i18n - i18nメッセージ取得関数（省略時はフォールバックメッセージ）
 * @returns ユーザー向けメッセージ
 */
export function getUserMessage(error: unknown, i18n?: I18nGetter): string {
  const errorType = classifyError(error);
  const key = getErrorI18nKey(errorType);

  if (i18n) {
    return i18n(key) || getFallbackMessage(errorType);
  }

  return getFallbackMessage(errorType);
}

/**
 * i18nが利用できない場合のフォールバックメッセージ。
 */
function getFallbackMessage(errorType: ErrorTypeValues): string {
  switch (errorType) {
    case ErrorType.NETWORK:
    case ErrorType.CONNECTION:
      return 'A network error occurred.';
    case ErrorType.AUTH:
      return 'An authentication error occurred.';
    case ErrorType.VALIDATION:
      return 'Invalid input.';
    case ErrorType.NOT_FOUND:
      return 'Resource not found.';
    case ErrorType.RATE_LIMIT:
      return 'Request limit reached.';
    case ErrorType.SERVER:
      return 'A server error occurred.';
    case ErrorType.DOMAIN_BLOCKED:
      return 'This domain is blocked.';
    case ErrorType.UNKNOWN:
    default:
      return 'An error occurred.';
  }
}

/**
 * 既知のエラーパターンをユーザー向けに変換する。
 *
 * @param errorMessage - 元のエラーメッセージ
 * @param i18n - i18nメッセージ取得関数
 * @returns ユーザー向けメッセージ
 */
export function convertKnownErrorMessage(errorMessage: string, i18n?: I18nGetter): string {
  if (!errorMessage || typeof errorMessage !== 'string') {
    return getUserMessage(null, i18n);
  }

  const lowerMessage = errorMessage.toLowerCase();

  const knownPatterns: Array<{ pattern: RegExp; i18nKey: string }> = [
    { pattern: /url.*not allowed/i, i18nKey: 'errorUrlNotAllowed' },
    { pattern: /domain.*block/i, i18nKey: 'errorDomainBlocked' },
    { pattern: /url.*invalid/i, i18nKey: 'errorInvalidUrlGeneric' },
    { pattern: /obsidian.*connection/i, i18nKey: 'errorObsidianConnection' },
    { pattern: /daily note/i, i18nKey: 'errorDailyNoteSave' },
    { pattern: /ai.*summar/i, i18nKey: 'errorAiSummarize' },
    { pattern: /content.*empty/i, i18nKey: 'errorContentEmpty' },
  ];

  for (const { pattern, i18nKey } of knownPatterns) {
    if (pattern.test(lowerMessage)) {
      if (i18n) {
        return i18n(i18nKey) || `Error: ${pattern}`;
      }
      return `Error: ${pattern}`;
    }
  }

  return getUserMessage({ message: errorMessage, name: 'Error' }, i18n);
}

// ─── Context sanitization ──────────────────────────────────────────────

/**
 * コンテキスト情報から機密情報を削除する。
 */
export function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  if (!context || typeof context !== 'object') return {};

  const sanitized = { ...context };
  const sensitiveKeys = ['apiKey', 'api_key', 'password', 'token', 'secret', 'credential'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}
