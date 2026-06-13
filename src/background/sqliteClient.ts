/**
 * sqliteClient.ts
 * Service Worker side client for SQLite operations.
 * Communicates with the Offscreen Document via message passing (target: 'offscreen').
 *
 * Pattern: src/background/localAiClient.ts
 */

import { addLog, LogType } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { recordSqliteFailure, recordSqliteSuccess } from './sqliteAlert.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const MESSAGE_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Types
// ============================================================================

import type { BrowsingLogRecord, QueryOptions, SearchResult } from '../utils/sqlite-types.js';

interface OffscreenResponse {
  success?: boolean;
  error?: string;
  initialized?: boolean;
  id?: number;
  rows?: unknown[];
  total?: number;
  count?: number;
  is_starred?: number;
  path?: string;
  fallback?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// SqliteClient
// ============================================================================

export class SqliteClient {
  private creatingOffscreenPromise: Promise<void> | null;
  /** Cached knowledge that the offscreen document is alive. Reset on error. */
  private offscreenAlive: boolean;

  constructor() {
    this.creatingOffscreenPromise = null;
    this.offscreenAlive = false;
  }

  /**
   * Ensure the offscreen document is open.
   * Uses the same dedup pattern as LocalAIClient.
   */
  async ensureOffscreenDocument(): Promise<void> {
    // Skip redundant browser IPC if we know the document is alive.
    if (this.offscreenAlive) return;

    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (hasOffscreen) {
      this.offscreenAlive = true;
      return;
    }

    if (this.creatingOffscreenPromise) {
      await this.creatingOffscreenPromise;
      return;
    }

    this.creatingOffscreenPromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'To access SQLite (wa-sqlite) for local browsing log storage.',
    });

    try {
      await this.creatingOffscreenPromise;
      this.offscreenAlive = true;
    } finally {
      this.creatingOffscreenPromise = null;
    }
  }

  /**
   * Send a message to the offscreen document and await the response.
   */
  async msgOffscreen(type: string, payload: Record<string, unknown> = {}): Promise<OffscreenResponse> {
    try {
      await this.ensureOffscreenDocument();
      return await new Promise<OffscreenResponse>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          fn();
        };
        const timeoutId = setTimeout(() => {
          settle(() => reject(new Error(`Offscreen message '${type}' timed out after ${MESSAGE_TIMEOUT_MS}ms`)));
        }, MESSAGE_TIMEOUT_MS);

        chrome.runtime.sendMessage(
          { type, target: 'offscreen', payload },
          (response: OffscreenResponse) => {
            if (chrome.runtime.lastError) {
              settle(() => reject(new Error(chrome.runtime.lastError.message)));
            } else if (response && response.error) {
              settle(() => reject(new Error(response.error)));
            } else {
              settle(() => resolve(response));
            }
          }
        );
      });
    } catch (error) {
      // Reset the cached alive flag so the next call re-checks the document.
      this.offscreenAlive = false;
      throw error;
    }
  }

  private async call<T>(
    type: string,
    payload: Record<string, unknown> = {},
    transform?: (res: OffscreenResponse) => T,
  ): Promise<T | null> {
    try {
      const response = await this.msgOffscreen(type, payload);
      if (response?.success) {
        recordSqliteSuccess();
        return transform ? transform(response) : (response as unknown as T);
      }
      recordSqliteFailure(type, response?.error || 'unknown');
      return null;
    } catch (error: unknown) {
      addLog(LogType.ERROR, `SqliteClient: ${type} failed`, { error: errorMessage(error) });
      recordSqliteFailure(type, errorMessage(error));
      return null;
    }
  }

  async init(): Promise<boolean> {
    return (await this.call<void>('SQLITE_INIT')) !== null;
  }

  async insert(record: BrowsingLogRecord): Promise<{ id: number } | null> {
    return this.call<{ id: number }>(
      'SQLITE_INSERT',
      record as unknown as Record<string, unknown>,
      (res) => ({ id: Number(res.id) }),
    );
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<{ count: number } | null> {
    return this.call<{ count: number }>(
      'SQLITE_INSERT_BATCH',
      { records: records as unknown as Record<string, unknown>[] },
      (res) => ({ count: Number(res.count) }),
    );
  }

  async query<T = BrowsingLogRecord>(options: QueryOptions = {}): Promise<{ rows: T[]; total: number } | null> {
    return this.call<{ rows: T[]; total: number }>(
      'SQLITE_QUERY',
      options as unknown as Record<string, unknown>,
      (res) => ({
        rows: (res.rows || []) as T[],
        total: Number(res.total || 0),
      }),
    );
  }

  async search(query: string, limit = 50, offset = 0): Promise<{ rows: SearchResult[]; total: number } | null> {
    return this.call<{ rows: SearchResult[]; total: number }>(
      'SQLITE_SEARCH',
      { query, limit, offset },
      (res) => ({
        rows: (res.rows || []) as SearchResult[],
        total: Number(res.total || 0),
      }),
    );
  }

  async update(id: number, changes: Partial<Record<string, unknown>>): Promise<boolean> {
    return (await this.call<void>('SQLITE_UPDATE', { id, ...changes })) !== null;
  }

  async delete(id: number): Promise<boolean> {
    return (await this.call<void>('SQLITE_DELETE', { id })) !== null;
  }

  async toggleStar(id: number): Promise<{ is_starred: number } | null> {
    return this.call<{ is_starred: number }>(
      'SQLITE_TOGGLE_STAR',
      { id },
      (res) => ({ is_starred: Number(res.is_starred) }),
    );
  }

  async getCount(): Promise<number | null> {
    return this.call<number>('SQLITE_COUNT', {}, (res) => Number(res.count));
  }

  async exportDb(): Promise<Uint8Array | null> {
    return this.call<Uint8Array>(
      'SQLITE_EXPORT',
      {},
      (res) => new Uint8Array(res.data as number[]),
    );
  }

  async getStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean } | null> {
    return this.call<{ initialized: boolean; path: string; fallback: boolean }>(
      'SQLITE_STATUS',
      {},
      (res) => ({
        initialized: Boolean(res.initialized),
        path: String(res.path || ''),
        fallback: Boolean(res.fallback),
      }),
    );
  }

  async clearAll(): Promise<boolean> {
    return (await this.call<void>('SQLITE_CLEAR_ALL')) !== null;
  }
}
