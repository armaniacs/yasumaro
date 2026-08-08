import { checkSenderTrust, type SenderTrustLevel } from './senderTrust.js';

export type { SenderTrustLevel };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageHandler = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void | Promise<void>;

export class MessageHandlerRegistry {
  private handlers = new Map<string, { handler: MessageHandler; trust: SenderTrustLevel }>();
  private readonly runtimeId: string | undefined;

  constructor(runtimeId?: string) {
    this.runtimeId = runtimeId ?? (typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined);
  }

  /**
   * @param trust who may send this message type. Required so that adding a
   *   handler forces an explicit answer — content scripts pass the registry's
   *   sender-id check, so an omitted level would silently mean "anyone".
   */
  register(type: string, handler: MessageHandler, trust: SenderTrustLevel): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler for message type: ${type}`);
    }
    this.handlers.set(type, { handler, trust });
  }

  dispatch(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: string,
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    // Sender ID validation: reject messages from external extensions or unexpected senders.
    if (this.runtimeId !== undefined && sender.id !== this.runtimeId) {
      sendResponse({ success: false, error: 'Invalid sender' });
      return false;
    }

    const entry = this.handlers.get(type);
    if (!entry) {
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
      return false;
    }

    const { handler, trust } = entry;
    const decision = checkSenderTrust(sender, trust, type, this.runtimeId);
    if (!decision.allowed) {
      sendResponse({ success: false, error: decision.error });
      return false;
    }
    // Fire-and-forget: handlers are async and use sendResponse for replies.
    // Catch handler errors so they do not become unhandled promise rejections.
    Promise.resolve(handler(message, sender, sendResponse)).catch((err) => {
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }
}
