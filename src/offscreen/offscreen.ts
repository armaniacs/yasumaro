/**
 * offscreen.ts
 * Handles SQLite database operations in an offscreen document.
 *
 * Prompt API (window.ai / LanguageModel) is no longer handled here — Built-in AI
 * calls LanguageModel directly from the Service Worker (src/background/builtInAIClient.ts).
 * See dev-docs/2026-07-28-built-in-ai-provider-integration-design.md for the rationale.
 */

import { engine } from './sqliteEngineContext.js';
import {
  insert as sqliteInsert,
  insertBatch as sqliteInsertBatch,
  query as sqliteQuery,
  update as sqliteUpdate,
  hardDelete as sqliteHardDelete,
  toggleStar as sqliteToggleStar,
  getCount as sqliteGetCount,
  getStatus as sqliteGetStatus,
  serialize as sqliteSerialize,
  clearAll as sqliteClearAll,
} from './recordsRepo.js';
import {
  sqliteHealthCheck,
  backupDb as sqliteBackupDb,
  restoreDb as sqliteRestoreDb,
  purgeOldRecords as sqlitePurgeOldRecords,
  purgeContent as sqlitePurgeContent,
} from './dbMaintenance.js';
import {
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
} from './auditLogRepo.js';
import { errorMessage } from '../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { forwardWarn, forwardError } from './offscreenLogger.js';
import { pickDefined } from '../utils/objectUtils.js';

import { StorageKeys } from '../utils/storage/types.js';
import { isSqliteMessageType, type SqliteMessage } from '../messaging/sqliteMessages.js';

// Payload size guards (security cross-cutting)
const MAX_FIELD_BYTES = 1_024 * 1_024; // 1MB per field
const MAX_BATCH_RECORDS = 2000;
const MAX_BATCH_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB of summary text across the batch
function isFieldTooLarge(v: unknown): boolean { return typeof v === 'string' && v.length > MAX_FIELD_BYTES; }
function fieldLimitError(field: string): string { return `Payload too large: ${field} exceeds 1MB limit`; }

// For testing only - reset SQLite state
export const _resetSqliteForTesting = (): void => {
    engine.resetForTesting();
};

// Helper: extract BrowsingLogRecord fields from an untrusted payload.
// Explicit mapping ensures type safety and prevents SQL injection via raw spread.
function buildRecordFromPayload(payload: Record<string, unknown>): BrowsingLogRecord {
  return {
    url: String(payload.url || ''),
    title: payload.title != null ? String(payload.title) : null,
    summary: payload.summary != null ? String(payload.summary) : null,
    tags: payload.tags != null ? String(payload.tags) : null,
    created_at: Number(payload.created_at || Date.now()),
    domain: payload.domain != null ? String(payload.domain) : null,
    visit_duration: payload.visit_duration != null ? Number(payload.visit_duration) : null,
    scroll_ratio: payload.scroll_ratio != null ? Number(payload.scroll_ratio) : null,
    is_starred: payload.is_starred != null ? Number(payload.is_starred) : 0,
    is_deleted: payload.is_deleted != null ? Number(payload.is_deleted) : 0,
    obsidian_synced: payload.obsidian_synced != null ? Number(payload.obsidian_synced) : 0,
    gist_synced: payload.gist_synced != null ? Number(payload.gist_synced) : 0,
    // PBI-1: diagnostic metadata + PBI-3: content
    content: payload.content != null ? String(payload.content) : null,
    masked_count: payload.masked_count != null ? Number(payload.masked_count) : null,
    cleansed_reason: payload.cleansed_reason != null ? String(payload.cleansed_reason) : null,
    ai_provider: payload.ai_provider != null ? String(payload.ai_provider) : null,
    ai_model: payload.ai_model != null ? String(payload.ai_model) : null,
    ai_duration_ms: payload.ai_duration_ms != null ? Number(payload.ai_duration_ms) : null,
    obsidian_duration_ms: payload.obsidian_duration_ms != null ? Number(payload.obsidian_duration_ms) : null,
    sent_tokens: payload.sent_tokens != null ? Number(payload.sent_tokens) : null,
    received_tokens: payload.received_tokens != null ? Number(payload.received_tokens) : null,
    original_tokens: payload.original_tokens != null ? Number(payload.original_tokens) : null,
    cleansed_tokens: payload.cleansed_tokens != null ? Number(payload.cleansed_tokens) : null,
    page_bytes: payload.page_bytes != null ? Number(payload.page_bytes) : null,
    candidate_bytes: payload.candidate_bytes != null ? Number(payload.candidate_bytes) : null,
    original_bytes: payload.original_bytes != null ? Number(payload.original_bytes) : null,
    cleansed_bytes: payload.cleansed_bytes != null ? Number(payload.cleansed_bytes) : null,
    ai_summary_original_bytes: payload.ai_summary_original_bytes != null ? Number(payload.ai_summary_original_bytes) : null,
    ai_summary_cleansed_bytes: payload.ai_summary_cleansed_bytes != null ? Number(payload.ai_summary_cleansed_bytes) : null,
    extracted_sentences_bytes: payload.extracted_sentences_bytes != null ? Number(payload.extracted_sentences_bytes) : null,
    extracted_sentences_original_bytes: payload.extracted_sentences_original_bytes != null ? Number(payload.extracted_sentences_original_bytes) : null,
    fallback_triggered: payload.fallback_triggered != null ? Number(payload.fallback_triggered) : 0,
  };
}

