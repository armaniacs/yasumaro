/**
 * messageTypes.ts
 * Service Worker message type constants and discriminated union types.
 * Extracted from service-worker.ts for testability — importing this file
 * does NOT trigger Chrome API side effects.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
// Imported from ai/AIService.js rather than aiClient.js: this module is pulled
// in by every layer (popup, dashboard, content, offscreen), and reaching
// through aiClient.js would drag the whole provider Strategy graph along with
// it. AIService.ts is types-only.
import type { AiTestProgress } from './ai/AIService.js';

// ============================================================================
// Protocol version
// ============================================================================

/**
 * Current Content-SW message protocol version.
 *
 * 正本は src/messaging/protocol.ts。全レイヤーが参照する定数のため、
 * background 層ではなく中立な位置に置いている。
 * ここでは後方互換のために再エクスポートする。
 */
export { CURRENT_PROTOCOL_VERSION } from '../messaging/protocol.js';

// ============================================================================
// Reusable payload fragments
// ============================================================================

/**
 * Byte tracking fields used across multiple message payloads
 * for content size analytics.
 */
interface ByteStatsPayload {
    pageBytes?: number;
    candidateBytes?: number;
    originalBytes?: number;
    cleansedBytes?: number;
    aiSummaryOriginalBytes?: number;
    aiSummaryCleansedBytes?: number;
    aiSummaryCleansedElements?: number;
    aiSummaryCleansedReason?: AiSummaryCleansedReason;
    aiSummaryCleansedReasons?: string[];
}

// ============================================================================
// Individual message types (discriminated by `type`)
// ============================================================================

export type ValidVisitMessage = {
    type: 'VALID_VISIT';
    payload: { content: string; force?: boolean } & ByteStatsPayload;
};

export type CheckDomainMessage = {
    type: 'CHECK_DOMAIN';
};

type GetContentMessage = {
    type: 'GET_CONTENT';
};

export type FetchUrlMessage = {
    type: 'FETCH_URL';
    payload: { url: string };
};

export type ManualRecordMessage = {
    type: 'MANUAL_RECORD';
    payload: { title: string; url: string; content: string; force?: boolean; skipAi?: boolean } & ByteStatsPayload;
};

export type PreviewRecordMessage = {
    type: 'PREVIEW_RECORD';
    payload: { title: string; url: string; content: string; force?: boolean } & ByteStatsPayload;
};

export type SaveRecordMessage = {
    type: 'SAVE_RECORD';
    payload: { title: string; url: string; content: string; force?: boolean; maskedCount?: number } & ByteStatsPayload;
};

export type TestConnectionsMessage = {
    type: 'TEST_CONNECTIONS';
};

export type TestObsidianMessage = {
    type: 'TEST_OBSIDIAN';
    payload?: { apiKey?: string };
};

export type TestAiMessage = {
    type: 'TEST_AI';
    /** Optional correlation id from the initiating Dashboard tab, used to
     * filter progress broadcasts so multiple tabs do not interfere. */
    runId?: string;
};

export type GetPrivacyCacheMessage = {
    type: 'GET_PRIVACY_CACHE';
};

export type ActivityUpdateMessage = {
    type: 'ACTIVITY_UPDATE';
    payload?: Record<string, never>;
};

export type SessionLockRequestMessage = {
    type: 'SESSION_LOCK_REQUEST';
};

export type ContentCleansingExecutedMessage = {
    type: 'CONTENT_CLEANSING_EXECUTED';
    payload: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number };
};

export type PingMessage = {
    type: 'PING';
};

type RefreshLocalMarkdownSchedulerMessage = {
    type: 'REFRESH_LOCAL_MARKDOWN_SCHEDULER';
};

type ConsentStateChangedMessage = {
    type: 'CONSENT_STATE_CHANGED';
};

export type GenerateReviewSummaryMessage = {
    type: 'GENERATE_REVIEW_SUMMARY';
    payload: { periodType: 'weekly' | 'monthly' };
};

/**
 * Log forwarding from contexts without direct chrome.storage/logger access
 * (Offscreen Document, its Worker). See src/offscreen/offscreenLogger.ts.
 */
