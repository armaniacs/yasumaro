/**
 * dashboardSqliteService.test.ts
 * Tests for dashboard SQLite service layer (message-passing proxy).
 *
 * Uses Promise-based chrome.runtime.sendMessage mock matching the
 * production sendDashboardMessage implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { givenHandshakeResponse, givenHandshakeError } from './helpers/dashboardSqliteMock.js';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

/**
 * Mock chrome.runtime.sendMessage to return a controlled Promise response.
 * After calling this, the NEXT call to sendMessage will use the given response.
 */
function givenResponse(response: any) {
  // PBI 2026-09-04-01: destructive ops require a confirm-token handshake.
  // Route by subtype: create_confirm_token gets a token, the op gets the script.
  givenHandshakeResponse(response);
}

/**
 * Mock chrome.runtime.sendMessage to reject (simulating lastError / connection failure).
 */
function givenLastError(errorMessage: string) {
  // Handshake-aware: token fetch succeeds, the operation rejects.
  givenHandshakeError(errorMessage);
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
      givenResponse({ success: true, rows: [{ id: 1, url: 'https://example.com', created_at: 1000 }], total: 1 });

      const result = await queryLogs({ limit: 10, offset: 0 });

       expect(result).toEqual({ data: { rows: [{ id: 1, url: 'https://example.com', created_at: 1000 }], total: 1 } });
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

    it('rejects a successful response without the required rows array', async () => {
      givenResponse({ success: true, total: 0 });

      const result = await queryLogs();

      expect(result).toEqual({ error: 'Invalid SQLite response: rows' });
    });

    it('rejects rows that do not contain the required entry fields', async () => {
      givenResponse({ success: true, rows: [{ id: 1, url: 'https://example.com' }], total: 1 });

      const result = await queryLogs();

      expect(result).toEqual({ error: 'Invalid SQLite response: rows' });
    });

    it('surfaces the failure reason on rejection', async () => {
      givenLastError('Connection failed');

      const result = await queryLogs();
      expect(result).toEqual({ error: 'Unexpected error: Connection failed' });
    });
  });

  describe('searchLogs', () => {
    it('returns search results on success', async () => {
      givenResponse({ success: true, rows: [{ id: 2, url: 'https://example.com/search', created_at: 2000 }], total: 1 });

      const result = await searchLogs('test query', 20, 0);
      expect(result).toEqual({ data: { rows: [{ id: 2, url: 'https://example.com/search', created_at: 2000 }], total: 1 } });
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

    it('surfaces the failure reason on rejection', async () => {
      givenLastError('Timeout');

      const result = await searchLogs('test');
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
    });

    it('passes orderBy/orderDir through to the message payload', async () => {
      givenResponse({ success: true, rows: [], total: 0 });
      await searchLogs('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
      expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ subtype: 'search', query: 'kddi', limit: 20, offset: 0, orderBy: 'created_at', orderDir: 'ASC' }) })
      );
    });

    it('omits orderBy/orderDir from the payload when not provided', async () => {
      givenResponse({ success: true, rows: [], total: 0 });
      await searchLogs('kddi', 20, 0);
      const call = (globalThis as any).chrome.runtime.sendMessage.mock.calls[(globalThis as any).chrome.runtime.sendMessage.mock.calls.length - 1][0];
      expect(call.payload.orderBy).toBeUndefined();
      expect(call.payload.orderDir).toBeUndefined();
    });
  });

  describe('toggleStar', () => {
    it('returns is_starred on success', async () => {
      givenResponse({ success: true, is_starred: 1 });

      const result = await toggleStar(42);
      expect(result).toEqual({ data: { is_starred: 1 } });
    });

    it('reports an error when is_starred is missing instead of substituting a value', async () => {
      givenResponse({ success: true });

      const result = await toggleStar(42);
      expect(result).toEqual({ error: 'Invalid SQLite response: is_starred' });
    });

    // Failures carry their reason instead of collapsing to null: the panel
    // renders it, and a bare null made a failed toggle look like a no-op.
    it('surfaces the failure reason instead of null', async () => {
      givenResponse({ success: false, error: 'Storage quota exceeded.' });

      const result = await toggleStar(42);
      expect(result).toEqual({ error: 'Storage quota exceeded.' });
    });

    it('falls back to a generic message when the failure has no error text', async () => {
      givenResponse({ success: false });

      const result = await toggleStar(42);
      expect(result).toEqual({ error: 'Toggle star failed' });
    });

    it('surfaces the reason on rejection', async () => {
      givenLastError('Timeout');

      const result = await toggleStar(42);
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
    });

    // callDashboard() logs every non-exception failure via console.warn
    // (PBI-39), distinct from the console.error used for thrown exceptions.
    it('logs a warning (not an error) when the service worker reports failure', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      givenResponse({ success: false, error: 'Storage quota exceeded.' });

      await toggleStar(42);

      expect(warnSpy).toHaveBeenCalledWith('toggle_star failed:', 'Storage quota exceeded.');
      warnSpy.mockRestore();
    });
  });

  describe('deleteLog', () => {
    it('returns ok on success', async () => {
      givenResponse({ success: true });

      const result = await deleteLog(42);
      expect(result).toEqual({ data: undefined });
    });

    it('surfaces the failure reason instead of false', async () => {
      givenResponse({ success: false, error: 'Storage quota exceeded.' });

      const result = await deleteLog(42);
      expect(result).toEqual({ error: 'Storage quota exceeded.' });
    });

    it('falls back to a generic message when the failure has no error text', async () => {
      givenResponse({ success: false });

      const result = await deleteLog(42);
      expect(result).toEqual({ error: 'Delete failed' });
    });

    it('surfaces the reason on rejection', async () => {
      givenLastError('Timeout');

      const result = await deleteLog(42);
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
    });
  });

  describe('updateLog', () => {
    it('returns the success side on success', async () => {
      givenResponse({ success: true });

      const result = await updateLog(1, { title: 'Updated' });
      expect(result).toEqual({ data: undefined });
    });

    it('surfaces the reason on rejection', async () => {
      givenLastError('Timeout');

      const result = await updateLog(1, {});
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
    });
  });

  describe('getLogCount', () => {
    it('returns count on success', async () => {
      givenResponse({ success: true, count: 42 });

      const result = await getLogCount();
      expect(result).toEqual({ data: 42 });
    });

    it('surfaces the failure reason on failed response', async () => {
      givenResponse({ success: false });

      const result = await getLogCount();
      expect(result).toEqual({ error: 'Get count failed' });
    });

    it('surfaces the failure reason on rejection', async () => {
      givenLastError('Timeout');

      const result = await getLogCount();
      expect(result).toEqual({ error: 'SQLite request timed out. The database may still be initializing.' });
    });
  });
});
