/**
 * offscreen.ts
 * Handles interactions with the Chrome Prompt API (window.ai) and SQLite database
 * operations in an offscreen document.
 */

import {
  init as sqliteInit,
  insert as sqliteInsert,
  query as sqliteQuery,
  search as sqliteSearch,
  update as sqliteUpdate,
  softDelete as sqliteSoftDelete,
  toggleStar as sqliteToggleStar,
  getCount as sqliteGetCount,
  getStatus as sqliteGetStatus,
  serialize as sqliteSerialize,
  _resetForTesting as sqliteResetForTesting,
} from './sqlite.js';

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
        console.log("Offscreen: Scope dump:", {
            hasWindow: typeof window !== 'undefined',
            hasSelf: typeof self !== 'undefined',
            hasGlobalThis: typeof globalThis !== 'undefined',
            windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.includes('ai') || k.includes('model')) : []
        });
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
        console.log("Offscreen: Session created successfully.");
        return true;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Offscreen: Failed to create session', error);
        return { success: false, error: `Session creation failed: ${errorMessage}` };
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
    // not from content scripts running in web pages (which would have a tab).
    // Content scripts can send CHECK_AVAILABILITY and SUMMARIZE (Prompt API)
    // but NOT SQLITE_* operations.
    const isSqliteMessage = typeof msg.type === 'string' && msg.type.startsWith('SQLITE_');
    if (isSqliteMessage && _sender.tab) {
      sendResponse({
        success: false,
        error: 'Forbidden: SQLite operations are not available from content scripts.',
      });
      return true;
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
                    sendResponse({ success: false, error: `Prompt failed: ${promptError instanceof Error ? promptError.message : String(promptError)}` });
                }
            } else if (msg.type === 'SQLITE_INIT') {
                const ok = await sqliteInit();
                sendResponse({ success: ok, initialized: ok });

            } else if (msg.type === 'SQLITE_INSERT') {
                const payload = msg.payload as Record<string, unknown>;
                const record = {
                    url: String(payload.url || ''),
                    title: payload.title != null ? String(payload.title) : null,
                    summary: payload.summary != null ? String(payload.summary) : null,
                    tags: payload.tags != null ? String(payload.tags) : null,
                    created_at: Number(payload.created_at || Date.now()),
                    domain: payload.domain != null ? String(payload.domain) : null,
                    visit_duration: payload.visit_duration != null ? Number(payload.visit_duration) : null,
                    scroll_ratio: payload.scroll_ratio != null ? Number(payload.scroll_ratio) : null,
                    is_starred: payload.is_starred != null ? Number(payload.is_starred) : 0,
                    is_deleted: 0,
                };
                const result = await sqliteInsert(record);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_QUERY') {
                const payload = msg.payload as Record<string, unknown> | undefined;
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
                };
                const result = await sqliteQuery(options);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_SEARCH') {
                const searchQuery = String(msg.payload?.['query'] || '');
                const limit = msg.payload?.['limit'] != null ? Number(msg.payload.limit) : 50;
                const offset = msg.payload?.['offset'] != null ? Number(msg.payload.offset) : 0;
                const result = await sqliteSearch(searchQuery, limit, offset);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_UPDATE') {
                const payload = msg.payload as Record<string, unknown>;
                const id = Number(payload.id);
                const changes: Record<string, unknown> = {};
                for (const key of ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted']) {
                    if (key in payload) {
                        changes[key] = payload[key];
                    }
                }
                const result = await sqliteUpdate(id, changes);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_DELETE') {
                const id = Number(msg.payload?.['id']);
                const result = await sqliteSoftDelete(id);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_TOGGLE_STAR') {
                const id = Number(msg.payload?.['id']);
                const result = await sqliteToggleStar(id);
                sendResponse(result);

            } else if (msg.type === 'SQLITE_COUNT') {
                const result = await sqliteGetCount();
                sendResponse(result);

            } else if (msg.type === 'SQLITE_STATUS') {
                const result = await sqliteGetStatus();
                sendResponse(result);

            } else if (msg.type === 'SQLITE_EXPORT') {
                const result = await sqliteSerialize();
                sendResponse(result);

            } else {
                console.warn(`Offscreen: Unknown message type ${msg.type}`);
                sendResponse({ success: false, error: 'Unknown message type' });
            }
        } catch (err: unknown) {
            console.error('Offscreen: Unexpected error', err);
            sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
    })();

    return true; // Keep channel open for async response
}

if (typeof globalThis.chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleOffscreenMessage);
}
