// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessageHandler = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => void | Promise<void>;

export class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler>();

  register(type: string, handler: MessageHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler for message type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  dispatch(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type: string,
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean {
    const handler = this.handlers.get(type);
    if (!handler) {
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
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
