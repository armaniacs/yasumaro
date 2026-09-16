/**
 * ChromeOffscreenTransport.test.ts
 * Chromium container: pins the offscreen document lifecycle, with focus on the
 * concurrent path — two operations in flight at once must not send to a
 * document that was never created.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

import { ChromeOffscreenTransport } from '../ChromeOffscreenTransport.js';

type SendMessageCallback = (response: unknown) => void;

function setupChrome(overrides: {
  hasDocument?: () => Promise<boolean>;
  createDocument?: () => Promise<void>;
  sendMessage?: (message: unknown, cb: SendMessageCallback) => void;
} = {}) {
  const sendMessage = overrides.sendMessage
    ?? ((_message: unknown, cb: SendMessageCallback) => cb({ success: true }));

  const chromeMock = {
    offscreen: {
      hasDocument: overrides.hasDocument ?? (async () => false),
      createDocument: overrides.createDocument ?? (async () => undefined),
      Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
    },
    runtime: {
      sendMessage: vi.fn(sendMessage),
      lastError: undefined as { message: string } | undefined,
    },
  };
  (globalThis as unknown as Record<string, unknown>).chrome = chromeMock;
  return chromeMock;
}

describe('ChromeOffscreenTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).chrome;
  });

  it('creates the offscreen document once and reuses it', async () => {
    const createDocument = vi.fn(async () => undefined);
    const chromeMock = setupChrome({ createDocument });
    const transport = new ChromeOffscreenTransport();

    await transport.msgOffscreen('SQLITE_QUERY', {});
    await transport.msgOffscreen('SQLITE_QUERY', {});

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  /**
   * A failed createDocument() must surface as a rejection, never as a send to
   * a document that was never created — that is what produces the opaque
   * "Receiving end does not exist" instead of a usable error.
   */
  it('does not send when document creation fails', async () => {
    const createDocument = vi.fn(async () => {
      throw new Error('offscreen creation failed');
    });
    const sendMessage = vi.fn((_message: unknown, cb: SendMessageCallback) => {
      cb({ success: true });
    });
    setupChrome({ createDocument, sendMessage });

    const transport = new ChromeOffscreenTransport();

    await expect(
      transport.msgOffscreen('SQLITE_QUERY', {}, '', { noRetry: true }),
    ).rejects.toThrow('offscreen creation failed');

    expect(sendMessage).not.toHaveBeenCalled();
  });

  /**
   * The waiter path (ensureOffscreenDocument's `creatingOffscreenPromise`
   * branch): a call that arrives while creation is in flight must not proceed
   * on a creation that ultimately failed.
   */
  it('does not send when an in-flight creation it waited on fails', async () => {
    let rejectCreate: ((err: Error) => void) | undefined;
    const createDocument = vi.fn(
      () => new Promise<void>((_resolve, reject) => { rejectCreate = reject; }),
    );
    const sendMessage = vi.fn((_message: unknown, cb: SendMessageCallback) => {
      cb({ success: true });
    });
    setupChrome({ createDocument, sendMessage });

    const transport = new ChromeOffscreenTransport() as ChromeOffscreenTransport & {
      ensureOffscreenDocument(): Promise<void>;
    };

    // Drive ensureOffscreenDocument directly: the public path serializes on a
    // Mutex, so the waiter branch is not otherwise reachable from two sends.
    const creator = transport['ensureOffscreenDocument']();
    const waiter = transport['ensureOffscreenDocument']();

    await vi.waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));
    rejectCreate?.(new Error('offscreen creation failed'));

    await expect(creator).rejects.toThrow('offscreen creation failed');
    await expect(waiter).rejects.toThrow('offscreen creation failed');
  });

  it('retries once after a failed send and succeeds on the second attempt', async () => {
    let attempt = 0;
    const sendMessage = vi.fn((_message: unknown, cb: SendMessageCallback) => {
      attempt += 1;
      if (attempt === 1) {
        cb({ error: 'Could not establish connection. Receiving end does not exist.' });
        return;
      }
      cb({ success: true });
    });
    setupChrome({ sendMessage });

    const transport = new ChromeOffscreenTransport();
    const result = await transport.msgOffscreen('SQLITE_QUERY', {});

    expect(result).toEqual({ success: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
