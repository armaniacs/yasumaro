import { vi } from 'vitest';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';

describe('MessageHandlerRegistry', () => {
  let registry: MessageHandlerRegistry;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();
  });

  test('rejects message from invalid sender when runtimeId is set', () => {
    const handler = vi.fn();
    registry = new MessageHandlerRegistry('valid-extension-id');
    registry.register('VALID_VISIT' as any, handler);

    const sendResponse = vi.fn();
    const sender = { id: 'invalid-extension-id' } as chrome.runtime.MessageSender;
    const result = registry.dispatch('VALID_VISIT' as any, { type: 'VALID_VISIT' }, sender, sendResponse);

    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
    expect(result).toBe(false);
  });

  test('accepts message from valid sender when runtimeId is set', () => {
    const handler = vi.fn();
    const runtimeId = 'valid-extension-id';
    registry = new MessageHandlerRegistry(runtimeId);
    registry.register('VALID_VISIT' as any, handler);

    const sendResponse = vi.fn();
    const sender = { id: runtimeId } as chrome.runtime.MessageSender;
    const result = registry.dispatch('VALID_VISIT' as any, { type: 'VALID_VISIT' }, sender, sendResponse);

    expect(handler).toHaveBeenCalledWith({ type: 'VALID_VISIT' }, sender, sendResponse);
    expect(result).toBe(true);
  });

  test('register and dispatch a handler', () => {
    const handler = vi.fn();
    registry.register('VALID_VISIT' as any, handler);

    const sendResponse = vi.fn();
    const result = registry.dispatch('VALID_VISIT' as any, { type: 'VALID_VISIT' }, {} as any, sendResponse);

    expect(handler).toHaveBeenCalledWith({ type: 'VALID_VISIT' }, {}, sendResponse);
    // dispatch returns true for registered handlers (fire-and-forget)
    expect(result).toBe(true);
  });

  test('unknown message type returns error', () => {
    const sendResponse = vi.fn();
    const result = registry.dispatch('UNKNOWN' as any, { type: 'UNKNOWN' }, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(result).toBe(false);
  });

  test('duplicate registration throws', () => {
    const handler = vi.fn();
    registry.register('TEST' as any, handler);
    expect(() => registry.register('TEST' as any, handler)).toThrow('Duplicate handler');
  });

  test('async handler is dispatched and dispatch returns true', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('ASYNC_TEST' as any, handler);

    const sendResponse = vi.fn();
    const result = registry.dispatch('ASYNC_TEST' as any, { type: 'ASYNC_TEST' }, {} as any, sendResponse);

    // dispatch returns true immediately (fire-and-forget)
    expect(result).toBe(true);
    // handler is called asynchronously
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalled();
    });
  });
});
