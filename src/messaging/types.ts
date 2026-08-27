/**
 * TypeScript型安全メッセージパッシングの定義
 *
 * このファイルは、chrome.runtime.sendMessage 等のメッセージパッシングを
 * TypeScriptのdiscriminated unionsで型安全にするための定義を提供します。
 */

// ============================================================================
// RecordingResult、MaskedItem 型定義
// ============================================================================
/**
 * PIIマスキングされた項目の型
 * @internal
 * WARNING: original フィールドには生のPIIデータが含まれる可能性があります。
 * このフィールドはデバッグ目的のみで使用し、本番環境では絶対に使用しないでください。
 * ストレージ保存やログ出力前に必ず stripPiiFromMaskedItem/Items 関数で削除してください
 * （戻り値は StrippedMaskedItem — original を型レベルで持たない）。
 */
export interface MaskedItem {
  type: string;       // マスク項目の種類（例: "email", "creditCard", "phoneJp", "myNumber", "bankAccount"）
  position?: string;  // コンテンツ内の一般的な位置（例: "header", "body"）
  original: string;   // 元の値（デバッグ用、本番環境では使用しない）@internal
  index?: number;     // マスク項目の出現順序インデックス
}

/** stripPiiFromMaskedItem(s) 適用後の状態。original を型レベルで持たない。 */
export type StrippedMaskedItem = Omit<MaskedItem, 'original'>;

/**
 * MaskedItem 型ガード関数
 * unknown 型から MaskedItem 型かどうかを判定する
 * @param item - 判定対象のアイテム
 * @returns MaskedItem 型の場合は true
 */
export function isMaskedItem(item: unknown): item is MaskedItem {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return false;
  }
  
  // Cast to Record<string, unknown> to safely access object properties
  const maskedItem: Record<string, unknown> = item as Record<string, unknown>;
  
  // Required type property - must be a string and one of the known types
  if (!('type' in maskedItem) || typeof maskedItem.type !== 'string') {
    return false;
  }
  
  // Validate type is one of the known MaskedItem types
  const validTypes = ['email', 'creditCard', 'phoneJp', 'myNumber', 'bankAccount', 'price'];
  if (!validTypes.includes(maskedItem.type)) {
    return false;
  }
  
  // Optional position property
  if ('position' in maskedItem && maskedItem.position !== undefined && typeof maskedItem.position !== 'string') {
    return false;
  }
  
  // original property (required on MaskedItem, absent on StrippedMaskedItem)
  if ('original' in maskedItem && typeof maskedItem.original !== 'string') {
    return false;
  }

  // Optional index property
  if ('index' in maskedItem && maskedItem.index !== undefined && typeof maskedItem.index !== 'number') {
    return false;
  }
  
  return true;
}

/**
 * 記録処理の結果型
 */
export interface RecordingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string;
  summary?: string;
  title?: string;
  url?: string;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: (string | StrippedMaskedItem)[]; // マスクされたPII項目のリスト（original はストリップ済み）
  /** クラウドAI要約の実処理時間 (ミリ秒) — クラウドAIが呼ばれなかった場合は undefined */
  aiDuration?: number;
  /** AI要約に使用したプロバイダー識別子 (例: "openai", "gemini") — undefined の場合は不明 */
  aiProvider?: string;
  /** Obsidian保存時間 (ミリ秒) — undefined の場合は Obsidian 未保存 */
  obsidianDuration?: number;
  /** Local Markdown保存時間 (ミリ秒) — undefined の場合はローカル書き出し未実行 */
  localMarkdownDuration?: number;
  confirmationRequired?: boolean;
  headerValue?: string;
  message?: string;  // 後方互換性用
  timestamp?: number;  // 後方互換性用
  tags?: string[];  // AI要約タグ
  sentTokens?: number;
  receivedTokens?: number;
  originalTokens?: number;
  cleansedTokens?: number;
}

import type { RecordType, AiSummaryCleansedReason } from '../utils/commonTypes.js';
import { CURRENT_PROTOCOL_VERSION, VALID_MESSAGE_TYPES, NO_PAYLOAD_TYPES } from '../background/messageTypes.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import type { ContentResponse } from '../popup/mainTypes.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';
import { pickDefined } from '../utils/objectUtils.js';

/**
 * 記録データ型
 * Pipeline処理用の入力データ
 */
export interface RecordingData {
  title: string;
  url: string;
  content: string;
  force?: boolean;
  skipDuplicateCheck?: boolean;
  alreadyProcessed?: boolean;
  previewOnly?: boolean;
  requireConfirmation?: boolean;
  headerValue?: string;
  recordType?: RecordType;
  maskedCount?: number;
  skipAi?: boolean;
  pageBytes?: number;
  candidateBytes?: number;
  originalBytes?: number;
  cleansedBytes?: number;
  aiSummaryOriginalBytes?: number;
  aiSummaryCleansedBytes?: number;
  aiSummaryCleansedElements?: number;
  aiSummaryCleansedReason?: AiSummaryCleansedReason;
  aiSummaryCleansedReasons?: string[];  // 複数理由の詳細リスト（multiple時）
  fallbackTriggered?: boolean;          // NEW: フォールバックが発動したか
  cleansedReason?: string;              // コンテンツクレンジング実行理由 (hard/keyword/both/none)
  precomputedMaskedCount?: number;      // 事前計算済みPIIマスク件数（privacy pipeline経由不要時）
}

