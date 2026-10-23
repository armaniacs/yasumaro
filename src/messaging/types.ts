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
  /**
   * マスク項目の出現順序インデックス。
   *
   * 単位は**マスク項目（occurrence）単位**で、`sanitizeRegex` / WASM の走査結果を
   * 配列順に並べたときの通し番号。文字オフセットではない（Rust 側
   * `masked_items` の `index` も occurrence 単位で、PBI 2026-10-11-10 で両実装の
   * 一致を実測確認した）。読み手は現在 0 件で、値は E2E とデバッグ用。
   * 文字/バイトオフセットが必要になった時点で別フィールド（例 `offset`）を足し、
   * この `index` をオフセットとして流用しないこと。
   */
  index?: number;
}

/** stripPiiFromMaskedItem(s) 適用後の状態。original を型レベルで持たない。 */
export type StrippedMaskedItem = Omit<MaskedItem, 'original'>;

/**
 * GET_CONTENT の wire 応答型。
 *
 * 所有は messaging 層。旧所在地 `popup/mainTypes.ts` は後方互換の
 * type-only 再エクスポートのみを残す（PBI 2026-09-21-11: popup と
 * messaging の型循環を解消するため本体をこちらへ移動）。
 */
export interface ContentResponse {
  content: string;
  cleansedReason?: 'hard' | 'keyword' | 'both' | 'none';
  cleanseStats?: {
    hardStripRemoved: number;
    keywordStripRemoved: number;
    totalRemoved: number;
  };
  byteStats?: {
    pageBytes: number;
    candidateBytes: number;
    originalBytes: number;
    cleansedBytes: number;
  };
  aiSummaryCleansedStats?: {
    aiSummaryOriginalBytes: number;
    aiSummaryCleansedBytes: number;
    aiSummaryCleansedElements: number;
    aiSummaryCleansedReason: AiSummaryCleansedReason;
    aiSummaryCleansedReasons?: string[];
  };
  /** PBI 05: extraction fallback outcome (REGENERATE_SUMMARY forwards it). */
  fallbackTriggered?: boolean;
  fallbackReason?: string;
}

/** PBI 04 の wire 応答。gate 拒否時のみ needsForce=true（強制再生成の提示用）。 */
export type RegenerateSummaryResponse = RecordingResult & {
  needsForce?: boolean;
};

/**
 * PBI 2026-10-23-08: asking the history wire response. Mirrors the background
 * AskHistoryOutcome: a discriminated union so success and failure narrow apart.
 * A record-less question answers with status 'no_evidence' plus a widening
 * suggestion instead of fabricating an answer.
 */
export type AskHistoryResponse =
  | { success: true; status: 'answered'; answer: string; citations: AskHistoryCitation[] }
  | { success: true; status: 'no_evidence'; suggestion: string }
  | { success: false; error: string };

/** One citation the answer links back to (shape shared with AskEvidence). Producers must always include it (empty array, never undefined): callers narrow on success and read it directly. */
export interface AskHistoryCitation {
  id: number;
  title: string;
  url: string;
  snippet: string;
}

/**
 * PBI 2026-10-23-09: report generation wire response. Mirrors the background
 * ResearchReportOutcome: a discriminated union so success and failure narrow
 * apart. A failure carries the reason in error, never a fake success.
 */
export type ResearchReportResponse =
  | { success: true; recordCount: number; deliveredTo: ('download' | 'obsidian')[] }
  | { success: false; error: string };

/**
 * 記録処理の結果型
 */
