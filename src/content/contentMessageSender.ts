/**
 * contentMessageSender.ts
 * Content-script → Service Worker sender with retry, built on the unified
 * MessageTransport (PBI-22). Replaces the standalone ChromeMessageSender.
 *
 * VisitReporter depends only on the narrow MessageSender seam so tests can
 * inject a fake; production wires this adapter.
 */

import { MessageTransport, ChromeTransport } from '../messaging/messageTransport.js';
import type { ExtensionMessage } from '../background/messageTypes.js';
import type { ServiceWorkerResponse, MessageSender } from './visitReporter.js';

const CONTENT_RETRIES = 2;

/**
 * Build a MessageSender backed by MessageTransport. `retries` mirrors the old
 * `createSender({ maxRetries: 2 })` behaviour for the content-script path.
 */
export function createContentMessageSender(retries: number = CONTENT_RETRIES): MessageSender {
  const transport = new MessageTransport(new ChromeTransport());
  return {
    async sendMessageWithRetry(message): Promise<ServiceWorkerResponse> {
      const response = await transport.send(message as ExtensionMessage, { retries });
      return (response ?? undefined) as ServiceWorkerResponse;
    },
  };
}
