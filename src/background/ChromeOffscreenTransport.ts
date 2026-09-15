/**
 * ChromeOffscreenTransport.ts
 * Chromium container: manages the offscreen document lifecycle, message
 * passing, timeout handling, and retry logic. Timeout/settle plumbing lives
 * in BaseOffscreenTransport — this class supplies only the container-specific
 * invoke (chrome.runtime.sendMessage) and the offscreen document lifecycle.
 */

import { errorMessage } from '../utils/errorUtils.js';
import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type { OffscreenResponse } from '../messaging/sqliteMessages.js';
import { BaseOffscreenTransport } from './OffscreenTransportBase.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

export class ChromeOffscreenTransport extends BaseOffscreenTransport {
  private creatingOffscreenPromise: Promise<void> | null;
  /** Cached knowledge that the offscreen document is alive. Reset on error. */
  private offscreenAlive: boolean;

  constructor() {
    super();
    this.creatingOffscreenPromise = null;
    this.offscreenAlive = false;
  }

  /** Drop the cached alive flag so the next call re-checks the document. */
  protected invalidateContainer(): void {
    this.offscreenAlive = false;
  }

  /**
   * Ensure the offscreen document is open.
   */
  private async ensureOffscreenDocument(): Promise<void> {
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
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.LOCAL_STORAGE],
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
   * Send a single message to the offscreen document and await the response.
   * Does not retry — callers needing reconnect-on-failure should use msgOffscreen().
   */
  protected async sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string = ''
  ): Promise<OffscreenResponse> {
    await this.ensureOffscreenDocument();
    return this.sendOnceWithTimeout(type, traceId, (signal) => {
      chrome.runtime.sendMessage(
        { type, target: 'offscreen', payload, traceId },
        (response: OffscreenResponse) => {
          if (chrome.runtime.lastError) {
            signal.fail(new Error(chrome.runtime.lastError?.message ?? 'Unknown error'));
          } else if (response && 'error' in response && response.error) {
            signal.fail(new Error(errorMessage(response.error)));
          } else {
            signal.done(response);
          }
        }
      );
    });
  }
}