// ============================================================================
// Request メッセージ型定義
// ============================================================================

/**
 * Service Worker 宛てのリクエストメッセージ型
 *
 * SSOT: messageTypes.ts で定義された ExtensionMessage をそのまま再エクスポートする。
 * これにより新メッセージ種別追加時の二重管理を防ぐ。
 */
export type ServiceWorkerRequest = ExtensionMessage;

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

  if (!msg.type || !VALID_MESSAGE_TYPES.includes(msg.type as typeof VALID_MESSAGE_TYPES[number])) {
    return false;
  }

  const type = msg.type;

  if (NO_PAYLOAD_TYPES.includes(type as typeof NO_PAYLOAD_TYPES[number])) {
    return msg.payload === undefined;
  }

  // Types with optional object payloads
  if (type === 'TEST_OBSIDIAN' || type === 'DASHBOARD_SQLITE') {
    return msg.payload === undefined || (typeof msg.payload === 'object' && msg.payload !== null);
  }

  return msg.payload !== undefined && typeof msg.payload === 'object';
}

/**
 * レスポンスが成功レスポンスか判定する
 */
export function isSuccessResponse(response: unknown): response is SuccessResponse {
  if (!response || typeof response !== 'object') {
    return false;
  }
  const obj = response as Record<string, unknown>;
  return 'success' in obj && obj.success === true;
}

/**
 * レスポンスがエラーレスポンスか判定する
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  if (!response || typeof response !== 'object') {
    return false;
  }
  const obj = response as Record<string, unknown>;
  return 'success' in obj && obj.success === false;
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
  const _isContentScriptSender = !!(sender.tab && sender.tab.id && sender.tab.url);

  return {
    ...pickDefined({ tabId, tabUrl }),
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
export type PayloadForType<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
> extends infer U
  ? U extends { payload: infer P }
    ? P
    : never
  : never;

/**
 * メッセージタイプに応じたレスポンス型定義
 */
export type ResponseForType<T extends ExtensionMessage['type']> =
  T extends 'VALID_VISIT' ? RecordingResult :
  T extends 'CHECK_DOMAIN' ? { success: true; allowed: boolean } :
  T extends 'GET_CONTENT' ? ContentResponse :
  T extends 'FETCH_URL' ? { success: true; data: string; contentType: string | null } :
  T extends 'MANUAL_RECORD' ? RecordingResult :
  T extends 'PREVIEW_RECORD' ? RecordingResult :
  T extends 'SAVE_RECORD' ? RecordingResult :
  T extends 'TEST_CONNECTIONS' ? { success: true; obsidian: { success: boolean; message: string }; ai: { success: boolean; message: string } } :
  T extends 'TEST_OBSIDIAN' ? { success: true; obsidian: { success: boolean; message: string } } :
  T extends 'TEST_AI' ? { success: true; ai: { success: boolean; message: string } } :
  T extends 'GET_PRIVACY_CACHE' ? { success: true; cache: [string, PrivacyInfo][] } :
  T extends 'ACTIVITY_UPDATE' ? { success: true } :
  T extends 'SESSION_LOCK_REQUEST' ? { success: true } :
  T extends 'CONTENT_CLEANSING_EXECUTED' ? { success: true } :
  T extends 'PING' ? { success: true } :
  T extends 'REFRESH_LOCAL_MARKDOWN_SCHEDULER' ? { success: true } :
  T extends 'CONSENT_STATE_CHANGED' ? { success: true } :
  T extends 'GENERATE_REVIEW_SUMMARY' ? { success: true; generated: boolean } :
  T extends 'DASHBOARD_SQLITE' ? Record<string, unknown> :
  T extends 'LOG_FORWARD' ? { success: true } :
  SuccessResponse;

/**
 * メッセージ送信の型安全ラッパー — now thin alias to MessageTransport (PBI-22)
 */
export async function sendServiceWorkerMessage<T extends ExtensionMessage['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  const { messageTransport } = await import('./messageTransport.js');
  const message = payload !== undefined
    ? { type, payload } as unknown as ExtensionMessage & { type: T }
    : { type } as unknown as ExtensionMessage & { type: T };
  const response = await messageTransport.send(message as ExtensionMessage);
  if (isErrorResponse(response)) {
    throw new Error((response as { error: string }).error);
  }
  return response as ResponseForType<T>;
}

/**
 * Content Script から Service Worker へのメッセージ送信 — alias
 */
export async function sendFromContentScript<T extends ExtensionMessage['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  return sendServiceWorkerMessage(type, payload);
}

/**
 * Popup/Dashboard から Service Worker へのメッセージ送信 — alias
 */
export async function sendFromPopup<T extends ExtensionMessage['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  const message = payload !== undefined
    ? { type, payload, protocolVersion: CURRENT_PROTOCOL_VERSION }
    : { type, protocolVersion: CURRENT_PROTOCOL_VERSION };
  const response = await chrome.runtime.sendMessage(message as unknown);

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as ResponseForType<T>;
}