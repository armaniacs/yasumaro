/**
 * offscreenTransport.ts — transport seam for the storage-engine container.
 *
 * Two containers host the storage engine (see createOffscreenTransport):
 * - Chromium: the offscreen document (chrome.offscreen), reached via
 *   chrome.runtime.sendMessage — ChromeOffscreenTransport.ts.
 * - Firefox: the background event page itself (no offscreen API exists) —
 *   handleOffscreenMessage is invoked in-process — InPageOffscreenTransport.ts.
 *
 * The container choice is resolved at BUILD time (import.meta.env.FIREFOX is
 * a wxt build-time constant), so each shipped build contains only its own
 * transport and the engine graph never enters the wrong bundle.
 */

import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type { OffscreenResponse } from '../messaging/sqliteMessages.js';

export { ChromeOffscreenTransport } from './ChromeOffscreenTransport.js';

/**
 * Transport interface for sending messages to the offscreen document.
 * Tests can inject a mock transport that simulates offscreen responses.
 */
export interface OffscreenTransport {
  /** Send a message to the offscreen document and await the response */
  msgOffscreen(
    type: SqliteMessageType,
    payload?: Record<string, unknown>,
    traceId?: string,
    opts?: MsgOffscreenOptions
  ): Promise<OffscreenResponse>;
}

/** Per-call transport options. */
export interface MsgOffscreenOptions {
  /**
   * Skip the single automatic retry. Required for bulk destructive/bulk-write
   * operations (archive create/delete/restore): a timeout does NOT mean the
   * operation failed — offscreen/worker may still be running, and a blind
   * retry would execute it a second time (PBI 2026-09-06-01).
   */
  noRetry?: boolean;
}

/**
 * Create the transport for the current build target. Dynamic imports + the
 * build-time browser constant keep the engine graph out of the wrong bundle:
 * the Firefox branch (including its import of the in-page offscreen host) is
 * dead-code eliminated from the Chromium build, and vice versa.
 */
export async function createOffscreenTransport(): Promise<OffscreenTransport> {
  if (import.meta.env.FIREFOX) {
    const [{ InPageOffscreenTransport }, { handleOffscreenMessage }] = await Promise.all([
      import('./InPageOffscreenTransport.js'),
      import('../offscreen/offscreen.js'),
    ]);
    return new InPageOffscreenTransport(handleOffscreenMessage);
  }
  const { ChromeOffscreenTransport } = await import('./ChromeOffscreenTransport.js');
  return new ChromeOffscreenTransport();
}
