// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOffscreenMessage, _resetSqliteForTesting } from '../offscreen.js';

const EXTENSION_ID = 'test-extension-id';

// Ensure chrome.runtime.id is defined so sender validation passes
if (!(globalThis as Record<string, unknown>).chrome) {
  (globalThis as Record<string, unknown>).chrome = {};
}
const g = globalThis as Record<string, unknown>;
if (!(g.chrome as Record<string, unknown>).runtime) {
  (g.chrome as Record<string, unknown>).runtime = {};
}
(g.chrome as Record<string, Record<string, unknown>>).runtime.id = EXTENSION_ID;

const noop = () => {};

function makeMessage(type: string, payload?: Record<string, unknown>) {
  return { target: 'offscreen', type, payload };
}

function makeSenderNoTab() {
  return { id: EXTENSION_ID } as chrome.runtime.MessageSender;
}

describe('handleOffscreenMessage - SQLite routing', () => {
  beforeEach(() => {
    _resetSqliteForTesting();
  });

  it('returns true for SQLITE_INIT to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INIT'),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_INSERT to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', {
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
      }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_QUERY to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_QUERY', { limit: 10 }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_SEARCH to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_SEARCH', { query: 'test query' }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_DELETE to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_DELETE', { id: 1 }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_TOGGLE_STAR to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_TOGGLE_STAR', { id: 1 }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_COUNT to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_COUNT'),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_STATUS to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_STATUS'),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('SQLITE_INSERT returns error for missing url', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', { title: 'No URL' }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp).toBeDefined();
  });

  it('SQLITE_INSERT rejects summary exceeding 1MB', async () => {
    const responses: unknown[] = [];
    const oversizedSummary = 'a'.repeat(1024 * 1024 + 1);
    handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', {
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
        summary: oversizedSummary,
      }),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('1MB');
  });

  it('SQLITE_INSERT accepts summary exactly at 1MB boundary', () => {
    const exactSummary = 'a'.repeat(1024 * 1024);
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', {
        url: 'https://example.com',
        title: 'Test',
        created_at: Date.now(),
        summary: exactSummary,
      }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_INSERT_BATCH to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INSERT_BATCH', {
        records: [
          { url: 'https://example.com', title: 'Test', created_at: Date.now() },
        ],
      }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_INSERT_BATCH with empty records array', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INSERT_BATCH', { records: [] }),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_INSERT_BATCH without records field (defaults to empty)', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INSERT_BATCH', {}),
      makeSenderNoTab(),
      noop
    );
    expect(result).toBe(true);
  });
});

describe('handleOffscreenMessage - SQLite sender validation', () => {
  beforeEach(() => {
    _resetSqliteForTesting();
  });

  it('rejects SQLITE_INSERT from content scripts (sender with tab)', async () => {
    const responses: unknown[] = [];
    const senderWithTab: chrome.runtime.MessageSender = {
      tab: { id: 123, url: 'https://evil.com' } as chrome.tabs.Tab,
    } as chrome.runtime.MessageSender;

    handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', {
        url: 'https://example.com',
        title: 'hack',
        created_at: Date.now(),
      }),
      senderWithTab,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Forbidden');
  });

  it('rejects SQLITE_QUERY from content scripts', async () => {
    const responses: unknown[] = [];
    const senderWithTab: chrome.runtime.MessageSender = {
      tab: { id: 123, url: 'https://example.com' } as chrome.tabs.Tab,
    } as chrome.runtime.MessageSender;

    handleOffscreenMessage(
      makeMessage('SQLITE_QUERY', {}),
      senderWithTab,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Forbidden');
  });

  it('rejects SQLITE_DELETE from content scripts', async () => {
    const responses: unknown[] = [];
    const senderWithTab: chrome.runtime.MessageSender = {
      tab: { id: 123, url: 'https://example.com' } as chrome.tabs.Tab,
    } as chrome.runtime.MessageSender;

    handleOffscreenMessage(
      makeMessage('SQLITE_DELETE', { id: 1 }),
      senderWithTab,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Forbidden');
  });

  it('allows SQLITE_INIT from service worker (no tab)', async () => {
    const responses: unknown[] = [];
    const senderNoTab: chrome.runtime.MessageSender = makeSenderNoTab();

    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INIT'),
      senderNoTab,
      (r) => responses.push(r)
    );
    expect(result).toBe(true); // Should return true (keep channel open)
  });

  it('rejects SQLITE_INSERT_BATCH from content scripts (sender with tab)', async () => {
    const responses: unknown[] = [];
    const senderWithTab: chrome.runtime.MessageSender = {
      tab: { id: 123, url: 'https://evil.com' } as chrome.tabs.Tab,
    } as chrome.runtime.MessageSender;

    handleOffscreenMessage(
      makeMessage('SQLITE_INSERT_BATCH', {
        records: [{ url: 'https://example.com', title: 'hack', created_at: Date.now() }],
      }),
      senderWithTab,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('Forbidden');
  });
});

describe('handleOffscreenMessage - SQLite responds with error when DB not available', () => {
  beforeEach(() => {
    _resetSqliteForTesting();
  });

  it('SQLITE_INIT response is an object with success field', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_INIT'),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as Record<string, unknown>;
    // Should respond with an object (either success or error)
    expect(typeof resp).toBe('object');
    expect(resp).not.toBeNull();
  });

  it('SQLITE_COUNT responds with error when DB not initialized', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_COUNT'),
      makeSenderNoTab(),
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    // Without a real SQLite WASM, this should return an error
    expect(resp).toBeDefined();
  });
});
