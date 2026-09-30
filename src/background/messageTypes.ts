/**
 * messageTypes.ts
 * Service Worker message type constants and discriminated union types.
 * Extracted from service-worker.ts for testability — importing this file
 * does NOT trigger Chrome API side effects.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import type { RegenerateCleanseMode } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';
// Imported from ai/AIService.js rather than aiClient.js: this module is pulled
// in by every layer (popup, dashboard, content, offscreen), and reaching
// through aiClient.js would drag the whole provider Strategy graph along with
// it. AIService.ts is types-only.
import type { AiTestProgress } from './ai/AIService.js';
import type { FailureMetadata } from '../utils/failureTaxonomy.js';

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
    /** PBI 05: extraction fallback outcome (VALID_VISIT carries it end-to-end). */
    fallbackTriggered?: boolean;
    fallbackReason?: string;
    /** Cleansing reason travels with diagnostics (PBI 2026-09-23-12 convergence). */
    cleansedReason?: string;
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
    /** PBI 04: optional one-shot cleanse override (tabs.sendMessage path only). */
    payload?: { cleanseMode?: RegenerateCleanseMode };
};

/** PBI 04: manual AI-summary regeneration against an existing row. */
export type RegenerateSummaryMessage = {
    type: 'REGENERATE_SUMMARY';
    payload: {
        id: number;
        /** The entry's current URL — carried by the dashboard (rows are visible there; the SW has no by-id read). */
        url: string;
        title: string;
        cleanseMode: RegenerateCleanseMode;
        force?: boolean;
    };
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
    /**
     * Form values forwarded so Test Connection evaluates the same loopback
     * rule as a saved config (PBI 2026-09-19-22). Empty fields are filtered
     * by the handler; an empty payload falls back to stored settings.
     */
    payload?: { apiKey?: string; protocol?: string; port?: string; host?: string };
};

export type TestAiMessage = {
    type: 'TEST_AI';
    /** Optional correlation id from the initiating Dashboard tab, used to
     * filter progress broadcasts so multiple tabs do not interfere. */
    runId?: string;
};

/**
 * TEST_OBSIDIAN response.
 *
 * `failure` is optional and present only on failures. Consumers branch on
 * `failure.kind` (network / timeout / …), never on `message`: the Service
 * Worker rewrites every transport error into a sanitized sentence before
 * returning, so a message substring cannot identify the kind and differs
 * per browser (Chrome `Failed to fetch` vs Firefox `NetworkError when
 * attempting to fetch resource`). PBI 2026-09-26-09.
 */
export interface TestObsidianResponse {
    success: true;
    obsidian: {
        success: boolean;
        message: string;
        failure?: FailureMetadata;
    };
}

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

/**
 * Consent accept/decline trigger.
 *
 * INTENTIONAL: this message carries no consent value. Both accept and
 * decline send the identical bare envelope (registered in NO_PAYLOAD_TYPES;
 * PayloadForType resolves to never). Receivers must re-read the current
 * state via getPrivacyConsent() from chrome.storage.
 *
 * Rationale: the SSOT for consent state is chrome.storage. Carrying the
 * value on the message would open a path where a stale value is trusted
 * when message arrival order and storage write order diverge. When the
 * value is needed, read storage.
 */
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
import type { DashboardSqliteRequest } from '../messaging/dashboardSqliteProtocol.js';
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
    | RegenerateSummaryMessage
    | DashboardSqliteMessage
    | LogForwardMessage
) & { protocolVersion: number };

// ============================================================================
// Runtime constants (re-exported from the neutral wire layer)
// ============================================================================

// The canonical definitions live in src/messaging/messageTypeRegistry.ts so
// the wire layer never imports runtime values from background. This module
// keeps re-exporting them for existing importers.
import { AI_TEST_PROGRESS_MESSAGE_TYPE } from '../messaging/messageTypeRegistry.js';
export {
    AI_TEST_PROGRESS_MESSAGE_TYPE,
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ALLOWED_TYPES,
    NO_PAYLOAD_TYPES,
} from '../messaging/messageTypeRegistry.js';

export interface AiTestProgressMessage {
    type: typeof AI_TEST_PROGRESS_MESSAGE_TYPE;
    progress: AiTestProgress;
}
