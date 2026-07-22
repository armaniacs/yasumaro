/**
 * offscreen.ts
 * Handles interactions with the Chrome Prompt API (window.ai) and SQLite database
 * operations in an offscreen document.
 */

import {
  init as sqliteInit,
  insert as sqliteInsert,
  insertBatch as sqliteInsertBatch,
  query as sqliteQuery,
  search as sqliteSearch,
  sqliteHealthCheck,
  update as sqliteUpdate,
  hardDelete as sqliteHardDelete,
  toggleStar as sqliteToggleStar,
  getCount as sqliteGetCount,
  getStatus as sqliteGetStatus,
  serialize as sqliteSerialize,
  backupDb as sqliteBackupDb,
  restoreDb as sqliteRestoreDb,
  clearAll as sqliteClearAll,
  purgeOldRecords as sqlitePurgeOldRecords,
  purgeContent as sqlitePurgeContent,
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
  _resetForTesting as sqliteResetForTesting,
} from './sqlite.js';
import { errorMessage } from '../utils/errorUtils.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

// VULN-016 fix: simple promise-based mutex to serialize SQLite write operations
// and prevent concurrent transactions from rolling back each other
class SqliteWriteMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const sqliteWriteMutex = new SqliteWriteMutex();
import { StorageKeys } from '../utils/storage/types.js';
import { isSqliteMessageType, type SqliteMessage } from '../messaging/sqliteMessages.js';

interface AICapabilities {
    available: 'readily' | 'after-download' | 'no';
}

interface AISession {
    prompt(text: string): Promise<string>;
    destroy(): void;
}

interface AILanguageModel {
    capabilities(): Promise<AICapabilities>;
    create(options?: { systemPrompt?: string }): Promise<AISession>;
}

interface AI {
    languageModel: AILanguageModel;
}

declare global {
    interface Window {
        ai?: AI;
    }
    // eslint-disable-next-line no-var
    var ai: AI | undefined;
}

let session: AISession | null = null;

// For testing only - reset session state
export const _resetSessionForTesting = (): void => {
    session = null;
};

// For testing only - reset SQLite state
export const _resetSqliteForTesting = (): void => {
    sqliteResetForTesting();
};

// Helper to get the AI object
export const getAI = (): AI | null | undefined => {
    return window.ai || globalThis.ai || (typeof self !== 'undefined' ? (self as unknown as { ai?: AI }).ai : null);
};

// Check availability
export async function checkAvailability(): Promise<string> {
    const ai = getAI();
    if (!ai?.languageModel) {
        return 'unsupported';
    }
    try {
        const capabilities = await ai.languageModel.capabilities();
        return capabilities?.available || 'no';
    } catch (error) {
        console.error('Offscreen: Failed to check capabilities', error);
        return 'unsupported';
    }
}

// Create session if needed
export async function ensureSession(): Promise<boolean | { success: false; error: string }> {
    if (session) return true;

    const ai = getAI();

    if (!ai) {
        console.error("Offscreen: 'ai' object not found in window, globalThis, or self.");
        return { success: false, error: "'ai' object not found (Prompt API missing). Check flags." };
    }

    if (!ai.languageModel) {
        console.error("Offscreen: ai.languageModel is undefined.");
        return { success: false, error: "ai.languageModel is undefined" };
    }

    const status = await checkAvailability();
    if (status !== 'readily' && status !== 'after-download') {
        console.warn(`Offscreen: AI status is '${status}', cannot create session.`);
        return { success: false, error: `AI capability status is '${status}'` };
    }

    try {
        session = await ai.languageModel.create({
            systemPrompt: `あなたはWebページ要約のエキスパートです。
与えられたテキストを日本語で1文または2文に要約してください。
重要なポイントのみを抽出し、個人情報や機密情報は含めないでください。
改行しないでください。`
        });
        return true;
    } catch (error: unknown) {
        console.error('Offscreen: Failed to create session', error);
        return { success: false, error: `Session creation failed: ${errorMessage(error)}` };
    }
}

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

