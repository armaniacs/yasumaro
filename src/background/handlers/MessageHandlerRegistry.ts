export type MessageHandler = (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Record<string, unknown>) => void,
) => boolean;

export class MessageHandlerRegistry {
  private handlers = new Map<string, MessageHandler>();

  register(type: string, handler: MessageHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Duplicate handler for message type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  dispatch(
    type: string,
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown>) => void,
  ): boolean {
    const handler = this.handlers.get(type);
    if (!handler) {
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
      return false;
    }
    return handler(message, sender, sendResponse);
  }
}
