/**
 * InPageOffscreenTransport.ts
 * Firefox container: there is no chrome.offscreen API, so the background
 * event page hosts the storage engine directly and handleOffscreenMessage is
 * invoked in-process. The handler and the sender authorization proof are both
 * produced by the host module (offscreen.ts) and handed to this transport via
 * the constructor — this file never imports the engine graph, so the Chromium
 * build stays free of it, and the sender is not fabricated here.
 */

import type { AuthorizedSqliteSender } from '../utils/extensionOrigin.js';
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
  /** Authorization proof for the event-page context, produced by
   *  authorizeSqliteSender — dispatched as the sender identity. */
  private readonly authorizedSender: AuthorizedSqliteSender;

  constructor(handleOffscreenMessage: OffscreenMessageHandler, authorizedSender: AuthorizedSqliteSender) {
    super();
    this.handleOffscreenMessage = handleOffscreenMessage;
    this.authorizedSender = authorizedSender;
  }

  protected invalidateContainer(): void {
    // The in-page handler has no cached container state to drop; the engine
    // re-initializes itself on demand after failures.
  }

  /**
   * Send one message by invoking the offscreen message handler in-process.
   * The dispatched sender is this transport's own authorization proof — the
   * offscreen gate (authorizeSqliteSender) accepted the event-page context at
   * construction time, so no sender fabrication happens here.
   */
  protected async sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string = ''
  ): Promise<OffscreenResponse> {
    return this.sendOnceWithTimeout(type, traceId, (signal) => {
      const accepted = this.handleOffscreenMessage(
        { type, target: 'offscreen', payload, traceId },
        this.authorizedSender as unknown as chrome.runtime.MessageSender,
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
