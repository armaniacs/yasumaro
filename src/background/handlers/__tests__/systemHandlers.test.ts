import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFetchUrlHandler,
  createContentCleansingExecutedHandler,
  createCheckDomainHandler,
  createGetPrivacyCacheHandler,
  createActivityUpdateHandler,
  createSessionLockRequestHandler,
  createPingHandler,
  createRefreshLocalMarkdownSchedulerHandler,
  createConsentStateChangedHandler,
  createGenerateReviewSummaryHandler,
  createLogForwardHandler,
} from '../systemHandlers.js';

vi.mock('../../../utils/fetch.js', () => ({
  validateUrlForFilterImport: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/logger.js')>();
  return {
    ...actual,
    logDebug: vi.fn().mockResolvedValue(undefined),
    logWarn: vi.fn().mockResolvedValue(undefined),
    logError: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../utils/storage/savedUrlRepository.js', () => ({
  updateSavedUrlEntry: vi.fn().mockResolvedValue(undefined),
}));

import { validateUrlForFilterImport, fetchWithTimeout } from '../../../utils/fetch.js';
import { updateSavedUrlEntry } from '../../../utils/storage/savedUrlRepository.js';
import { logError } from '../../../utils/logger.js';

describe('createFetchUrlHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const deps = {
    getSettings: vi.fn().mockResolvedValue({}),
    buildAllowedUrls: vi.fn().mockReturnValue(new Set<string>()),
  };

  it('fetches content successfully within limits', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: vi.fn((name: string) => (name === 'content-type' ? 'text/plain' : '1024')),
      },
      text: vi.fn().mockResolvedValue('filter list content'),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: 'filter list content',
      contentType: 'text/plain',
    });
  });

  it('rejects non-ok HTTP response', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: vi.fn().mockReturnValue(null) },
      text: vi.fn().mockResolvedValue(''),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(logError).toHaveBeenCalled();
  });

  it('rejects when Content-Length exceeds limit', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn((name: string) =>
          name === 'content-length' ? String(11 * 1024 * 1024) : null,
        ),
      },
      text: vi.fn().mockResolvedValue(''),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('rejects when actual text size exceeds limit', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(null),
      },
      text: vi.fn().mockResolvedValue('x'.repeat(11 * 1024 * 1024)),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('handles validation errors', async () => {
    vi.mocked(validateUrlForFilterImport).mockImplementation(() => {
      throw new Error('invalid url');
    });

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'bad://url' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(logError).toHaveBeenCalled();
  });

  it('requests redirect: "error" so the SW never follows a redirect (VULN-016)', async () => {
    vi.mocked(validateUrlForFilterImport).mockImplementation(() => {});
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      redirected: false,
      url: 'https://example.com/list.txt',
      headers: { get: vi.fn().mockReturnValue(null) },
      text: vi.fn().mockResolvedValue('content'),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    const opts = vi.mocked(fetchWithTimeout).mock.calls[0][1] as Record<string, unknown>;
    expect(opts.redirect).toBe('error');
  });

  it('does NOT return a body from a redirected response pointing at a private IP (VULN-016)', async () => {
    // Defense in depth: even if a redirect somehow slipped through, a response
    // whose final URL is a private address must not be handed back.
    vi.mocked(validateUrlForFilterImport).mockImplementation(() => {});
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      redirected: true,
      url: 'http://127.0.0.1:9222/json',
      headers: { get: vi.fn().mockReturnValue(null) },
      text: vi.fn().mockResolvedValue('{"internal":"devtools"}'),
    } as any);

    const handler = createFetchUrlHandler(deps);
    const sendResponse = vi.fn();
    await handler({ payload: { url: 'https://example.com/list.txt' } } as any, {} as any, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    const arg = sendResponse.mock.calls[0][0];
    expect(JSON.stringify(arg)).not.toContain('devtools');
    expect(logError).toHaveBeenCalled();
  });
});

describe('createContentCleansingExecutedHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseSender = { tab: { id: 42, url: 'https://example.com/page' } } as chrome.runtime.MessageSender;

  it('sets badge and clears it after timeout when tab has no badge', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 2, keywordStripRemoved: 1, totalRemoved: 3 } } as any, baseSender, sendResponse);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'C3', tabId: 42 });

    vi.advanceTimersByTime(3000);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 42 });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('keeps badge when tab still has badge after timeout', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(true) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 } } as any, baseSender, sendResponse);
    vi.advanceTimersByTime(3000);
    expect(chrome.action.setBadgeText).not.toHaveBeenCalledWith(expect.objectContaining({ text: '', tabId: 42 }));
  });

  it('writes cleansedReason "hard" when only hard strips removed', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 5, keywordStripRemoved: 0, totalRemoved: 5 } } as any, baseSender, sendResponse);
    expect(updateSavedUrlEntry).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.any(Function),
    );
    const updaterHard = vi.mocked(updateSavedUrlEntry).mock.calls[0][1];
    expect(updaterHard({})).toEqual(expect.objectContaining({ cleansedReason: 'hard' }));
  });

  it('writes cleansedReason "keyword" when only keyword strips removed', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 0, keywordStripRemoved: 3, totalRemoved: 3 } } as any, baseSender, sendResponse);
    expect(updateSavedUrlEntry).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.any(Function),
    );
    const updaterKeyword = vi.mocked(updateSavedUrlEntry).mock.calls[0][1];
    expect(updaterKeyword({})).toEqual(expect.objectContaining({ cleansedReason: 'keyword' }));
  });

  it('writes cleansedReason "both" when both removed', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 1, keywordStripRemoved: 1, totalRemoved: 2 } } as any, baseSender, sendResponse);
    expect(updateSavedUrlEntry).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.any(Function),
    );
    const updaterBoth = vi.mocked(updateSavedUrlEntry).mock.calls[0][1];
    expect(updaterBoth({})).toEqual(expect.objectContaining({ cleansedReason: 'both' }));
  });

  it('does not update entry when totalRemoved is 0', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 } } as any, baseSender, sendResponse);
    // updateSavedUrlEntry should not be called because totalRemoved is 0
    expect(updateSavedUrlEntry).not.toHaveBeenCalled();
  });

  it('does not update entry when sender.tab.url is missing', async () => {
    const deps = { hasBadgeTab: vi.fn().mockReturnValue(false) };
    const handler = createContentCleansingExecutedHandler(deps);
    const sendResponse = vi.fn();
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await handler({ payload: { hardStripRemoved: 1, keywordStripRemoved: 0, totalRemoved: 1 } } as any, sender, sendResponse);
    expect(updateSavedUrlEntry).not.toHaveBeenCalled();
  });
});

