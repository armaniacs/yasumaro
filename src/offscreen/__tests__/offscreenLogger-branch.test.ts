import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardWarn, forwardError, forwardInfo } from '../offscreenLogger.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';

describe('offscreenLogger - branch coverage', () => {
  let origChrome: unknown;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
    // re-apply spies after clear
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    if (origChrome === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
    } else {
      (globalThis as unknown as Record<string, unknown>).chrome = origChrome;
    }
    vi.restoreAllMocks();
  });

  describe('chrome undefined / missing sendMessage branches', () => {
    it('falls back to console.warn when chrome is undefined (forwardWarn)', () => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      forwardWarn('hello', { a: 1 });
      expect(warnSpy).toHaveBeenCalledWith('[offscreen] hello', { a: 1 });
    });

    it('falls back to console.error when chrome is undefined (forwardError)', () => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      forwardError('oops');
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toBe('[offscreen] oops');
    });

    it('falls back to console.log when level is info and chrome undefined', () => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      forwardInfo('info-msg', { x: 1 });
      expect(logSpy).toHaveBeenCalledWith('[offscreen] info-msg', { x: 1 });
    });

    it('falls back to console when chrome.runtime is undefined', () => {
      (globalThis as unknown as Record<string, unknown>).chrome = {} as unknown;
      forwardWarn('no-runtime');
      expect(warnSpy).toHaveBeenCalledWith('[offscreen] no-runtime', '');
    });

    it('falls back to console when chrome.runtime.sendMessage is falsy', () => {
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      forwardError('no-sendMessage');
      expect(errorSpy).toHaveBeenCalledWith('[offscreen] no-sendMessage', '');
    });

    it('falls back to console with empty string when details undefined and chrome missing', () => {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
      forwardInfo('no-details');
      expect(logSpy).toHaveBeenCalledWith('[offscreen] no-details', '');
    });
  });

  describe('traceId merging branches', () => {
    it('merges traceId into details when traceId provided and details provided', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('msg', { foo: 'bar' }, 'mySource', 'trace-123');
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOG_FORWARD',
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          payload: expect.objectContaining({
            level: 'warn',
            message: 'msg',
            details: { foo: 'bar', traceId: 'trace-123' },
            source: 'mySource',
          }),
        }),
      );
    });

    it('creates details with only traceId when details undefined but traceId provided', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardError('err', undefined, undefined, 'tid-1');
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ details: { traceId: 'tid-1' } }),
        }),
      );
    });

    it('passes details unchanged when traceId undefined', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      const d = { a: 1 };
      forwardInfo('m', d);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ details: d }),
        }),
      );
    });

    it('passes undefined details when both details and traceId undefined', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('m2');
      const call = sendMessage.mock.calls[0][0] as { payload: { details: unknown } };
      expect(call.payload.details).toBeUndefined();
    });

    it('uses default source offscreen when source not provided', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('default-src-test');
      const call = sendMessage.mock.calls[0][0] as { payload: { source: string } };
      expect(call.payload.source).toBe('offscreen');
    });

    it('uses custom source when provided', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('custom-src', undefined, 'custom');
      const call = sendMessage.mock.calls[0][0] as { payload: { source: string } };
      expect(call.payload.source).toBe('custom');
    });
  });

  describe('sendMessage result handling branches', () => {
    it('does not attach catch handler when result is undefined (callback-style mock)', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('no-promise');
      expect(sendMessage).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not attach catch when result has no catch function (plain object)', () => {
      const sendMessage = vi.fn(() => ({ then: () => {} }) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('plain-obj');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('attaches catch and falls back to console on rejected promise (warn level)', async () => {
      const sendMessage = vi.fn(() => Promise.reject(new Error('SW asleep')) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('async-warn', { d: 1 });
      // allow microtask to run
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalledWith('[offscreen] async-warn', { d: 1 });
    });

    it('falls back to console.log on rejected promise when level is info', async () => {
      const sendMessage = vi.fn(() => Promise.reject(new Error('fail')) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('async-info', { v: 2 });
      await new Promise((r) => setTimeout(r, 0));
      expect(logSpy).toHaveBeenCalledWith('[offscreen] async-info', { v: 2 });
    });

    it('falls back to console.error on rejected promise when level is error', async () => {
      const sendMessage = vi.fn(() => Promise.reject(new Error('fail')) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardError('async-error');
      await new Promise((r) => setTimeout(r, 0));
      expect(errorSpy).toHaveBeenCalledWith('[offscreen] async-error', '');
    });

    it('uses details ?? empty string in catch fallback when details undefined', async () => {
      const sendMessage = vi.fn(() => Promise.reject(new Error('x')) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardError('no-details-catch');
      await new Promise((r) => setTimeout(r, 0));
      expect(errorSpy).toHaveBeenCalledWith('[offscreen] no-details-catch', '');
    });

    it('uses default source in catch fallback', async () => {
      const sendMessage = vi.fn(() => Promise.reject(new Error('x')) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('catch-default-src');
      await new Promise((r) => setTimeout(r, 0));
      expect(warnSpy).toHaveBeenCalledWith('[offscreen] catch-default-src', '');
    });

    it('does not call console fallback when promise resolves', async () => {
      const sendMessage = vi.fn(() => Promise.resolve({ ok: true }) as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('resolved');
      await new Promise((r) => setTimeout(r, 0));
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('synchronous throw branch', () => {
    it('catches synchronous throw and falls back to console.warn (with details)', () => {
      const sendMessage = vi.fn(() => {
        throw new Error('sync boom');
      });
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('sync-throw', { a: 2 });
      expect(warnSpy).toHaveBeenCalledWith('[offscreen] sync-throw', { a: 2 });
    });

    it('catches synchronous throw with custom source and traceId', () => {
      const sendMessage = vi.fn(() => {
        throw new Error('boom');
      });
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardError('sync-throw2', { b: 1 }, 'src2', 'tid');
      expect(errorSpy).toHaveBeenCalledWith('[src2] sync-throw2', { b: 1 });
    });

    it('catches synchronous throw for info level -> console.log', () => {
      const sendMessage = vi.fn(() => {
        throw new Error('boom');
      });
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('sync-info', undefined, 'svc');
      expect(logSpy).toHaveBeenCalledWith('[svc] sync-info', '');
    });

    it('catches sync throw with undefined details -> empty string', () => {
      const sendMessage = vi.fn(() => {
        throw new Error('boom');
      });
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('sync-no-details');
      expect(logSpy).toHaveBeenCalledWith('[offscreen] sync-no-details', '');
    });
  });

  describe('level routing branches via exports', () => {
    it('forwardWarn routes through warn level', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('w');
      const payload = (sendMessage.mock.calls[0][0] as { payload: { level: string } }).payload;
      expect(payload.level).toBe('warn');
    });

    it('forwardError routes through error level', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardError('e');
      const payload = (sendMessage.mock.calls[0][0] as { payload: { level: string } }).payload;
      expect(payload.level).toBe('error');
    });

    it('forwardInfo routes through info level', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardInfo('i');
      const payload = (sendMessage.mock.calls[0][0] as { payload: { level: string } }).payload;
      expect(payload.level).toBe('info');
    });

    it('protocolVersion is ATTACHED correctly', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('pv');
      const msg = sendMessage.mock.calls[0][0] as { protocolVersion: number };
      expect(msg.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    });

    it('traceId=nullish does not merge (falsy branch)', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('null-trace', { x: 1 }, undefined, undefined);
      const payload = (sendMessage.mock.calls[0][0] as { payload: { details: unknown } }).payload;
      expect(payload.details).toEqual({ x: 1 });
    });

    it('traceId empty string is falsy and does not merge', () => {
      const sendMessage = vi.fn(() => undefined as unknown);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage } } as unknown;
      forwardWarn('empty-trace', { x: 1 }, undefined, '');
      const payload = (sendMessage.mock.calls[0][0] as { payload: { details: unknown } }).payload;
      expect(payload.details).toEqual({ x: 1 });
    });
  });
});
