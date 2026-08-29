import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  forwardWarn,
  forwardError,
  forwardInfo,
} from '../offscreenLogger.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';

describe('offscreenLogger', () => {
  let originalChrome: any;

  beforeEach(() => {
    originalChrome = (global as any).chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (global as any).chrome = originalChrome;
  });

  it('falls back to console when chrome is undefined', () => {
    (global as any).chrome = undefined;
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forwardWarn('hello', { a: 1 });
    expect(logSpy).toHaveBeenCalledWith('[offscreen] hello', { a: 1 });
    logSpy.mockRestore();
  });

  it('falls back to console when chrome.runtime.sendMessage is missing', () => {
    (global as any).chrome = { runtime: {} };
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forwardError('oops');
    expect(logSpy).toHaveBeenCalledWith('[offscreen] oops', '');
    logSpy.mockRestore();
  });

  it('uses console.log for info level fallback', () => {
    (global as any).chrome = undefined;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    forwardInfo('info-msg');
    expect(logSpy).toHaveBeenCalledWith('[offscreen] info-msg', '');
    logSpy.mockRestore();
  });

  it('sends message via chrome.runtime.sendMessage when available', () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    (global as any).chrome = { runtime: { sendMessage } };
    forwardWarn('network retry', { count: 2 });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'LOG_FORWARD',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      payload: {
        level: 'warn',
        message: 'network retry',
        details: { count: 2 },
        source: 'offscreen',
      },
    });
  });

  it('appends traceId to details when provided', () => {
    const sendMessage = vi.fn().mockReturnValue(undefined);
    (global as any).chrome = { runtime: { sendMessage } };
    forwardError('fail', { code: 500 }, 'worker', 'trace-42');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          details: { code: 500, traceId: 'trace-42' },
        }),
      }),
    );
  });

  it('falls back to console when sendMessage returns a rejecting promise', () => {
    const sendMessage = vi.fn().mockReturnValue(Promise.reject(new Error('sw down')));
    (global as any).chrome = { runtime: { sendMessage } };
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forwardWarn('msg');
    expect(sendMessage).toHaveBeenCalled();
    // trigger microtask
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(logSpy).toHaveBeenCalledWith('[offscreen] msg', '');
        logSpy.mockRestore();
        resolve();
      }, 0);
    });
  });

  it('does not install catch handler when sendMessage returns a non-promise', () => {
    const sendMessage = vi.fn().mockReturnValue({});
    (global as any).chrome = { runtime: { sendMessage } };
    const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forwardWarn('msg2');
    expect(sendMessage).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('falls back to console when sendMessage throws synchronously', () => {
    const sendMessage = vi.fn().mockImplementation(() => {
      throw new Error('invalid context');
    });
    (global as any).chrome = { runtime: { sendMessage } };
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    forwardError('boom');
    expect(sendMessage).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('[offscreen] boom', '');
    logSpy.mockRestore();
  });
});
