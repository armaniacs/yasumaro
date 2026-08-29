import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageTransport, ChromeTransport, ImmediateTransport } from '../messageTransport.js';
import { CURRENT_PROTOCOL_VERSION } from '../protocol.js';

function validMessage(type = 'PING'): Record<string, unknown> {
  return { type };
}

describe('messageTransport - branch coverage', () => {
  let origChrome: unknown;

  beforeEach(() => {
    origChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (origChrome === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).chrome;
    } else {
      (globalThis as unknown as Record<string, unknown>).chrome = origChrome;
    }
  });

  describe('ChromeTransport', () => {
    it('delegates to chrome.runtime.sendMessage', async () => {
      const sendMessage = vi.fn(() => Promise.resolve({ ok: 1 }));
      (globalThis as unknown as Record<string, unknown>).chrome = {
        runtime: { sendMessage },
      } as unknown;
      const t = new ChromeTransport();
      const res = await t.send({ type: 'PING' });
      expect(sendMessage).toHaveBeenCalledWith({ type: 'PING' });
      expect(res).toEqual({ ok: 1 });
    });
  });

  describe('ImmediateTransport', () => {
    it('delegates to handler', async () => {
      const handler = vi.fn(() => Promise.resolve('handler-res'));
      const t = new ImmediateTransport(handler);
      const res = await t.send({ foo: 'bar' });
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
      expect(res).toBe('handler-res');
    });

    it('propagates handler rejection', async () => {
      const handler = vi.fn(() => Promise.reject(new Error('handler fail')));
      const t = new ImmediateTransport(handler);
      await expect(t.send({})).rejects.toThrow('handler fail');
    });
  });

  describe('MessageTransport - validation branch', () => {
    it('throws on invalid message type (not in VALID_MESSAGE_TYPES)', async () => {
      const port = { send: vi.fn(() => Promise.resolve({})) };
      const clock = { now: () => Date.now(), sleep: vi.fn(() => Promise.resolve()) };
      const mt = new MessageTransport(port as never, clock as never);
      await expect(mt.send({ type: 'INVALID_TYPE' } as never)).rejects.toThrow('Invalid message type: INVALID_TYPE');
      expect(port.send).not.toHaveBeenCalled();
    });

    it('accepts all valid types with enriched protocolVersion', async () => {
      const port = { send: vi.fn(() => Promise.resolve({ success: true })) };
      const mt = new MessageTransport(port as never);
      // Ensure chrome.runtime.lastError is not set
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { lastError: null, sendMessage: vi.fn() } } as unknown;
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ success: true });
      const sent = port.send.mock.calls[0][0] as { type: string; protocolVersion: number };
      expect(sent.type).toBe('PING');
      expect(sent.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    });
  });

  describe('MessageTransport - retry logic & isRetryableError branches', () => {
    function makeClock() {
      return { now: vi.fn(() => Date.now()), sleep: vi.fn(() => Promise.resolve()) };
    }

    it('does not retry on non-retryable error (immediate throw)', async () => {
      const port = { send: vi.fn(() => Promise.reject(new Error('Some random failure'))) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      await expect(mt.send({ type: 'PING' } as never)).rejects.toThrow('Some random failure');
      expect(port.send).toHaveBeenCalledTimes(1);
      expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('retries on Receiving end does not exist (Error instance)', async () => {
      const port = {
        send: vi
          .fn()
          .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
          .mockResolvedValueOnce({ ok: true }),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const res = await mt.send({ type: 'PING' } as never, { retries: 2 });
      expect(res).toEqual({ ok: true });
      expect(port.send).toHaveBeenCalledTimes(2);
      expect(clock.sleep).toHaveBeenCalledTimes(1);
      expect(clock.sleep).toHaveBeenCalledWith(100); // attempt 0 => 100*2^0 =100
    });

    it('retries on Could not establish connection (string error coercion)', async () => {
      const port = {
        send: vi.fn().mockRejectedValueOnce('Could not establish connection').mockResolvedValueOnce({ ok: 2 }),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const res = await mt.send({ type: 'PING' } as never, { retries: 1 });
      expect(res).toEqual({ ok: 2 });
      expect(clock.sleep).toHaveBeenCalledTimes(1);
    });

    it('retries on The message port closed', async () => {
      const port = {
        send: vi.fn().mockRejectedValueOnce(new Error('The message port closed before a response was received')).mockResolvedValueOnce({ ok: 3 }),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: 3 });
    });

    it('retries on Extension context invalidated (case-insensitive check via regex)', async () => {
      const port = {
        send: vi.fn().mockRejectedValueOnce(new Error('Extension context invalidated.')).mockResolvedValueOnce({ ok: 4 }),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: 4 });
    });

    it('uses exponential backoff: 100, 200, 400 ... capped at 1000', async () => {
      // Fail 4 times then succeed; check delays 100,200,400,800 then capped
      const port = {
        send: vi
          .fn()
          .mockRejectedValueOnce(new Error('Receiving end does not exist'))
          .mockRejectedValueOnce(new Error('Receiving end does not exist'))
          .mockRejectedValueOnce(new Error('Receiving end does not exist'))
          .mockRejectedValueOnce(new Error('Receiving end does not exist'))
          .mockResolvedValueOnce({ ok: true }),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await mt.send({ type: 'PING' } as never, { retries: 5 });
      expect(clock.sleep).toHaveBeenNthCalledWith(1, 100);
      expect(clock.sleep).toHaveBeenNthCalledWith(2, 200);
      expect(clock.sleep).toHaveBeenNthCalledWith(3, 400);
      expect(clock.sleep).toHaveBeenNthCalledWith(4, 800);
    });

    it('caps delay at 1000ms for high attempt numbers', async () => {
      const port = {
        send: vi.fn().mockRejectedValue(new Error('Receiving end does not exist')),
      };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never, { retries: 7 })).rejects.toThrow();
      // delays: attempt 0=100,1=200,2=400,3=800,4=1000(capped),5=1000,6=1000
      expect(clock.sleep).toHaveBeenCalledTimes(7);
      const calls = clock.sleep.mock.calls.map((c) => c[0]);
      expect(calls[4]).toBe(1000);
      expect(calls[5]).toBe(1000);
      expect(calls[6]).toBe(1000);
    });

    it('exhausts retries and throws last error', async () => {
      const err = new Error('Receiving end does not exist');
      const port = { send: vi.fn().mockRejectedValue(err) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never, { retries: 2 })).rejects.toThrow(err);
      expect(port.send).toHaveBeenCalledTimes(3); // 0,1,2
      expect(clock.sleep).toHaveBeenCalledTimes(2); // no sleep after final attempt
    });

    it('retries: 0 means no retry (single attempt)', async () => {
      const port = { send: vi.fn().mockRejectedValue(new Error('Receiving end does not exist')) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never, { retries: 0 })).rejects.toThrow();
      expect(port.send).toHaveBeenCalledTimes(1);
      expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('uses per-call clock override over constructor clock', async () => {
      const ctorClock = { now: vi.fn(() => 0), sleep: vi.fn(() => Promise.resolve()) };
      const callClock = { now: vi.fn(() => 0), sleep: vi.fn(() => Promise.resolve()) };
      const port = {
        send: vi.fn().mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValueOnce({ ok: true }),
      };
      const mt = new MessageTransport(port as never, ctorClock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await mt.send({ type: 'PING' } as never, { clock: callClock });
      expect(callClock.sleep).toHaveBeenCalledTimes(1);
      expect(ctorClock.sleep).not.toHaveBeenCalled();
    });

    it('defaults retries to 3 when opts not provided', async () => {
      const port = { send: vi.fn().mockRejectedValue(new Error('Receiving end does not exist')) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never)).rejects.toThrow();
      expect(port.send).toHaveBeenCalledTimes(4); // 0..3
    });

    it('handles string thrown as error (non-Error)', async () => {
      const port = { send: vi.fn().mockRejectedValue('Receiving end does not exist' as unknown as Error) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never, { retries: 1 })).rejects.toEqual('Receiving end does not exist');
      expect(clock.sleep).toHaveBeenCalledTimes(1);
    });

    it('non-retryable string does not trigger retry', async () => {
      const port = { send: vi.fn().mockRejectedValue('Completely unrelated boom' as unknown as Error) };
      const clock = makeClock();
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      await expect(mt.send({ type: 'PING' } as never)).rejects.toEqual('Completely unrelated boom');
      expect(clock.sleep).not.toHaveBeenCalled();
    });
  });

  describe('chrome.runtime.lastError polling branch', () => {
    it('throws retryable lastError after successful port.send and retries', async () => {
      const clock = { now: vi.fn(() => 0), sleep: vi.fn(() => Promise.resolve()) };
      let callCount = 0;
      const port = {
        send: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            // Simulate callback-style lastError
            (globalThis as unknown as Record<string, unknown>).chrome = {
              runtime: { lastError: { message: 'Receiving end does not exist' } },
            } as unknown;
          } else {
            (globalThis as unknown as Record<string, unknown>).chrome = {
              runtime: { lastError: null },
            } as unknown;
          }
          return { success: true };
        }),
      };
      const mt = new MessageTransport(port as never, clock);
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { lastError: null } } as unknown;
      const res = await mt.send({ type: 'PING' } as never, { retries: 2 });
      expect(res).toEqual({ success: true });
      expect(port.send).toHaveBeenCalledTimes(2);
      expect(clock.sleep).toHaveBeenCalledTimes(1);
    });

    it('does not throw when lastError is non-retryable', async () => {
      const port = { send: vi.fn(() => Promise.resolve({ ok: true })) };
      (globalThis as unknown as Record<string, unknown>).chrome = {
        runtime: { lastError: { message: 'Some unrelated error' } },
      } as unknown;
      const mt = new MessageTransport(port as never);
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: true });
    });

    it('does not throw when lastError is undefined', async () => {
      const port = { send: vi.fn(() => Promise.resolve({ ok: true })) };
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const mt = new MessageTransport(port as never);
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: true });
    });

    it('does not throw when lastError message is empty string (falsy)', async () => {
      const port = { send: vi.fn(() => Promise.resolve({ ok: true })) };
      (globalThis as unknown as Record<string, unknown>).chrome = {
        runtime: { lastError: { message: '' } },
      } as unknown;
      const mt = new MessageTransport(port as never);
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: true });
    });

    it('retries when lastError is retryable and eventually fails if persists', async () => {
      const clock = { now: vi.fn(() => 0), sleep: vi.fn(() => Promise.resolve()) };
      const port = { send: vi.fn(() => Promise.resolve({ ok: true })) };
      (globalThis as unknown as Record<string, unknown>).chrome = {
        runtime: { lastError: { message: 'Extension context invalidated' } },
      } as unknown;
      const mt = new MessageTransport(port as never, clock);
      await expect(mt.send({ type: 'PING' } as never, { retries: 1 })).rejects.toThrow('Extension context invalidated');
      expect(port.send).toHaveBeenCalledTimes(2);
      expect(clock.sleep).toHaveBeenCalledTimes(1);
    });
  });

  describe('default clock and default port', () => {
    it('uses default clock when none provided (sleep via setTimeout path not directly testable but should not throw)', async () => {
      const port = { send: vi.fn(() => Promise.resolve({ ok: true })) };
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: {} } as unknown;
      const mt = new MessageTransport(port as never);
      const res = await mt.send({ type: 'PING' } as never);
      expect(res).toEqual({ ok: true });
    });

    it('creates MessageTransport with no args and sends via mocked chrome.runtime.sendMessage', async () => {
      const sendMessage = vi.fn(() => Promise.resolve({ success: true }));
      (globalThis as unknown as Record<string, unknown>).chrome = { runtime: { sendMessage, lastError: null } } as unknown;
      const mt = new MessageTransport();
      const res = await mt.send({ type: 'PING' } as never);
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'PING', protocolVersion: CURRENT_PROTOCOL_VERSION }));
      expect(res).toEqual({ success: true });
    });
  });
});
