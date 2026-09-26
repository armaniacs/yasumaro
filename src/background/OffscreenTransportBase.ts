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
import { shouldRetryTransport } from '../messaging/transportRetryPolicy.js';
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
   * A message is retried once only when the neutral messaging policy marks
   * its operation as replay-safe. Unsafe and unknown operations fail closed.
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
        if (!shouldRetryTransport(type, opts)) {
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
      // Invalidate cached container state after any failed send so the next
      // call reinitializes it. The neutral policy table controls whether a
      // second send is safe, so this cleanup must not depend on a caller flag.
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

  /**
   * Shared timeout/settle plumbing for both containers (PBI 2026-09-15-07):
   * owns the settled flag, the per-message timeout, and the response
   * unwrapping. `invoke` performs only the container-specific send — a
   * runtime.sendMessage (Chromium) or an in-process handler call (Firefox) —
   * and must call exactly one of `signal.done(response)` / `signal.fail(error)`.
   */
  protected sendOnceWithTimeout(
    type: SqliteMessageType,
    traceId: string,
    invoke: (signal: {
      done: (response: OffscreenResponse) => void;
      fail: (error: Error) => void;
    }) => void
  ): Promise<OffscreenResponse> {
    return new Promise<OffscreenResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        fn();
      };
      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error(`${type} message timed out after ${this.messageTimeoutMs}ms`)));
      }, this.messageTimeoutMs);

      invoke({
        done: (response) => settle(() => resolve(response)),
        fail: (error) => settle(() => reject(error)),
      });
    });
  }
}
