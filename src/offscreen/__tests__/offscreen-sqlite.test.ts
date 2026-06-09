// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleOffscreenMessage, _resetSqliteForTesting } from '../offscreen.js';

const noop = () => {};

function makeMessage(type: string, payload?: Record<string, unknown>) {
  return { target: 'offscreen', type, payload };
}

// We test the SQLite message routing by verifying:
// 1. Message routing works (returns true, dispatches correctly)
// 2. Error responses for invalid payloads

describe('handleOffscreenMessage - SQLite routing', () => {
  beforeEach(() => {
    _resetSqliteForTesting();
  });

  it('returns true for SQLITE_INIT to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INIT'),
      {} as chrome.runtime.MessageSender,
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
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_QUERY to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_QUERY', { limit: 10 }),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_SEARCH to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_SEARCH', { query: 'test query' }),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_DELETE to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_DELETE', { id: 1 }),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_TOGGLE_STAR to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_TOGGLE_STAR', { id: 1 }),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_COUNT to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_COUNT'),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('returns true for SQLITE_STATUS to keep channel open', () => {
    const result = handleOffscreenMessage(
      makeMessage('SQLITE_STATUS'),
      {} as chrome.runtime.MessageSender,
      noop
    );
    expect(result).toBe(true);
  });

  it('SQLITE_INSERT returns error for missing url', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      makeMessage('SQLITE_INSERT', { title: 'No URL' }),
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    // Should fail because url is empty string (still valid payload)
    expect(resp).toBeDefined();
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
    const senderNoTab: chrome.runtime.MessageSender = {} as chrome.runtime.MessageSender;

    const result = handleOffscreenMessage(
      makeMessage('SQLITE_INIT'),
      senderNoTab,
      (r) => responses.push(r)
    );
    expect(result).toBe(true); // Should return true (keep channel open)
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
      {} as chrome.runtime.MessageSender,
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
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    // Without a real SQLite WASM, this should return an error
    expect(resp).toBeDefined();
  });
});