export interface RecordingResult {
  success: boolean;
  /** True only when a real AI model produced the summary (PBI 2026-09-22-04 follow-up). */
  aiSucceeded?: boolean;
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
  /** 試行したプロバイダーID（全滅時のみ。PBI 2026-09-22-04 follow-up） */
  attemptedProviders?: string[];
  /** スロット別の失敗詳細（per-provider error trail。同 follow-up） */
  slotFailures?: Array<{ provider: string; model?: string; error: string }>;
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
// protocolVersion stamping lives in MessageTransport.send (Checking Team
// 2026-09-22: System Architect Medium — single owner for version stamping).
import { isValidEnvelopeShape } from './envelopeShape.js';
import type { ExtensionMessage, TestObsidianResponse } from '../background/messageTypes.js';
import type { PrivacyInfo } from '../utils/privacyChecker.js';

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
  /** PBI 05: フォールバック発動理由（triggered 時のみ） */
  fallbackReason?: string;
  /** PBI 03: 同じタブで直前に開いていたページ。遷移記録が有効な場合のみ。 */
  navSourceUrl?: string;
  /** PBI 03: 流入元が検索エンジンだった場合の検索語（PII マスク済み）。 */
  searchQuery?: string;
  cleansedReason?: string;              // コンテンツクレンジング実行理由 (hard/keyword/both/none)
  precomputedMaskedCount?: number;      // 事前計算済みPIIマスク件数（privacy pipeline経由不要時）
  /** PBI 04: UPDATE-in-place target (regenerate) — save step replaces this row. */
  targetEntryId?: number;
  /** PBI 04: policy-owned side-effect skips (regenerate = SQLite only). */
  skipObsidianAppend?: boolean;
  skipLocalMarkdownExport?: boolean;
  /** PBI 2026-10-23-02: seconds of engagement for this visit (valid visit). */
  visitDurationSeconds?: number;
  /** PBI 2026-10-23-02: max scroll percentage reached for this visit. */
  scrollRatioPercent?: number;
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

// ============================================================================
// Type Guards
// ============================================================================

/**
 * メッセージが ServiceWorkerRequest 型か判定する
 *
 * Thin wrapper over `isValidEnvelopeShape` (messaging/envelopeShape.js) —
 * the single source of truth for the envelope shape branches.
 */
export function isServiceWorkerRequest(message: unknown): message is ServiceWorkerRequest {
  return isValidEnvelopeShape(message);
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
// ユーティリティ型
// ============================================================================

/**
 * メッセージタイプからペイロード型を抽出
 *
 * payload の3状態（required / optional / absent）を区別する:
 * - `'payload' extends keyof U` で payload キー自体が無いメンバーを `never` に固定する。
 *   このガードが無いと `{ payload?: infer P }` だけでは absent メンバーが `P = unknown`
 *   にマッチして unknown に退化する。
 * - `Exclude<P, undefined>` で optional プロパティ推論に混入する `undefined` を除去する
 *  （`exactOptionalPropertyTypes: true` 下では `payload?: T` の推論が `T | undefined` になる）。
 */
export type PayloadForType<T extends ExtensionMessage['type']> = Extract<
  ExtensionMessage,
  { type: T }
> extends infer U
  ? 'payload' extends keyof U
    ? U extends { payload?: infer P }
      ? [P] extends [undefined]
        ? never
        : Exclude<P, undefined>
      : never
    : never
  : never;

/**
 * メッセージタイプに応じたレスポンス型定義
 */
export type ResponseForType<T extends ExtensionMessage['type']> =
  T extends 'VALID_VISIT' ? RecordingResult :
  T extends 'REGENERATE_SUMMARY' ? RegenerateSummaryResponse :
  T extends 'ASK_HISTORY' ? AskHistoryResponse :
  T extends 'EXPORT_RESEARCH_REPORT' ? ResearchReportResponse :
  T extends 'CHECK_DOMAIN' ? { success: true; allowed: boolean } :
  T extends 'GET_CONTENT' ? ContentResponse :
  T extends 'FETCH_URL' ? { success: true; data: string; contentType: string | null } :
  T extends 'MANUAL_RECORD' ? RecordingResult :
  T extends 'PREVIEW_RECORD' ? RecordingResult :
  T extends 'SAVE_RECORD' ? RecordingResult :
  T extends 'TEST_CONNECTIONS' ? { success: true; obsidian: { success: boolean; message: string }; ai: { success: boolean; message: string } } :
  T extends 'TEST_OBSIDIAN' ? TestObsidianResponse :
  T extends 'TEST_AI' ? { success: true; ai: { success: boolean; message: string } } :
  T extends 'GET_PRIVACY_CACHE' ? { success: true; cache: [string, PrivacyInfo][] } :
  T extends 'ACTIVITY_UPDATE' ? { success: true } :
  T extends 'SESSION_LOCK_REQUEST' ? { success: true } :
  T extends 'CONTENT_CLEANSING_EXECUTED' ? { success: true } :
  T extends 'PING' ? { success: true } :
  T extends 'PAUSE_RECORDING' ? { success: true; pausedUntil: number } | { success: false; error: string } :
  T extends 'RESUME_RECORDING' ? { success: true } :
  T extends 'GET_PAUSE_STATE' ? { success: true; pausedUntil: number | null } :
  T extends 'REFRESH_LOCAL_MARKDOWN_SCHEDULER' ? { success: true } :
  T extends 'CONSENT_STATE_CHANGED' ? { success: true } :
  T extends 'GENERATE_REVIEW_SUMMARY' ? { success: true; generated: boolean } :
  T extends 'DASHBOARD_SQLITE' ? Record<string, unknown> :
  T extends 'LOG_FORWARD' ? { success: true } :
  T extends 'OW_PROBE_QUERY' ? { success: true; enabled: boolean } :
  // The state handler refuses to write when the probe is disarmed (arming
  // gate, Blue Team review 2026-10-15), so the failure shape is part of the
  // contract — callers must not read `.success` as `true` unconditionally.
  T extends 'OW_PROBE_STATE' ? { success: true } | { success: false; error: string } :
  SuccessResponse;

/**
 * メッセージ送信の型安全ラッパー — now thin alias to MessageTransport (PBI-22)
 */
export async function sendServiceWorkerMessage<T extends ExtensionMessage['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  const { messageTransport } = await import('./messageTransport.js');
  const message = (payload !== undefined ? { type, payload } : { type }) as ExtensionMessage & { type: T };
  const response = await messageTransport.send(message);
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
 *
 * PBI-11 SSOT completion (Checking Team 2026-09-22: System Architect
 * Medium): popup traffic goes through MessageTransport too, so protocol
 * version stamping, type validation, retry, and error mapping stay
 * single-owned. The former inline protocolVersion stamp is redundant —
 * transport.send enriches every message with the same value.
 */
export async function sendFromPopup<T extends ExtensionMessage['type']>(
  type: T,
  payload?: PayloadForType<T>
): Promise<ResponseForType<T>> {
  return sendServiceWorkerMessage(type, payload);
}
