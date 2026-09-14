/**
 * InPageOffscreenTransport.ts
 * Firefox container: there is no chrome.offscreen API, so the background
 * event page hosts the storage engine directly and handleOffscreenMessage is
 * invoked in-process. The engine module is loaded by the background startup
 * (PBI 2026-09-14-09) and handed to this transport via the constructor — this
 * file never imports the engine graph, so the Chromium build stays free of it.
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
   * The in-process call mirrors the runtime-messaging contract: the handler
   * authorizes SQLITE messages against sender.id === chrome.runtime.id and
   * rejects senders with a tab — an event-page-originated call satisfies both.
   */
  protected async sendOnce(
    type: SqliteMessageType,
    payload: Record<string, unknown>,
    traceId: string = ''
  ): Promise<OffscreenResponse> {
    // The offscreen handler authorizes callers by extension origin (see
    // src/utils/extensionOrigin.ts): the in-process call from the event page
    // carries its own extension URL, satisfying the same contract as a
    // chrome.runtime message from an extension page.
    const sender = {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL('background.js'),
    } as chrome.runtime.MessageSender;
    return new Promise<OffscreenResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        fn();
      };
      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error(`In-page offscreen message '${type}' timed out after ${this.messageTimeoutMs}ms`)));
      }, this.messageTimeoutMs);

      const accepted = this.handleOffscreenMessage(
        { type, target: 'offscreen', payload, traceId },
        sender,
        (response: unknown) => {
          settle(() => {
            const res = response as OffscreenResponse;
            if (res && 'error' in res && res.error) {
              reject(new Error(res.error));
            } else {
              resolve(res);
            }
          });
        }
      );
      if (!accepted) {
        settle(() => reject(new Error('In-page offscreen handler did not accept the message')));
      }
    });
  }
}