describe('createCheckDomainHandler', () => {
  it('returns allowed=true when domain is allowed', async () => {
    const deps = { isDomainAllowed: vi.fn().mockResolvedValue(true) };
    const handler = createCheckDomainHandler(deps);
    const sendResponse = vi.fn();
    const sender = { tab: { url: 'https://example.com' } } as chrome.runtime.MessageSender;

    await handler({} as any, sender, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, allowed: true });
  });

  it('returns allowed=false when url is empty', async () => {
    const deps = { isDomainAllowed: vi.fn() };
    const handler = createCheckDomainHandler(deps);
    const sendResponse = vi.fn();
    const sender = { tab: {} } as chrome.runtime.MessageSender;

    await handler({} as any, sender, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, allowed: false });
    expect(deps.isDomainAllowed).not.toHaveBeenCalled();
  });
});

describe('createGetPrivacyCacheHandler', () => {
  it('returns cache entries when cache exists', async () => {
    const cache = new Map([['example.com', { allowed: true }]]);
    const deps = { getPrivacyCache: vi.fn().mockReturnValue(cache) };
    const handler = createGetPrivacyCacheHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, cache: [['example.com', { allowed: true }]] });
  });

  it('returns empty array when cache is null', async () => {
    const deps = { getPrivacyCache: vi.fn().mockReturnValue(null) };
    const handler = createGetPrivacyCacheHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true, cache: [] });
  });
});

describe('createActivityUpdateHandler', () => {
  it('updates activity and responds', async () => {
    const deps = { updateActivity: vi.fn().mockResolvedValue(undefined) };
    const handler = createActivityUpdateHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(deps.updateActivity).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

describe('createSessionLockRequestHandler', () => {
  it('locks session and responds', async () => {
    const deps = { lockSession: vi.fn().mockResolvedValue(undefined) };
    const handler = createSessionLockRequestHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(deps.lockSession).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

describe('createPingHandler', () => {
  it('responds with success', async () => {
    const handler = createPingHandler({});
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

describe('createRefreshLocalMarkdownSchedulerHandler', () => {
  it('initializes scheduler and responds', async () => {
    const deps = { initExportScheduler: vi.fn().mockResolvedValue(undefined) };
    const handler = createRefreshLocalMarkdownSchedulerHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(deps.initExportScheduler).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

describe('createConsentStateChangedHandler', () => {
  it('updates consent badge and responds', async () => {
    const deps = { updateConsentBadge: vi.fn().mockResolvedValue(undefined) };
    const handler = createConsentStateChangedHandler(deps);
    const sendResponse = vi.fn();

    await handler({} as any, {} as any, sendResponse);
    expect(deps.updateConsentBadge).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});

describe('createGenerateReviewSummaryHandler', () => {
  it('generates weekly summary by default', async () => {
    const deps = {
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn(),
    };
    const handler = createGenerateReviewSummaryHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: {} } as any, {} as any, sendResponse);
    expect(deps.generateWeeklySummary).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, generated: true });
  });

  it('generates monthly summary when requested', async () => {
    const deps = {
      generateWeeklySummary: vi.fn(),
      generateMonthlySummary: vi.fn().mockResolvedValue(false),
    };
    const handler = createGenerateReviewSummaryHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: { periodType: 'monthly' } } as any, {} as any, sendResponse);
    expect(deps.generateMonthlySummary).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, generated: false });
  });

  it('returns error response on generation failure', async () => {
    const deps = {
      generateWeeklySummary: vi.fn().mockRejectedValue(new Error('ai down')),
      generateMonthlySummary: vi.fn(),
    };
    const handler = createGenerateReviewSummaryHandler(deps);
    const sendResponse = vi.fn();

    await handler({ payload: {} } as any, {} as any, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

describe('createLogForwardHandler', () => {
  it('forwards error level logs', async () => {
    const handler = createLogForwardHandler();
    const sendResponse = vi.fn();

    await handler({ payload: { level: 'error', message: 'Oops', details: { x: 1 }, source: 'offscreen' } } as any, {} as any, sendResponse);
    expect(logError).toHaveBeenCalledWith('Oops', { x: 1 }, expect.anything(), 'offscreen');
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('forwards warn level logs', async () => {
    const handler = createLogForwardHandler();
    const sendResponse = vi.fn();

    await handler({ payload: { level: 'warn', message: 'Careful', details: {}, source: 'offscreen' } } as any, {} as any, sendResponse);
    expect(logError).not.toHaveBeenCalled();
    // logWarn is mocked but we didn't spy directly; just assert success response
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('forwards debug level logs for unknown levels', async () => {
    const handler = createLogForwardHandler();
    const sendResponse = vi.fn();

    await handler({ payload: { level: 'info', message: 'Hello', source: 'offscreen' } } as any, {} as any, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
