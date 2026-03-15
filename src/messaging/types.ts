/**
 * TypeScript型安全メッセージパッシングの定義
 *
 * このファイルは、chrome.runtime.sendMessage 等のメッセージパッシングを
 * TypeScriptのdiscriminated unionsで型安全にするための定義を提供します。
 */

// ============================================================================
// Request メッセージ型定義
// ============================================================================

/**
 * Service Worker 宛てのリクエストメッセージ型
 */
export type ServiceWorkerRequest =
  | { type: 'VALID_VISIT'; payload: { content: string } }
  | { type: 'CHECK_DOMAIN'; payload?: never }
  | { type: 'GET_CONTENT'; payload: never }
  | { type: 'FETCH_URL'; payload: { url: string } }
  | { type: 'MANUAL_RECORD'; payload: { title: string; url: string; content: string; force?: boolean; skipAi?: boolean } }
  | { type: 'PREVIEW_RECORD'; payload: { title: string; url: string; content: string } }
  | { type: 'SAVE_RECORD'; payload: never }
  | { type: 'TEST_CONNECTIONS'; payload: never }
  | { type: 'TEST_OBSIDIAN'; payload: never }
  | { type: 'TEST_AI'; payload: never }
  | { type: 'GET_PRIVACY_CACHE'; payload?: never }
  | { type: 'ACTIVITY_UPDATE'; payload?: never }
  | { type: 'SESSION_LOCK_REQUEST'; payload?: never }
  | { type: 'CONTENT_CLEANSING_EXECUTED'; payload: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number } };

// ============================================================================
// Response メッセージ型定義
// ============================================================================

/**
 * 処理成功時のレスポンス
 */
export interface SuccessResponse {
  success: true;
  data: unknown;
}

/**
 * 処理失敗時のレスポンス
 */
export interface ErrorResponse {
  success: false;
  error: string;
  errorCode?: string;
}

/**
 * 送信者情報
 */
export interface SenderInfo {
  id?: number;
  url?: string;
}

/**
 * メッセージ受信時に送信者情報から抽出した情報
 */
export interface MessageContext {
  tabId?: number;
  tabUrl?: string;
  isValidSender: boolean;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * メッセージが ServiceWorkerRequest 型か判定する
 */
export function isServiceWorkerRequest(message: unknown): message is ServiceWorkerRequest {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const msg = message as { type?: string; payload?: unknown };
  const validTypes = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
    'GET_CONTENT',
    'FETCH_URL',
    'MANUAL_RECORD',
    'PREVIEW_RECORD',
    'SAVE_RECORD',
    'TEST_CONNECTIONS',
    'TEST_OBSIDIAN',
    'TEST_AI',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'CONTENT_CLEANSING_EXECUTED'
  ];

  if (!msg.type || !validTypes.includes(msg.type)) {
    return false;
  }

  // CHECK_DOMAIN, GET_PRIVACY_CACHE, ACTIVITY_UPDATE, SESSION_LOCK_REQUEST は payload 不許可
  const noPayloadTypes = ['CHECK_DOMAIN', 'GET_PRIVACY_CACHE', 'ACTIVITY_UPDATE', 'SESSION_LOCK_REQUEST'];

  if (noPayloadTypes.includes(msg.type)) {
    return msg.payload === undefined;
  }

  return msg.payload !== undefined && typeof msg.payload === 'object';
}

/**
 * レスポンスが成功レスポンスか判定する
 */
export function isSuccessResponse(response: unknown): response is SuccessResponse {
  return !!response && typeof response === 'object' && 'success' in response && (response as any).success === true;
}

/**
 * レスポンスがエラーレスポンスか判定する
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return !!response && typeof response === 'object' && 'success' in response && (response as any).success === false;
}

// ============================================================================
// 発信者情報から Context を抽出
// ============================================================================

/**
 * chrome.runtime.MessageSender からコンテキスト情報を抽出
 */
export function extractMessageContent(sender: chrome.runtime.MessageSender): MessageContext {
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url;

  // VALID_VISIT, CHECK_DOMAIN are only allowed from Content Scripts
  // Returns true if sender is a content script (all of tab, tab.id, tab.url exist)
  const isContentScriptSender = !!(sender.tab && sender.tab.id && sender.tab.url);

  return {
    tabId,
    tabUrl,
    // isValidSender: Allow all messages from popup/dashboard (no tab)
    // VALID_VISIT, CHECK_DOMAIN are restricted to content scripts only (checked separately in service-worker.ts)
    isValidSender: true
  };
}

// ============================================================================
// ユーティリティ型
// ============================================================================

/**
 * メッセージタイプからペイロード型を抽出
 */
export type PayloadForType<T extends ServiceWorkerRequest['type']> = Extract<
  ServiceWorkerRequest,
  { type: T }
>['payload'];

/**
 * メッセージタイプに応じたレスポンス型定義
 */
export type ResponseForType<T extends ServiceWorkerRequest['type']> =
  T extends 'VALID_VISIT' ? RecordingResult :
  T extends 'CHECK_DOMAIN' ? { success: true; allowed: boolean } :
  T extends 'MANUAL_RECORD' ? RecordingResult :
  T extends 'PREVIEW_RECORD' ? RecordingResult :
  SuccessResponse;

/**
 * 記録処理の結果型
 */
export interface RecordingResult {
  success: boolean;
  message: string;
  url?: string;
  timestamp?: number;
}

/**
 * メッセージ送信の型安全ラッパー
 */
export async function sendServiceWorkerMessage<T extends ServiceWorkerRequest['type']>(
  type: T,
  payload: PayloadForType<T>
): Promise<ResponseForType<T>> {
  const response = await chrome.runtime.sendMessage({ type, payload } as unknown);

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as ResponseForType<T>;
}

/**
 * Content Script から Service Worker へのメッセージ送信
 */
export async function sendFromContentScript<T extends ServiceWorkerRequest['type']>(
  type: T,
  payload: PayloadForType<T>
): Promise<ResponseForType<T>> {
  return sendServiceWorkerMessage(type, payload);
}

/**
 * Popup/Dashboard から Service Worker へのメッセージ送信
 */
export async function sendFromPopup<T extends ServiceWorkerRequest['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  const response = await chrome.runtime.sendMessage({
    type,
    payload: payload ?? {}
  } as unknown);

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as ResponseForType<T>;
}