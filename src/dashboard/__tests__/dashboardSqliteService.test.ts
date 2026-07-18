/**
 * dashboardSqliteService.test.ts
 * Tests for dashboard SQLite service layer (message-passing proxy).
 *
 * Uses Promise-based chrome.runtime.sendMessage mock matching the
 * production sendDashboardMessage implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

/**
 * Mock chrome.runtime.sendMessage to return a controlled Promise response.
 * After calling this, the NEXT call to sendMessage will use the given response.
 */
function givenResponse(response: any) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: any) => Promise.resolve(response),
  );
}

/**
 * Mock chrome.runtime.sendMessage to reject (simulating lastError / connection failure).
 */
function givenLastError(errorMessage: string) {
  (globalThis as any).chrome.runtime.sendMessage = vi.fn(
    (_message: any) => Promise.reject(new Error(errorMessage)),
  );
}

import { queryLogs, searchLogs, toggleStar, deleteLog, updateLog, getLogCount } from '../dashboardSqliteService.js';

describe('dashboardSqliteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure chrome runtime exists
    if (!(globalThis as any).chrome) {
      (globalThis as any).chrome = {};
    }
    if (!(globalThis as any).chrome.runtime) {
      (globalThis as any).chrome.runtime = {};
    }
  });

  describe('queryLogs', () => {
    it('returns rows and total on success', async () => {
      givenResponse({ success: true, rows: [{ id: 1, url: 'https://example.com' }], total: 1 });

      const result = await queryLogs({ limit: 10, offset: 0 });

      expect(result).toEqual({ rows: [{ id: 1, url: 'https://example.com' }], total: 1 });
    });

    it('sends the correct message payload', async () => {
      givenResponse({ success: true, rows: [], total: 0 });

      await queryLogs({ limit: 10, offset: 0 });

      expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: 'DASHBOARD_SQLITE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: { subtype: 'query', limit: 10, offset: 0 } },
      );
    });

    it('returns error object on failed response', async () => {
      givenResponse({ success: false, error: 'DB error' });

      const result = await queryLogs();
      expect(result).toEqual({ error: 'DB error' });
    });

    it('returns null on rejection', async () => {
      givenLastError('Connection failed');

      const result = await queryLogs();
      expect(result).toBeNull();
    });
  });

  describe('searchLogs', () => {
    it('returns search results on success', async () => {
      givenResponse({ success: true, rows: [{ id: 2, url: 'https://example.com/search' }], total: 1 });

      const result = await searchLogs('test query', 20, 0);
      expect(result).toEqual({ rows: [{ id: 2, url: 'https://example.com/search' }], total: 1 });
    });

    it('uses default limit and offset', async () => {
      givenResponse({ success: true, rows: [], total: 0 });

      await searchLogs('test');
      expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ subtype: 'search', query: 'test', limit: 50, offset: 0 }),
        }),
      );
    });

    it('returns null on rejection', async () => {
      givenLastError('Timeout');

      const result = await searchLogs('test');
      expect(result).toBeNull();
    });
  });

  describe('toggleStar', () => {
    it('returns is_starred on success', async () => {
      givenResponse({ success: true, is_starred: 1 });

      const result = await toggleStar(42);
      expect(result).toEqual({ is_starred: 1 });
    });

    it('returns null on failed response', async () => {
      givenResponse({ success: false });

      const result = await toggleStar(42);
      expect(result).toBeNull();
    });

    it('returns null on rejection', async () => {
      givenLastError('Timeout');

      const result = await toggleStar(42);
      expect(result).toBeNull();
    });
  });

  describe('deleteLog', () => {
    it('returns true on success', async () => {
      givenResponse({ success: true });

      const result = await deleteLog(42);
      expect(result).toBe(true);
    });

    it('returns false on failed response', async () => {
      givenResponse({ success: false });

      const result = await deleteLog(42);
      expect(result).toBe(false);
    });

    it('returns false on rejection', async () => {
      givenLastError('Timeout');

      const result = await deleteLog(42);
      expect(result).toBe(false);
    });
  });

  describe('updateLog', () => {
    it('returns true on success', async () => {
      givenResponse({ success: true });

      const result = await updateLog(1, { title: 'Updated' });
      expect(result).toBe(true);
    });

    it('returns false on rejection', async () => {
      givenLastError('Timeout');

      const result = await updateLog(1, {});
      expect(result).toBe(false);
    });
  });

  describe('getLogCount', () => {
    it('returns count on success', async () => {
      givenResponse({ success: true, count: 42 });

      const result = await getLogCount();
      expect(result).toBe(42);
    });

    it('returns 0 on failed response', async () => {
      givenResponse({ success: false });

      const result = await getLogCount();
      expect(result).toBe(0);
    });

    it('returns 0 on rejection', async () => {
      givenLastError('Timeout');

      const result = await getLogCount();
      expect(result).toBe(0);
    });
  });
});
