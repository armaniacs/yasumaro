/**
 * OffscreenTransportBase.ts
 * Shared plumbing for the storage-engine container transports: request
 * serialization (M7), per-call timeout, and the single retry. Subclasses
 * implement only the container-specific sendOnce.
 */

import { addLog } from '../utils/logger/core.js';
import { LogType } from '../utils/logger/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { Mutex } from '../utils/Mutex.js';
import { getPlatformOs } from '../utils/deviceUtils.js';
import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type { OffscreenResponse } from '../messaging/sqliteMessages.js';
import type { MsgOffscreenOptions, OffscreenTransport } from './offscreenTransport.js';

const MESSAGE_TIMEOUT_MS_DESKTOP = 10000; // 10 seconds
const MESSAGE_TIMEOUT_MS_MOBILE = 5000; // 5 seconds

export abstract class BaseOffscreenTransport implements OffscreenTransport {
  /**
   * Serializes requests to the storage container (M7). The container processes
   * one SQLite operation at a time; without this, overlapping requests from
   * multiple tabs would race each other.
   */
  protected readonly requestQueue: Mutex;

  /** Per-message timeout, shortened on mobile (see MESSAGE_TIMEOUT_MS_MOBILE). */
  protected readonly messageTimeoutMs: number;

  constructor() {
    const os = getPlatformOs();
    const isMobile = os === 'android' || os === 'ios';
    // Reduce the queue size on mobile devices to limit memory consumption.
    const maxQueueSize = isMobile ? 50 : 200;
    this.messageTimeoutMs = isMobile ? MESSAGE_TIMEOUT_MS_MOBILE : MESSAGE_TIMEOUT_MS_DESKTOP;
    this.requestQueue = new Mutex({ maxQueueSize, timeoutMs: this.messageTimeoutMs * 2 });
  }

  /**
   * Send a message to the storage container and await the response.
   *
   * Retries once on failure (M12): a suspended container (mobile Chrome
   * offscreen document, Firefox idle event page) can make the first attempt
   * after idle fail with a connection error. Resetting the container state
   * and retrying lets the second attempt succeed instead of surfacing a
   * transient error.
   */
  async msgOffscreen(
    type: SqliteMessageType,
    payload: Record<string, unknown> = {},
    traceId: string = '',
    opts: MsgOffscreenOptions = {},
  ): Promise<OffscreenResponse> {
    await this.requestQueue.acquire();
    try {
      try {
        return await this.sendOnce(type, payload, traceId);
      } catch (firstError) {
        if (opts.noRetry) {
          // Bulk operations: the container side may still be running. Surface
          // the failure immediately ("result unknown" for the caller) instead
          // of executing the operation a second time.
          this.invalidateContainer();
          throw firstError;
        }
        this.invalidateContainer();
        addLog(LogType.WARN, `OffscreenTransport: '${type}' failed, retrying once`, {
          error: errorMessage(firstError),
          traceId,
        });
        return await this.sendOnce(type, payload, traceId);
      }
    } catch (error) {
      // Reset the container state so the next call re-initializes it.
      this.invalidateContainer();
      throw error;
    } finally {
      this.requestQueue.release();
    }
  }

  /** Send one message; the container must already be reachable. */
  protected abstract sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string
  ): Promise<OffscreenResponse>;

  /** Drop cached container state so the next sendOnce re-initializes it. */
  protected abstract invalidateContainer(): void;
}
