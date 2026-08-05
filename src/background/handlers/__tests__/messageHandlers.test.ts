/**
 * messageHandlers.test.ts
 * Tests for message handler factories, focusing on VALID_VISIT rate limiting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createValidVisitHandler, resetVisitRateLimiter } from '../messageHandlers.js';
import type { ValidVisitHandlerDeps } from '../messageHandlers.js';
import type { ValidVisitMessage } from '../../messageTypes.js';
import type { RecordingResult } from '../../../messaging/types.js';

function makeDeps(overrides: Partial<ValidVisitHandlerDeps> = {}): ValidVisitHandlerDeps {
  return {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    cacheTab: vi.fn(),
    updateCachedTab: vi.fn(),
    recordVisit: vi.fn<Promise<RecordingResult>, [Parameters<ValidVisitHandlerDeps['recordVisit']>[0]]>(
      async () => ({ success: true, skipped: false }),
    ),
    addBadgeTab: vi.fn(),
    hasBadgeTab: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeVisitMessage(): ValidVisitMessage {
  return { type: 'VALID_VISIT', payload: { content: 'test content' } };
}

describe('createValidVisitHandler', () => {
  beforeEach(() => {
    resetVisitRateLimiter();
    vi.stubGlobal('chrome', {
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
      i18n: { getMessage: vi.fn((key: string) => key) },
      runtime: { id: 'test-extension-id' },
    } as unknown as typeof chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('responds with an error when sender.tab is missing', async () => {
    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sendResponse = vi.fn();

    await handler(makeVisitMessage(), {} as chrome.runtime.MessageSender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Invalid sender' });
    expect(deps.recordVisit).not.toHaveBeenCalled();
  });

  it('records the first visit for a URL', async () => {
    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sendResponse = vi.fn();
    const sender = {
      tab: { id: 1, url: 'https://example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), sender, sendResponse);

    expect(deps.recordVisit).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('rejects a repeated VALID_VISIT for the same URL within the rate window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sender = {
      tab: { id: 1, url: 'https://rate-limit.example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    const firstResponse = vi.fn();
    await handler(makeVisitMessage(), sender, firstResponse);
    expect(firstResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const secondResponse = vi.fn();
    await handler(makeVisitMessage(), sender, secondResponse);
    expect(secondResponse).toHaveBeenCalledWith({ success: false, reason: 'rate_limited' });
    expect(deps.recordVisit).toHaveBeenCalledTimes(1);
  });

  it('allows a new VALID_VISIT after the rate window has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sender = {
      tab: { id: 1, url: 'https://rate-window.example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), sender, vi.fn());

    vi.advanceTimersByTime(5001);

    const retryResponse = vi.fn();
    await handler(makeVisitMessage(), sender, retryResponse);
    expect(retryResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(deps.recordVisit).toHaveBeenCalledTimes(2);
  });

  it('VULN-002: throttles same-origin visits across path/fragment rotation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const first = { tab: { id: 1, url: 'https://rotate.example.com/start', title: 'T' } } as chrome.runtime.MessageSender;
    await handler(makeVisitMessage(), first, vi.fn());

    // Same origin, different path + fragment (pushState rotation) — the
    // throttle must still apply, otherwise a hostile page bypasses it.
    const rotated = { tab: { id: 1, url: 'https://rotate.example.com/other#frag?x=1', title: 'T' } } as chrome.runtime.MessageSender;
    const resp = vi.fn();
    await handler(makeVisitMessage(), rotated, resp);

    expect(resp).toHaveBeenCalledWith({ success: false, reason: 'rate_limited' });
    expect(deps.recordVisit).toHaveBeenCalledTimes(1);
  });

  it('does not rate limit different URLs against each other', async () => {
    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);

    const senderA = {
      tab: { id: 1, url: 'https://a.example.com', title: 'A' },
    } as chrome.runtime.MessageSender;
    const senderB = {
      tab: { id: 2, url: 'https://b.example.com', title: 'B' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), senderA, vi.fn());
    const responseB = vi.fn();
    await handler(makeVisitMessage(), senderB, responseB);

    expect(responseB).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(deps.recordVisit).toHaveBeenCalledTimes(2);
  });

  it('skips the rate limiter when sender.tab.url is missing', async () => {
    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sender = {
      tab: { id: 1, title: 'No URL' },
    } as chrome.runtime.MessageSender;

    const sendResponse = vi.fn();
    await handler(makeVisitMessage(), sender, sendResponse);

    expect(deps.recordVisit).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