// Opaque marker produced only by handleOffscreenMessage's sender-authorization
// check (below). dispatchSqliteMessage requires one as a parameter, so a call
// site cannot reach the switch below without having passed that check —
// the coupling is enforced by the type checker, not by convention.
type AuthorizedSqliteSender = { readonly __brand: 'AuthorizedSqliteSender' };

// Dispatch a SqliteMessage (SW↔offscreen, see src/messaging/sqliteMessages.ts) to
// the matching sqlite.js handler and respond via sendResponse.
async function dispatchSqliteMessage(
    _authorized: AuthorizedSqliteSender,
    msg: SqliteMessage,
    sendResponse: (response: unknown) => void
): Promise<void> {
    switch (msg.type) {
        case 'SQLITE_HEALTH_CHECK': {
            const ok = await sqliteHealthCheck();
            sendResponse({ success: ok });
            break;
        }
        case 'SQLITE_INIT': {
            const ok = await engine.init();
            sendResponse({ success: ok, initialized: ok });
            break;
        }
        case 'SQLITE_INSERT': {
            const payload = msg.payload;

            if (isFieldTooLarge(payload.summary)) {
                sendResponse({ success: false, error: fieldLimitError('summary') });
                break;
            }

            const record = buildRecordFromPayload(payload);
            const result = await sqliteInsert(record);
            sendResponse(result);
            break;
        }
        case 'SQLITE_INSERT_BATCH': {
            const rawRecords = msg.payload.records || [];
            // VULN-007: cap batch size to prevent unbounded transaction / memory growth.
            if (!Array.isArray(rawRecords) || rawRecords.length > MAX_BATCH_RECORDS) {
                sendResponse({ success: false, error: `Payload too large: maximum ${MAX_BATCH_RECORDS} records per batch` });
                break;
            }
            let totalSummaryBytes = 0;
            for (const r of rawRecords) {
                if (r && typeof r.summary === 'string') {
                    totalSummaryBytes += r.summary.length;
                }
            }
            if (totalSummaryBytes > MAX_BATCH_TOTAL_BYTES) {
                sendResponse({ success: false, error: 'Payload too large: batch summary exceeds size limit' });
                break;
            }
            const records = rawRecords.map(r => buildRecordFromPayload(r));
            const result = await sqliteInsertBatch(records);
            sendResponse(result);
            break;
        }
        case 'SQLITE_QUERY': {
            const payload = msg.payload;
            const options: import('../utils/sqlite-types.js').StorageQuery = pickDefined({
                limit: payload?.limit != null ? Number(payload.limit) : undefined,
                offset: payload?.offset != null ? Number(payload.offset) : undefined,
                orderBy: payload?.orderBy as 'created_at' | 'rank' | undefined,
                orderDir: payload?.orderDir as 'ASC' | 'DESC' | undefined,
                domain: payload?.domain != null ? String(payload.domain) : undefined,
                starred: payload?.isStarred != null ? Boolean(payload.isStarred) : undefined,
                excludeDeleted: payload?.excludeDeleted != null ? Boolean(payload.excludeDeleted) : undefined,
                dateFrom: payload?.since != null ? Number(payload.since) : undefined,
                dateTo: payload?.until != null ? Number(payload.until) : undefined,
                ids: payload?.ids != null ? payload.ids as number[] : undefined,
                tag: payload?.tagFilter != null ? String(payload.tagFilter) : undefined,
                gistSynced: payload?.gistSynced != null ? Number(payload.gistSynced) : undefined,
            });
            const result = await sqliteQuery(options);
            sendResponse(result);
            break;
        }
        case 'SQLITE_AUDIT_LOG_INSERT': {
            const payload = msg.payload;
            const result = await sqliteInsertAuditLog({
                provider: String(payload.provider || ''),
                url: String(payload.url || ''),
                created_at: Number(payload.created_at || Date.now()),
            });
            sendResponse(result);
            break;
        }
        case 'SQLITE_AUDIT_LOG_QUERY': {
            const payload = msg.payload;
            const result = await sqliteQueryAuditLog(pickDefined({
                limit: payload?.limit != null ? Number(payload.limit) : undefined,
                offset: payload?.offset != null ? Number(payload.offset) : undefined,
            }));
            sendResponse(result);
            break;
        }
        case 'SQLITE_SEARCH': {
            const q: import('../utils/sqlite-types.js').StorageQuery = {
              text: String(msg.payload.query || ''),
              ...pickDefined({
                limit: msg.payload.limit != null ? Number(msg.payload.limit) : undefined,
                offset: msg.payload.offset != null ? Number(msg.payload.offset) : undefined,
                orderBy: msg.payload.orderBy as 'created_at' | 'rank' | undefined,
                orderDir: msg.payload.orderDir as 'ASC' | 'DESC' | undefined,
              }),
            };
            const result = await sqliteQuery(q);
            sendResponse(result);
            break;
        }
        case 'SQLITE_UPDATE': {
            const payload = msg.payload;

            if (isFieldTooLarge(payload.summary)) {
                sendResponse({ success: false, error: fieldLimitError('summary') });
                break;
            }
            if (isFieldTooLarge(payload.content)) {
                sendResponse({ success: false, error: fieldLimitError('content') });
                break;
            }
            if (isFieldTooLarge(payload.title)) {
                sendResponse({ success: false, error: fieldLimitError('title') });
                break;
            }

            const id = Number(payload.id);
            const changes: Record<string, unknown> = {};
            for (const key of [
              'url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio',
              'is_starred', 'is_deleted', 'obsidian_synced', 'gist_synced',
              // PBI-1/PBI-3: allow updating diagnostic metadata + content
              'content', 'masked_count', 'cleansed_reason',
              'ai_provider', 'ai_model', 'ai_duration_ms', 'obsidian_duration_ms',
              'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
              'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
              'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
              'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
              'fallback_triggered',
            ]) {
                if (key in payload) {
                    changes[key] = payload[key];
                }
            }
            const result = await sqliteUpdate(id, changes);
            sendResponse(result);
            break;
        }
        case 'SQLITE_DELETE': {
            const id = Number(msg.payload.id);
            const result = await sqliteHardDelete(id);
            sendResponse(result);
            break;
        }
        case 'SQLITE_TOGGLE_STAR': {
            const id = Number(msg.payload.id);
            const result = await sqliteToggleStar(id);
            sendResponse(result);
            break;
        }
        case 'SQLITE_COUNT': {
            const result = await sqliteGetCount();
            sendResponse(result);
            break;
        }
        case 'SQLITE_STATUS': {
            const result = await sqliteGetStatus();
            if (result.success) {
              // Augment status with OPFS migration state from chrome.storage.local
              // (the migration runs inside the Worker which writes flags to storage).
              try {
                const items = await chrome.storage.local.get([
                  StorageKeys.OPFS_MIGRATION_V2_DONE,
                  StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT,
                  StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT,
                  StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT,
                ]);
                sendResponse({
                  ...result,
                  opfsMigrationV2Done: items[StorageKeys.OPFS_MIGRATION_V2_DONE] ?? false,
                  opfsMigrationV2LastAttemptedAt: items[StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT] ?? null,
                  opfsMigrationV2CompletedAt: items[StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT] ?? null,
                  opfsMigrationV2RecordCount: items[StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT] ?? 0,
                });
              } catch {
                // chrome.storage may be unavailable; omit migration fields
                sendResponse(result);
              }
            } else {
              sendResponse(result);
            }
            break;
        }
        case 'SQLITE_CLEAR_ALL': {
            const result = await sqliteClearAll();
            sendResponse(result);
            break;
        }
        case 'SQLITE_EXPORT': {
            const result = await sqliteSerialize();
            sendResponse(result);
            break;
        }
        case 'SQLITE_BACKUP': {
            const result = await sqliteBackupDb();
            if (result.success && result.data instanceof Uint8Array) {
                sendResponse({ success: true, data: Array.from(result.data) });
            } else {
                sendResponse(result);
            }
            break;
        }
        case 'SQLITE_RESTORE': {
            const rawData = msg.payload.data || [];
            if (rawData.length > 100 * 1024 * 1024) {
                sendResponse({ success: false, error: 'Restore data exceeds maximum size of 100MB' });
                break;
            }
            const data = new Uint8Array(rawData);
            const result = await sqliteRestoreDb(data);
            sendResponse(result.success ? { success: true } : { success: false, error: result.error });
            break;
        }
        case 'SQLITE_PURGE': {
            const payload = msg.payload;
            const result = await sqlitePurgeOldRecords(payload?.retentionDays, payload?.maxRecords);
            sendResponse(result);
            break;
        }
        case 'CONTENT_PURGE': {
            const payload = msg.payload;
            const result = await sqlitePurgeContent(payload?.retentionDays, payload?.maxRecords, payload?.includeStarred);
            sendResponse(result);
            break;
        }
        case 'SQLITE_OPFS_SPIKE': {
            // OPFS feasibility spike (PBI-10). Runs 案A (Worker + AccessHandlePoolVFS),
            // the only viable path since createSyncAccessHandle is Worker-only.
            const { runOpfsSpikeA } = await import('./opfsSpike.js');
            const report = await runOpfsSpikeA();
            sendResponse({ success: true, report });
            break;
        }
        default: {
            // Exhaustiveness check: if a new SqliteMessage variant is added without
            // a case above, this line fails to type-check.
            const _exhaustive: never = msg;
            forwardWarn(`Offscreen: Unknown SQLite message type ${(_exhaustive as SqliteMessage).type}`);
            sendResponse({ success: false, error: 'Unknown message type' });
        }
    }
}

