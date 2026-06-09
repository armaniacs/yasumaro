// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

// We test the sanitizeFtsQuery function indirectly by importing from sqlite.ts.
// Since sqlite.ts imports wa-sqlite WASM which can't run in Node.js, we test
// the exported helper functions that don't depend on the WASM module.

// For now, the sanitizeFtsQuery is private. We'll verify its behavior through
// the offscreen message handler's SEARCH path, which will fail gracefully
// when WASM isn't available.

// Test: FTS5 query length limit
// The sanitizeFtsQuery function should truncate extremely long queries.
// Since it's private, we test that a SEARCH message with a very long query
// doesn't cause an error in the message handler (it should pass through
// to the sqlite module which will fail with 'DB not initialized' rather
// than crashing).

import { handleOffscreenMessage, _resetSqliteForTesting } from '../offscreen.js';

describe('FTS5 query handling', () => {
  beforeEach(() => {
    _resetSqliteForTesting();
  });

  it('handles long search queries without crashing', async () => {
    const responses: unknown[] = [];
    // Generate a very long query (1000 chars)
    const longQuery = 'a '.repeat(500).trim();
    expect(longQuery.length).toBeGreaterThan(200);

    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_SEARCH', payload: { query: longQuery } },
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );

    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    // Should return a valid response (even if error), not crash
    expect(resp).toBeDefined();
    expect(typeof resp.success).toBe('boolean');
  });

  it('handles empty search query gracefully', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_SEARCH', payload: { query: '' } },
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );

    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean; error?: string };
    expect(resp).toBeDefined();
  });

  it('handles search query with special characters', async () => {
    const responses: unknown[] = [];
    handleOffscreenMessage(
      { target: 'offscreen', type: 'SQLITE_SEARCH', payload: { query: 'test " OR "1"="1' } },
      {} as chrome.runtime.MessageSender,
      (r) => responses.push(r)
    );

    await vi.waitFor(() => expect(responses.length).toBe(1));
    const resp = responses[0] as { success: boolean };
    // Should not crash
    expect(resp).toBeDefined();
  });
});
