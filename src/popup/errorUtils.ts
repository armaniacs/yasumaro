/**
 * errorUtils.ts
 * エラーハンドリング共通モジュール
 */

/**
 * エラーメッセージ定数（Problem #5: キャッシュ追加でパフォーマンス改善）
 */
export const ErrorMessages = {
  /**
   * コネクションエラー（Content Scriptとの通信失敗）
   */
  get CONNECTION_ERROR(): string { return getMsgWithCache('connectionError'); },

  /**
   * ドメインブロックエラー
   */
  get DOMAIN_BLOCKED(): string { return getMsgWithCache('domainBlockedError'); },

  /**
   * 一般エラープレフィックス
   */
  get ERROR_PREFIX(): string { return getMsgWithCache('errorPrefix'); },

  /**
   * 成功メッセージ
   */
  get SUCCESS(): string { return getMsgWithCache('success'); },

  /**
   * キャンセルメッセージ
   */
  get CANCELLED(): string { return getMsgWithCache('cancelled'); },

  /**
   * 不明なエラー
   */
  get UNKNOWN_ERROR(): string { return getMsgWithCache('unknownError'); }
};

/**
 * エラータイプ
 */
export const ErrorType = {
  /** Content Scriptとの通信エラー */
  CONNECTION: 'CONNECTION',
  /** ドメインブロックエラー */
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  /** 一般エラー */
  GENERAL: 'GENERAL'
} as const;

export type ErrorTypeValues = typeof ErrorType[keyof typeof ErrorType];

/**
 * HTMLエスケープ用のエンティティマッピング
 * 問題点3: HTMLエンティティエスケープ関数の追加
 */
const HTML_ESCAPE_MAP: { [key: string]: string } = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;'
};

/**
 * HTMLエンティティエスケープ関数
 * XSS攻撃を防ぐために、HTML文字をエンティティに変換する
 * @param {string} unsafe - エスケープ対象の文字列
 * @returns {string} HTML エンティティにエスケープされた安全な文字列
 * 問題点3: HTMLエンティティエスケープの追加
 */