// Handle messages from the service worker
export function handleOffscreenMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
): boolean {
    if (typeof message !== 'object' || message === null || !('target' in message)) return false;
    const msg = message as { target: string; type: string; payload?: Record<string, unknown> };
    if (msg.target !== 'offscreen') return false;

    // Security: SQLite operations must only come from the service worker,
    // not from content scripts running in web pages (which would have a tab)
    // or from external extensions.
    const isSqliteMessage = isSqliteMessageType(msg.type);
    if (isSqliteMessage) {
      // Block content scripts (which have a tab)
      if (_sender.tab) {
        sendResponse({
          success: false,
          error: 'Forbidden: SQLite operations are not available from content scripts.',
        });
        return true;
      }
      // Block external extensions (sender.id must match our extension)
      if (_sender.id !== chrome.runtime.id) {
        sendResponse({
          success: false,
          error: 'Forbidden: SQLite operations are not available from external extensions.',
        });
        return true;
      }
    }

    // Only constructible here, after both checks above have passed — this is
    // the sole authorization proof dispatchSqliteMessage accepts.
    const authorizedSender: AuthorizedSqliteSender = { __brand: 'AuthorizedSqliteSender' };

    (async () => {
        try {
            if (isSqliteMessage) {
                // Cast is safe: isSqliteMessage narrowed msg.type via isSqliteMessageType
                // above, so msg.type is a known SqliteMessageType at this point. Payload
                // shape itself is not runtime-validated here (same trust boundary as
                // before this refactor: the sender is verified to be our own SW).
                await dispatchSqliteMessage(authorizedSender, msg as SqliteMessage, sendResponse);

            } else {
                const traceId = isSqliteMessageType(msg.type) ? (msg as SqliteMessage).traceId : undefined;
                forwardWarn(`Offscreen: Unknown message type ${msg.type}`, {}, 'offscreen', traceId);
                sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (err: unknown) {
            const traceId = isSqliteMessageType(msg.type) ? (msg as SqliteMessage).traceId : undefined;
            forwardError('Offscreen: Unexpected error', { error: errorMessage(err) }, 'offscreen', traceId);
            sendResponse({ success: false, error: errorMessage(err) });
        }
    })();

    return true; // Keep channel open for async response
}

if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
}
