import { checkSenderTrust, type SenderTrustLevel } from './senderTrust.js';
import type { MessageValidator } from '../../messaging/validators.js';

export type { SenderTrustLevel };

/**
 * Heterogeneous collection type: the registry stores handlers for different
 * message types in a single Map. Each handler factory internally narrows
 * the message to its specific type (e.g., ValidVisitMessage, ManualRecordMessage).
 *
 * `any` is retained here because:
 * - `unknown` would break `satisfies Record<string, MessageHandler>` (contravariance)
 * - `ExtensionMessage` would require all 20 handler factories to change their parameter types
 * Type safety is preserved at the call site via `satisfies` and at each handler's internal narrowing.
 */
export type MessageHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- architectural: heterogeneous collection
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void | Promise<void>;

export class MessageHandlerRegistry {
  private handlers = new Map<string, { handler: MessageHandler; trust: SenderTrustLevel; validator?: MessageValidator<unknown> }>();
  private readonly runtimeId: string | undefined;

  constructor(runtimeId?: string) {
    this.runtimeId = runtimeId ?? (typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined);
  }

  /**
   * @param trust who may send this message type. Required so that adding a
   *   handler forces an explicit answer — content scripts pass the registry's
   *   sender-id check, so an omitted level would silently mean "anyone".
   * @param validator optional validator for the message payload. When provided,
   *   the registry validates the message before dispatching to the handler.
   *   ValidationError is caught and returned as {success:false} without invoking handler.
   */
  register(type: string, handler: MessageHandler, trust: SenderTrustLevel, validator?: MessageValidator<unknown>): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler for message type: ${type}`);
    }
    if (validator) {
      this.handlers.set(type, { handler, trust, validator });
    } else {
      this.handlers.set(type, { handler, trust });
    }
  }

  dispatch(
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches MessageHandler type
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

    const { handler, trust, validator } = entry;
    const decision = checkSenderTrust(sender, trust, type, this.runtimeId);
    if (!decision.allowed) {
      sendResponse({ success: false, error: decision.error });
      return false;
    }
    // Validate before dispatch if a validator is registered
    if (validator) {
      try {
        validator.validate(message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ success: false, error: msg });
        return false;
      }
    }
    // Fire-and-forget: handlers are async and use sendResponse for replies.
    // Catch handler errors so they do not become unhandled promise rejections.
    Promise.resolve(handler(message, sender, sendResponse)).catch((err) => {
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }
}
