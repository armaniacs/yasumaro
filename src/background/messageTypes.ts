/**
 * messageTypes.ts
 * Service Worker message type constants and discriminated union types.
 * Extracted from service-worker.ts for testability — importing this file
 * does NOT trigger Chrome API side effects.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';

// ============================================================================
// Reusable payload fragments
// ============================================================================

/**
 * Byte tracking fields used across multiple message payloads
 * for content size analytics.
 */
export interface ByteStatsPayload {
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

export type GetContentMessage = {
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

// ============================================================================
// Discriminated union of all extension messages
// ============================================================================

/**
 * Type-safe union of all messages the Service Worker can receive.
 * Discriminate on `type` to narrow to a specific message shape.
 */
export type DashboardSqliteMessage = {
    type: 'DASHBOARD_SQLITE';
    payload?: Record<string, unknown>;
};

export type ExtensionMessage =
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
    | DashboardSqliteMessage;

// ============================================================================
// Runtime constants (kept for backward compatibility and runtime checks)
// ============================================================================

export const VALID_MESSAGE_TYPES = [
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
    'CONTENT_CLEANSING_EXECUTED',
    'PING', // Service Worker health check
    'DASHBOARD_SQLITE', // Dashboard SQLite query/update operations
] as const;

export const CONTENT_SCRIPT_ONLY_TYPES = [
    'VALID_VISIT',
    'CHECK_DOMAIN',
] as const;

export const NO_PAYLOAD_TYPES = [
    'CHECK_DOMAIN',
    'GET_PRIVACY_CACHE',
    'ACTIVITY_UPDATE',
    'SESSION_LOCK_REQUEST',
    'PING',
] as const;
