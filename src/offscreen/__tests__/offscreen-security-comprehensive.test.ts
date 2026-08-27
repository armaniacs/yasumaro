/**
 * offscreen-security-comprehensive.test.ts
 * Security-focused tests for the offscreen document message dispatcher —
 * validates sender authentication, message validation, and authorized sender tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock recordsRepo before importing offscreen
vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  hardDelete: vi.fn(),
  toggleStar: vi.fn(),
  getCount: vi.fn(),
  getStatus: vi.fn(),
  clearAll: vi.fn(),
  serialize: vi.fn(),
}));

import { handleOffscreenMessage } from '../offscreen.js';

const EXTENSION_ID = 'test-extension-id';

function setupChrome() {
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: { id: EXTENSION_ID },
  };
}

function cleanupChrome() {
  delete (globalThis as unknown as Record<string, unknown>).chrome;
}

describe('offscreen message security', () => {
  beforeEach(() => {
    setupChrome();
  });

  afterEach(() => {
    cleanupChrome();
  });

  // ── Sender authentication ────────────────────────────────────────────

  it('ignores messages not targeted at offscreen (returns false)', () => {
    const result = handleOffscreenMessage(
      { type: 'SQLITE_HEALTH_CHECK' } as any,
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      () => {}
    );
    expect(result).toBe(false);
  });

  it('rejects messages from content scripts (sender.tab present)', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_HEALTH_CHECK' },
      { id: EXTENSION_ID, tab: { id: 1 } } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
  });

  it('rejects messages from a different extension (sender.id mismatch)', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_HEALTH_CHECK' },
      { id: 'different-extension-id' } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
  });

  it('rejects messages when chrome.runtime.id is undefined', async () => {
    (globalThis as any).chrome.runtime.id = undefined;
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_HEALTH_CHECK' },
      { id: 'some-id' } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
  });

  // ── Message validation ───────────────────────────────────────────────

  it('rejects null/undefined messages', () => {
    const responses: unknown[] = [];
    const result = handleOffscreenMessage(
      null as any,
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    expect(result).toBe(false);
    expect(responses).toHaveLength(0);
  });

  it('ignores messages with invalid target (returns false)', () => {
    const result = handleOffscreenMessage(
      { target: 'background', type: 'SQLITE_HEALTH_CHECK' },
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      () => {}
    );
    expect(result).toBe(false);
  });

  it('rejects messages with unknown SQLite message type', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_UNKNOWN_TYPE' },
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
  });

  // ── Payload guard integration ────────────────────────────────────────

  it('rejects oversized INSERT payload before processing', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      {
        target: 'offscreen',
        type: 'SQLITE_INSERT',
        payload: { url: 'https://x.com', summary: 'a'.repeat(1024 * 1024 + 1) },
      },
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/Payload too large|exceeds/i);
  });

  it('rejects batch with too many records before processing', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      {
        target: 'offscreen',
        type: 'SQLITE_INSERT_BATCH',
        payload: { records: Array.from({ length: 2001 }, (_, i) => ({ url: `https://${i}.com` })) },
      },
      { id: EXTENSION_ID } as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('maximum');
  });

  // ── Missing sender fields ────────────────────────────────────────────

  it('handles sender with no id (null id)', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_HEALTH_CHECK' },
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );
    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp.success).toBe(false);
  });
});
