/**
 * messageHandlers.test.ts
 * Tests for the VALID_VISIT handler factory (PBI 2026-10-01-03: the flood
 * guard and the consent read live in the shared RecordingAdmission — those
 * behaviours are pinned in recordingAdmission.test.ts. The handler keeps
 * request assembly, badge updates, and the confirmation notification).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createValidVisitHandler } from '../recordingHandlers.js';
import type { ValidVisitHandlerDeps } from '../recordingHandlers.js';
import type { ValidVisitMessage } from '../../messageTypes.js';

function makeDeps(overrides: Partial<ValidVisitHandlerDeps> = {}): ValidVisitHandlerDeps {
  return {
    admit: vi.fn().mockResolvedValue({ settings: {} }),
    cacheTab: vi.fn(),
    updateCachedTab: vi.fn(),
    recordVisit: vi.fn<ValidVisitHandlerDeps['recordVisit']>(
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
    expect(deps.admit).not.toHaveBeenCalled();
  });

  it('admits with the valid-visit kind and records the first visit', async () => {
    const deps = makeDeps();
    const handler = createValidVisitHandler(deps);
    const sendResponse = vi.fn();
    const sender = {
      tab: { id: 1, url: 'https://example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), sender, sendResponse);

    expect(deps.admit).toHaveBeenCalledWith('valid-visit', sender);
    expect(deps.recordVisit).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('passes the admission rejection through unchanged', async () => {
    const deps = makeDeps({
      admit: vi.fn().mockResolvedValue({ rejected: { success: false, reason: 'rate_limited' } }),
    });
    const handler = createValidVisitHandler(deps);
    const sendResponse = vi.fn();
    const sender = {
      tab: { id: 1, url: 'https://rate-limit.example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), sender, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, reason: 'rate_limited' });
    expect(deps.recordVisit).not.toHaveBeenCalled();
  });

  it('adds the badge tab only for a successful, non-skipped record', async () => {
    const deps = makeDeps({
      recordVisit: vi.fn<ValidVisitHandlerDeps['recordVisit']>(
        async () => ({ success: true, skipped: true }),
      ),
    });
    const handler = createValidVisitHandler(deps);
    const sender = {
      tab: { id: 1, url: 'https://example.com', title: 'Example' },
    } as chrome.runtime.MessageSender;

    await handler(makeVisitMessage(), sender, vi.fn());

    expect(deps.addBadgeTab).not.toHaveBeenCalled();
  });
});
