import { vi } from 'vitest';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';

describe('MessageHandlerRegistry', () => {
  let registry: MessageHandlerRegistry;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();
  });

  test('register and dispatch a handler', () => {
    const handler = vi.fn().mockReturnValue(false);
    registry.register('VALID_VISIT' as any, handler);

    const sendResponse = vi.fn();
    const result = registry.dispatch('VALID_VISIT' as any, { type: 'VALID_VISIT' }, {} as any, sendResponse);

    expect(handler).toHaveBeenCalledWith({ type: 'VALID_VISIT' }, {}, sendResponse);
    expect(result).toBe(false);
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

  test('async handler returns true to keep channel open', () => {
    const handler = vi.fn().mockReturnValue(true);
    registry.register('ASYNC_TEST' as any, handler);

    const sendResponse = vi.fn();
    const result = registry.dispatch('ASYNC_TEST' as any, { type: 'ASYNC_TEST' }, {} as any, sendResponse);

    expect(result).toBe(true);
  });
});
