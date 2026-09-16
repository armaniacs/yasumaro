/**
 * InPageOffscreenTransport.ts
 * Firefox container: there is no chrome.offscreen API, so the background
 * event page hosts the storage engine directly and handleOffscreenMessage is
 * invoked in-process. The handler is produced by the host module (offscreen.ts)
 * and handed to this transport via the constructor — this file never imports
 * the engine graph, so the Chromium build stays free of it.
 */

import type { SqliteMessageType } from '../messaging/sqliteMessages.js';
import type { OffscreenResponse } from '../messaging/sqliteMessages.js';
import { BaseOffscreenTransport } from './OffscreenTransportBase.js';

type OffscreenMessageHandler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean;

export class InPageOffscreenTransport extends BaseOffscreenTransport {
  private readonly handleOffscreenMessage: OffscreenMessageHandler;

  constructor(handleOffscreenMessage: OffscreenMessageHandler) {
    super();
    this.handleOffscreenMessage = handleOffscreenMessage;
  }

  protected invalidateContainer(): void {
    // The in-page handler has no cached container state to drop; the engine
    // re-initializes itself on demand after failures.
  }

  /**
   * Send one message by invoking the offscreen message handler in-process.
   *
   * The dispatched sender describes the real event-page context (our runtime id
   * + our own extension URL), because the offscreen gate authorizes every
   * SQLITE_* message itself via authorizeSqliteSender. Handing it the opaque
   * authorization proof instead does not work: the proof carries no `id`, so
   * the gate re-authorizes it as an external extension and rejects every
   * SQLite call on Firefox.
   */
  protected async sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string = ''
  ): Promise<OffscreenResponse> {
    const sender = {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL('background.js'),
    } as chrome.runtime.MessageSender;
    return this.sendOnceWithTimeout(type, traceId, (signal) => {
      const accepted = this.handleOffscreenMessage(
        { type, target: 'offscreen', payload, traceId },
        sender,
        (response: unknown) => {
          const res = response as OffscreenResponse;
          if (res && 'error' in res && res.error) {
            signal.fail(new Error(res.error));
          } else {
            signal.done(res);
          }
        }
      );
      if (!accepted) {
        signal.fail(new Error('In-page offscreen handler did not accept the message'));
      }
    });
  }
}