// Dispatch a SqliteMessage (SW↔offscreen, see src/messaging/sqliteMessages.ts) to
// the matching sqlite.js handler and respond via sendResponse.
async function handleSqliteMessage(
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
            const ok = await sqliteInit();
            sendResponse({ success: ok, initialized: ok });
            break;
        }
        case 'SQLITE_INSERT': {
            const payload = msg.payload;

            if (typeof payload.summary === 'string' && payload.summary.length > 1024 * 1024) {
                sendResponse({ success: false, error: 'Payload too large: summary exceeds 1MB limit' });
                break;
            }

            const record = buildRecordFromPayload(payload);
            const result = await sqliteInsert(record);
            sendResponse(result);
            break;
        }
        case 'SQLITE_INSERT_BATCH': {
            const rawRecords = msg.payload.records || [];
            const records = rawRecords.map(r => buildRecordFromPayload(r));
            const result = await sqliteInsertBatch(records);
            sendResponse(result);
            break;
        }
        case 'SQLITE_QUERY': {
            const payload = msg.payload;
            const options = {
                limit: payload?.limit != null ? Number(payload.limit) : undefined,
                offset: payload?.offset != null ? Number(payload.offset) : undefined,
                orderBy: payload?.orderBy != null ? String(payload.orderBy) : undefined,
                orderDir: payload?.orderDir as 'ASC' | 'DESC' | undefined,
                domain: payload?.domain != null ? String(payload.domain) : undefined,
                isStarred: payload?.isStarred != null ? Boolean(payload.isStarred) : undefined,
                excludeDeleted: payload?.excludeDeleted != null ? Boolean(payload.excludeDeleted) : undefined,
                since: payload?.since != null ? Number(payload.since) : undefined,
                until: payload?.until != null ? Number(payload.until) : undefined,
                ids: payload?.ids != null ? payload.ids as number[] : undefined,
                tagFilter: payload?.tagFilter != null ? String(payload.tagFilter) : undefined,
                gistSynced: payload?.gistSynced != null ? Number(payload.gistSynced) : undefined,
            };
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
            const result = await sqliteQueryAuditLog({
                limit: payload?.limit != null ? Number(payload.limit) : undefined,
                offset: payload?.offset != null ? Number(payload.offset) : undefined,
            });
            sendResponse(result);
            break;
        }
        case 'SQLITE_SEARCH': {
            const searchQuery = String(msg.payload.query || '');
            const limit = msg.payload.limit != null ? Number(msg.payload.limit) : 50;
            const offset = msg.payload.offset != null ? Number(msg.payload.offset) : 0;
            const result = await sqliteSearch(searchQuery, limit, offset);
            sendResponse(result);
            break;
        }
        case 'SQLITE_UPDATE': {
            const payload = msg.payload;
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
            console.warn(`Offscreen: Unknown SQLite message type ${(_exhaustive as SqliteMessage).type}`);
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
    // Content scripts can send CHECK_AVAILABILITY and SUMMARIZE (Prompt API)
    // but NOT SQLITE_* operations.
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

    (async () => {
        try {
            if (msg.type === 'CHECK_AVAILABILITY') {
                const result = await checkAvailability();
                sendResponse({ status: result });

            } else if (msg.type === 'SUMMARIZE') {
                const content = msg.payload?.['content'];
                if (!content) {
                    sendResponse({ success: false, error: 'No content provided' });
                    return;
                }

                const sessionResult = await ensureSession();
                if (sessionResult !== true) {
                    const errorMsg = (sessionResult as { error: string }).error || 'Unknown session error';
                    sendResponse({ success: false, error: errorMsg });
                    return;
                }

                try {
                    const truncatedContent = String(content).substring(0, 10000);
                    if (session) {
                        const result = await session.prompt(truncatedContent);
                        sendResponse({ success: true, summary: result });
                    } else {
                        throw new Error('Session is null');
                    }
                } catch (promptError: unknown) {
                    console.error('Offscreen: Prompt extraction failed', promptError);
                    session = null;
                    sendResponse({ success: false, error: `Prompt failed: ${errorMessage(promptError)}` });
                }
            } else if (isSqliteMessage) {
                // VULN-016 fix: acquire write mutex to serialize SQLite operations
                // and prevent concurrent transactions from interfering with each other
                await sqliteWriteMutex.acquire();
                try {
                  // Cast is safe: isSqliteMessage narrowed msg.type via isSqliteMessageType
                  // above, so msg.type is a known SqliteMessageType at this point. Payload
                  // shape itself is not runtime-validated here (same trust boundary as
                  // before this refactor: the sender is verified to be our own SW).
                  await handleSqliteMessage(msg as SqliteMessage, sendResponse);
                } finally {
                  sqliteWriteMutex.release();
                }

            } else {
                console.warn(`Offscreen: Unknown message type ${msg.type}`);
                sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (err: unknown) {
            console.error('Offscreen: Unexpected error', err);
            sendResponse({ success: false, error: errorMessage(err) });
        }
    })();

    return true; // Keep channel open for async response
}

if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
}