export type LogForwardMessage = {
    type: 'LOG_FORWARD';
    payload: {
        level: 'warn' | 'error' | 'info';
        message: string;
        details?: Record<string, unknown>;
        source: string;
    };
};

// ============================================================================
// Discriminated union of all extension messages
// ============================================================================

/**
 * Type-safe union of all messages the Service Worker can receive.
 * Discriminate on `type` to narrow to a specific message shape.
 */
import type { DashboardSqliteRequest } from './handlers/dashboardSqliteProtocol.js';
type DashboardSqliteMessage = {
    type: 'DASHBOARD_SQLITE';
    payload?: DashboardSqliteRequest;
};

export type ExtensionMessage = (
    | ValidVisitMessage
    | CheckDomainMessage
    | GetContentMessage
    | FetchUrlMessage
    | ManualRecordMessage
    | PreviewRecordMessage
    | SaveRecordMessage
    | TestConnectionsMessage
    | TestObsidianMessage
    | TestAiMessage
    | GetPrivacyCacheMessage
    | ActivityUpdateMessage
    | SessionLockRequestMessage
    | ContentCleansingExecutedMessage
    | PingMessage
    | RefreshLocalMarkdownSchedulerMessage
    | ConsentStateChangedMessage
    | GenerateReviewSummaryMessage
    | DashboardSqliteMessage
    | LogForwardMessage
) & { protocolVersion: number };

// ============================================================================
// Runtime constants (kept for backward compatibility and runtime checks)
// ============================================================================

// ----------------------------------------------------------------------------
// One-way broadcast messages (Service Worker → extension pages)
// ----------------------------------------------------------------------------
// These are intentionally NOT part of ExtensionMessage / VALID_MESSAGE_TYPES:
// VALID_MESSAGE_TYPES is the set of requests the Service Worker RECEIVES and
// validates. Broadcast messages are pushed FROM the SW and never received by
// it, so including them in that union would force every request handler to
// also deal with a type it never expects. Keeping the type here preserves the
// single source of truth for message contracts; see aiTestProgressNotifier.ts.
export const AI_TEST_PROGRESS_MESSAGE_TYPE = 'AI_TEST_PROGRESS' as const;

export interface AiTestProgressMessage {
    type: typeof AI_TEST_PROGRESS_MESSAGE_TYPE;
    progress: AiTestProgress;
}

export const VALID_MESSAGE_TYPES = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
    // GET_CONTENT is delivered to the CONTENT SCRIPT via chrome.tabs.sendMessage
    // (src/content/extractor.ts), not to the Service Worker — no
    // registry.register('GET_CONTENT', ...) exists and none is needed. It stays
    // in this list (and in ExtensionMessage) so the popup senders and the
    // content-script receiver share one typed contract; the SW's dispatcher
    // simply never sees it.
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
    'CONTENT_CLEANSING_EXECUTED',
    'PING', // Service Worker health check
    'REFRESH_LOCAL_MARKDOWN_SCHEDULER', // Re-run initExportScheduler() after a timing change is saved
    'CONSENT_STATE_CHANGED', // Re-run updateConsentBadge() after accept/decline
    'DASHBOARD_SQLITE', // Dashboard SQLite query/update operations
    'GENERATE_REVIEW_SUMMARY', // Manually trigger weekly/monthly review summary generation
    'LOG_FORWARD', // Log relay from Offscreen Document / its Worker (no direct chrome.storage access)
] as const;

/**
 * Full set of types that content scripts are allowed to send.
 * Canonical SSOT for MessageRouter's trust table — MessageRouter derives
 * its `contentScriptAllowed` Set from this array. Adding a new
 * content-script-allowed type requires editing only this array.
 */
export const CONTENT_SCRIPT_ALLOWED_TYPES = [
    'VALID_VISIT',
    'CONTENT_CLEANSING_EXECUTED',
    'CHECK_DOMAIN',
    'PING',
] as const;

export const NO_PAYLOAD_TYPES = [
    'CHECK_DOMAIN',
    'GET_CONTENT',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'PING',
    'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
    'CONSENT_STATE_CHANGED',
    'TEST_CONNECTIONS',
    'TEST_AI',
] as const;