export function escapeHtml(unsafe: unknown): string {
  if (typeof unsafe !== 'string') {
    return '';
  }

  return unsafe.replace(/[&<>"'/]/g, (match) => HTML_ESCAPE_MAP[match]);
}

/**
 * 内部キーワード定数（モジュールスコープでキャッシュ）
 * Problem #4: 関数呼び出しごとに配列が作成されるのを防ぐためにモジュールレベル定数として定義
 */
const INTERNAL_KEYWORDS = [
  'Internal',
  'implementation',
  'function',
  'module',
  'at ',
  '.js:',
  '.ts:',
  '0x',
  '堆疊',
  'スタック',
  'address:',
  'Address:',
  'Segfault'
];

interface MessagesCache {
  connectionError: string;
  domainBlockedError: string;
  errorPrefix: string;
  success: string;
  cancelled: string;
  unknownError: string;
  forceRecord: string;
  recording: string;
}

/**
 * 翻訳メッセージキャッシュ（Problem #5用）
 * ErrorMessages getterで毎回getMsgが呼ばれないようにキャッシュ
 */
let messagesCache: MessagesCache | null = null;

/**
 * 翻訳メッセージ取得ヘルパー（キャッシュあり）
 */
function getMsgWithCache(key: keyof MessagesCache | string, substitutions?: string | string[]): string {
  // 初回のみメッセージを取得してキャッシュに保存
  if (!messagesCache) {
    messagesCache = {
      connectionError: chrome.i18n.getMessage('connectionError'),
      domainBlockedError: chrome.i18n.getMessage('domainBlockedError'),
      errorPrefix: chrome.i18n.getMessage('errorPrefix'),
      success: chrome.i18n.getMessage('success'),
      cancelled: chrome.i18n.getMessage('cancelled'),
      unknownError: chrome.i18n.getMessage('unknownError'),
      forceRecord: chrome.i18n.getMessage('forceRecord'),
      recording: chrome.i18n.getMessage('recording')
    };
  }

  // Type guard or casting to keyof MessagesCache if key is one of the cached keys
  if (key === 'connectionError') return messagesCache.connectionError;
  if (key === 'domainBlockedError') return messagesCache.domainBlockedError;
  if (key === 'errorPrefix') return messagesCache.errorPrefix;
  if (key === 'success') return messagesCache.success;
  if (key === 'cancelled') return messagesCache.cancelled;
  if (key === 'unknownError') return messagesCache.unknownError;
  if (key === 'forceRecord') return messagesCache.forceRecord;
  if (key === 'recording') return messagesCache.recording;

  return chrome.i18n.getMessage(key, substitutions);
}

/**
 * エラーがコネクションエラーかどうかを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {boolean} コネクションエラーの場合true
 */
export function isConnectionError(error: any): boolean {
  return error?.message ? error.message.includes('Receiving end does not exist') : false;
}

/**
 * ドメインブロックエラー判定用の定数コード
 * background workerとpopup間で共有されるエラー識別子
 */
export const DOMAIN_BLOCKED_ERROR_CODE = 'DOMAIN_BLOCKED';

/**
 * エラーがドメインブロックエラーかどうかを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {boolean} ドメインブロックエラーの場合true
 */
export function isDomainBlockedError(error: any): boolean {
  return error?.message === DOMAIN_BLOCKED_ERROR_CODE;
}

/**
 * エラータイプを判定
 * @param {Error} error - エラーオブジェクト
 * @returns {ErrorType} エラータイプ
 */
export function getErrorType(error: any): ErrorTypeValues {
  if (isConnectionError(error)) {
    return ErrorType.CONNECTION;
  }
  if (isDomainBlockedError(error)) {
    return ErrorType.DOMAIN_BLOCKED;
  }
  return ErrorType.GENERAL;
}

/**
 * エラーメッセージから内部情報を削除する
 * ユーザーに表示する前に内部実装の詳細やデバッグ情報を削除
 * @param {string} message - エラーメッセージ
 * @returns {string} ユーザー向けエラーメッセージ
 * Problem #4: INTERNAL_KEYWORDSをモジュールスコープ定数に移動してパフォーマンス改善
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return '';

  let sanitized = message;

  // 内部キーワードを含む行を削除
  const lines = sanitized.split('\n');
  sanitized = lines.filter(line => {
    return !INTERNAL_KEYWORDS.some(keyword => line.includes(keyword));
  }).join(' ');

  return sanitized.trim();
}

/**
 * ユーザー向けエラーメッセージを取得
 * @param {Error} error - エラーオブジェクト
 * @returns {string} ユーザー向けエラーメッセージ
 */
export function getUserErrorMessage(error: any): string {
  const type = getErrorType(error);

  switch (type) {
    case ErrorType.CONNECTION:
      return `${ErrorMessages.ERROR_PREFIX} ${ErrorMessages.CONNECTION_ERROR}`;
    case ErrorType.DOMAIN_BLOCKED:
      return ErrorMessages.DOMAIN_BLOCKED;
    default:
      const message = sanitizeErrorMessage(error?.message || '');
      const result = message || ErrorMessages.UNKNOWN_ERROR;
      return `${ErrorMessages.ERROR_PREFIX} ${result}`;
  }
}

/**
 * エラーをステータス要素に表示
 * @param {HTMLElement} statusElement - ステータス要素
 * @param {Error} error - エラーオブジェクト
 * @param {Function} onForceRecord - 強制記録コールバック
 */
export function showError(statusElement: HTMLElement, error: any, onForceRecord: (() => void) | null = null): void {
  // エラークラスを設定
  statusElement.className = 'error';

  // ステータス要素をクリア
  statusElement.textContent = '';

  const type = getErrorType(error);

  if (type === ErrorType.DOMAIN_BLOCKED && onForceRecord) {
    // ドメインブロックエラー - 強制記録ボタンを表示
    statusElement.textContent = ErrorMessages.DOMAIN_BLOCKED;
    createForceRecordButton(statusElement, onForceRecord);
  } else {
    // その他のエラー - メッセージを表示
    statusElement.textContent = getUserErrorMessage(error);
  }
}

/**
 * 成功メッセージを表示
 * @param {HTMLElement} statusElement - ステータス要素
 * @param {string} message - 成功メッセージ（オプション）
 */
export function showSuccess(statusElement: HTMLElement, message: string = ErrorMessages.SUCCESS): void {
  statusElement.textContent = message;
  statusElement.className = 'success';
}

/**
 * 強制記録ボタンを作成
 * @param {HTMLElement} parentElement - 親要素
 * @param {Function} onClick - クリックハンドラー
 */
function createForceRecordButton(parentElement: HTMLElement, onClick: () => void): void {
  const forceBtn = document.createElement('button');
  forceBtn.textContent = getMsgWithCache('forceRecord');
  forceBtn.className = 'alert-btn';

  forceBtn.onclick = () => {
    forceBtn.disabled = true;
    forceBtn.textContent = getMsgWithCache('recording');
    onClick();
  };

  parentElement.appendChild(forceBtn);
}

interface ErrorHandlers {
  onConnectionError?: (error: any) => void;
  onDomainBlocked?: (error: any) => void;
  onGeneralError?: (error: any) => void;
}

/**
 * エラーハンドリング共通処理
 * @param {Error} error - エラーオブジェクト
 * @param {Object} handlers - ハンドラー設定
 * @param {Function} handlers.onConnectionError - コネクションエラーハンドラー
 * @param {Function} handlers.onDomainBlocked - ドメインブロックエラーハンドラー
 * @param {Function} handlers.onGeneralError - 一般エラーハンドラー
 */
export function handleError(error: any, handlers: ErrorHandlers): void {
  const type = getErrorType(error);

  switch (type) {
    case ErrorType.CONNECTION:
      if (handlers.onConnectionError) {
        handlers.onConnectionError(error);
      }
      break;
    case ErrorType.DOMAIN_BLOCKED:
      if (handlers.onDomainBlocked) {
        handlers.onDomainBlocked(error);
      }
      break;
    default:
      if (handlers.onGeneralError) {
        handlers.onGeneralError(error);
      }
  }
}

/**
 * 処理時間をフォーマット
 * @param ms - ミリ秒単位の時間
 * @returns フォーマットされた文字列 (例: "850ms" or "1.2秒")
 * @example
 * formatDuration(500)   // => "500ms"
 * formatDuration(1234)  // => "1.2秒"
 * formatDuration(-100)  // => "0ms"
 */
export function formatDuration(ms: number): string {
  // Validate input: handle NaN, Infinity, and negative numbers
  if (!Number.isFinite(ms) || ms < 0) {
    return '0ms';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}秒`;
}