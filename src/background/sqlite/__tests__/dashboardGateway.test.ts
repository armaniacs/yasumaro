/**
 * dashboardGateway.test.ts — BDD tests for PBI 03 fail-closed fix
 *
 * Covers DashboardGateway.callDashboard fail-closed behaviour:
 * - Happy path: token obtained, destructive IPC sent with token, success decoded
 * - Fail-closed null: getDashboardConfirmToken returns null, IPC NOT sent
 * - Fail-closed timeout: token fetch times out, IPC NOT sent
 * - No retry: single null result produces no second create_confirm_token call
 * - Exempt ops: query/search bypass token check, IPC sent without token
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardGateway } from '../../../messaging/dashboardGateway.js';
import { CURRENT_PROTOCOL_VERSION } from '../../messageTypes.js';

// Helper to install a controllable chrome.runtime.sendMessage mock
function installChromeMock() {
  if (!(globalThis as any).chrome) (globalThis as any).chrome = {};
  if (!(globalThis as any).chrome.runtime) (globalThis as any).chrome.runtime = {};
}

describe('DashboardGateway — PBI 03 confirm-token fail-closed', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    installChromeMock();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useRealTimers();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  describe('Happy path: confirm token obtained, IPC sent with token', () => {
    it('Given a destructive op requiring a token, When token fetch succeeds, Then it sends the main IPC with confirmToken and decodes the success response', async () => {
      // Arrange: first call = create_confirm_token returns token, second call = delete returns success
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          expect(msg.type).toBe('DASHBOARD_SQLITE');
          expect(msg.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
          expect(msg.payload.action).toBe('delete');
          expect(msg.payload.id).toBe(42);
          return { success: true, confirmToken: 'tok-abc-123' };
        }
        if (msg.payload.subtype === 'delete') {
          // Then: main payload must carry the token
          expect(msg.payload.confirmToken).toBe('tok-abc-123');
          expect(msg.payload.id).toBe(42);
          expect(msg.type).toBe('DASHBOARD_SQLITE');
          expect(msg.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
          return { success: true };
        }
        throw new Error(`Unexpected subtype ${msg.payload.subtype}`);
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();

      // Act
      const result = await gateway.callDashboard(
        { subtype: 'delete', id: 42 } as any,
        () => ({ deleted: true }),
        'Delete failed',
      );

      // Assert: decoded success
      expect(result).toEqual({ success: true, data: { deleted: true } });
      expect(sendMessageMock).toHaveBeenCalledTimes(2);
      // First call was token fetch, second was destructive op
      expect(sendMessageMock.mock.calls[0][0].payload.subtype).toBe('create_confirm_token');
      expect(sendMessageMock.mock.calls[1][0].payload.subtype).toBe('delete');
    });

    it('Given a destructive toggle_star op, When token is obtained, Then IPC is sent with token including id', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          expect(msg.payload.action).toBe('toggle_star');
          expect(msg.payload.id).toBe(7);
          return { success: true, confirmToken: 'tok-xyz' };
        }
        expect(msg.payload.subtype).toBe('toggle_star');
        expect(msg.payload.confirmToken).toBe('tok-xyz');
        return { success: true, is_starred: 1 };
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'toggle_star', id: 7 } as any,
        (res: any) => ({ is_starred: res.is_starred }),
        'Toggle star failed',
      );

      expect(result).toEqual({ success: true, data: { is_starred: 1 } });
      expect(sendMessageMock).toHaveBeenCalledTimes(2);
    });

    it('Given a destructive operation without id, When token is obtained, Then token request omits id but main IPC still carries token', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          expect(msg.payload.action).toBe('clear_all');
          expect(msg.payload).not.toHaveProperty('id');
          return { success: true, confirmToken: 'tok-clear' };
        }
        expect(msg.payload.subtype).toBe('clear_all');
        expect(msg.payload.confirmToken).toBe('tok-clear');
        return { success: true };
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'clear_all' } as any,
        () => undefined,
        'Clear all failed',
      );

      expect(result).toEqual({ success: true, data: undefined });
    });
  });

  // -------------------------------------------------------------------------
  // Fail-closed: null
  // -------------------------------------------------------------------------
  describe('Fail-closed null: getDashboardConfirmToken returns null', () => {
    it('Given token fetch returns null, When calling a destructive op, Then IPC for the destructive op is NOT sent and an SqliteResult error is returned', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          // Simulate service returning success:false (no token) -> getDashboardConfirmToken returns null
          return { success: false, error: 'token unavailable' } as any;
        }
        // Should never reach here for destructive payload
        throw new Error(`Destructive IPC must not be sent when token is null, but got ${msg.payload.subtype}`);
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'delete', id: 99 } as any,
        () => undefined,
        'Delete failed',
      );

      // Assert: fail-closed error via categorizeError
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Dashboard confirm token unavailable');
        // categorizeError maps unknown messages to kind 'unknown'
        expect(result.error.kind).toBe('unknown');
        expect(result.error.retriable).toBe(false);
      }
      // Only the token fetch was attempted, no second IPC
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock.mock.calls[0][0].payload.subtype).toBe('create_confirm_token');
    });

    it('Given token fetch returns success without confirmToken string, When calling destructive op, Then it fail-closes without sending IPC', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          return { success: true } as any; // missing confirmToken field
        }
        throw new Error('Should not send destructive IPC');
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'update', id: 1, changes: { title: 'x' } } as any,
        () => undefined,
        'Update failed',
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.message).toContain('Dashboard confirm token unavailable');
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('Given token fetch rejects (chrome error), When calling destructive op, Then it still fail-closes without sending destructive IPC', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          throw new Error('chrome runtime disconnected');
        }
        throw new Error('Destructive IPC must not be sent');
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'delete', id: 5 } as any,
        () => undefined,
        'Delete failed',
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.message).toContain('Dashboard confirm token unavailable');
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Fail-closed: timeout
  // -------------------------------------------------------------------------
  describe('Fail-closed timeout: token fetch times out', () => {
    it('Given token fetch times out (never resolves), When calling destructive op with fake timers, Then IPC NOT sent for destructive op and error is returned', async () => {
      vi.useFakeTimers();

      // Never-resolving promise simulates the chrome.runtime.sendMessage hanging until the internal 10s race fires
      const hangingMock = vi.fn(() => new Promise(() => {}));
      (globalThis as any).chrome.runtime.sendMessage = hangingMock;

      const gateway = new DashboardGateway();
      const promise = gateway.callDashboard(
        { subtype: 'delete', id: 123 } as any,
        () => undefined,
        'Delete failed',
      );

      // Advance past DASHBOARD_SQLITE_TIMEOUT (10000ms) to trigger the internal timeout rejection in sendDashboardRaw
      await vi.advanceTimersByTimeAsync(10000);
      // The getDashboardConfirmToken catches the timeout error and returns null, then sendDashboard throws.
      // That throw is caught by callDashboard and classified.
      const result = await promise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Dashboard confirm token unavailable');
        expect(result.error.kind).toBe('unknown');
      }
      // Only the token-fetch IPC was attempted; the destructive delete IPC was never sent
      expect(hangingMock).toHaveBeenCalledTimes(1);
      expect(hangingMock.mock.calls[0][0].payload.subtype).toBe('create_confirm_token');

      vi.useRealTimers();
    });

    it('Given token fetch rejects with timeout message, When calling destructive op, Then it fail-closes without second IPC', async () => {
      // Immediate-reject variant that simulates the same logical outcome without waiting 10s
      const sendMessageMock = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') {
          throw new Error('Dashboard SQLite request timed out');
        }
        throw new Error('Destructive IPC must not be sent on token timeout');
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'delete', id: 10 } as any,
        () => undefined,
        'Delete failed',
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.message).toContain('Dashboard confirm token unavailable');
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // No retry
  // -------------------------------------------------------------------------
  describe('No retry: single null result, no second create_confirm_token call', () => {
    it('Given token fetch returns null once, When calling destructive op, Then it does NOT retry create_confirm_token', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        expect(msg.payload.subtype).toBe('create_confirm_token');
        return { success: false, error: 'no token' } as any;
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'clear_all' } as any,
        () => undefined,
        'Clear all failed',
      );

      expect(result.success).toBe(false);
      // Exactly one token attempt, no retry loop, no destructive IPC
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('Given token fetch hang times out once, When calling destructive op, Then exactly one token fetch is attempted', async () => {
      vi.useFakeTimers();
      const hangingMock = vi.fn(() => new Promise(() => {}));
      (globalThis as any).chrome.runtime.sendMessage = hangingMock;

      const gateway = new DashboardGateway();
      const promise = gateway.callDashboard(
        { subtype: 'migrate' } as any,
        () => undefined,
        'Migrate failed',
      );

      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(hangingMock).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Exempt ops: query/search bypass token check
  // -------------------------------------------------------------------------
  describe('Exempt ops: query/search bypass token check', () => {
    it('Given a query op (tokenExempt), When calling dashboard, Then it sends IPC without token and does NOT request create_confirm_token', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        expect(msg.payload.subtype).toBe('query');
        expect(msg.payload).not.toHaveProperty('confirmToken');
        expect(msg.type).toBe('DASHBOARD_SQLITE');
        expect(msg.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
        return { success: true, rows: [], total: 0 };
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'query', limit: 10 } as any,
        (res: any) => ({ rows: res.rows, total: res.total }),
        'Query failed',
      );

      expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      // Must not have asked for a token
      expect(sendMessageMock.mock.calls[0][0].payload.subtype).not.toBe('create_confirm_token');
    });

    it('Given a search op (tokenExempt), When calling dashboard, Then it sends IPC without token and does NOT request create_confirm_token', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        expect(msg.payload.subtype).toBe('search');
        expect(msg.payload).not.toHaveProperty('confirmToken');
        return { success: true, rows: [], total: 0 };
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'search', query: 'hello' } as any,
        (res: any) => ({ rows: res.rows, total: res.total }),
        'Search failed',
      );

      expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('Given other exempt ops (get_count, status, opfs_spike, audit_log_query), When calling dashboard, Then they bypass token check', async () => {
      const exemptCases: Array<{ payload: any; response: any; decode: (r: any) => any }> = [
        { payload: { subtype: 'get_count' }, response: { success: true, count: 5 }, decode: (r: any) => r.count },
        { payload: { subtype: 'status' }, response: { success: true, initialized: true, path: '', fallback: false, fts5: true }, decode: (r: any) => r.initialized },
        { payload: { subtype: 'opfs_spike' }, response: { success: true, report: { strategy: 'x', steps: [], passed: true, durationMs: 1 } }, decode: (r: any) => r.report },
        { payload: { subtype: 'audit_log_query' }, response: { success: true, rows: [], total: 0 }, decode: (r: any) => r.rows },
      ];

      for (const { payload, response, decode } of exemptCases) {
        const sendMessageMock = vi.fn(async (msg: any) => {
          expect(msg.payload.subtype).toBe(payload.subtype);
          expect(msg.payload).not.toHaveProperty('confirmToken');
          return response;
  // -------------------------------------------------------------------------
  // PBI 11: opt-in retry contract (moved from service-local withRetry)
  // -------------------------------------------------------------------------
  describe('Retry option: throw or retriable retries once, decode failure never', () => {
    it('Given the send throws once, When retryAttempts 2, Then it retries once and returns the decoded success', async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (msg: any) => {
          expect(msg.payload.subtype).toBe('query');
          calls += 1;
          if (calls === 1) throw new Error('SQLite request timed out');
          return { success: true, rows: [], total: 0 };
        });

        const gateway = new DashboardGateway();
        const promise = gateway.callDashboard(
          { subtype: 'query', limit: 10 } as any,
          (res: any) => ({ rows: res.rows, total: res.total }),
          'Query failed',
          { retryAttempts: 2, retryDelayMs: 1000 },
        );
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;

        expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
        expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('Given a retriable failure first, When retryAttempts 2, Then it retries once and returns the decoded success', async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async () => {
          calls += 1;
          if (calls === 1) return { success: false, error: 'DB locked', retriable: true };
          return { success: true, rows: [], total: 0 };
        });

        const gateway = new DashboardGateway();
        const promise = gateway.callDashboard(
          { subtype: 'search', query: 'hello' } as any,
          (res: any) => ({ rows: res.rows, total: res.total }),
          'Query failed',
          { retryAttempts: 2, retryDelayMs: 1000 },
        );
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;

        expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
        expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('Given a decode failure, When retryAttempts 2, Then it does NOT retry and returns the decode error', async () => {
      const sendMessageMock = vi.fn(async () => ({ success: true, rows: 'not-an-array', total: 0 }));
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'query' } as any,
        () => { throw new Error('Invalid SQLite response: rows'); },
        'Query failed',
        { retryAttempts: 2, retryDelayMs: 1000 },
      );

      expect(result).toEqual({
        success: false,
        error: { kind: 'unknown', message: 'Invalid SQLite response: rows', retriable: false },
      });
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('Given both attempts fail, When retryAttempts 2, Then it returns the classified final error', async () => {
      vi.useFakeTimers();
      try {
        (globalThis as any).chrome.runtime.sendMessage = vi.fn(async () => ({
          success: false, error: 'DB locked', retriable: true,
        }));

        const gateway = new DashboardGateway();
        const promise = gateway.callDashboard(
          { subtype: 'query' } as any,
          () => undefined,
          'Query failed',
          { retryAttempts: 2, retryDelayMs: 1000 },
        );
        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;

        expect(result).toEqual({
          success: false,
          error: { kind: 'unknown', message: 'DB locked', retriable: true },
        });
        expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
        (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

        const gateway = new DashboardGateway();
        const result = await gateway.callDashboard(payload, decode, 'failed');
        expect(result.success).toBe(true);
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
      }
    });

    it('Given create_confirm_token itself is exempt, When that subtype is called, Then it does not recurse into token fetch', async () => {
      const sendMessageMock = vi.fn(async (msg: any) => {
        expect(msg.payload.subtype).toBe('create_confirm_token');
        expect(msg.payload).not.toHaveProperty('confirmToken');
        return { success: true, confirmToken: 'new-token' };
      });
      (globalThis as any).chrome.runtime.sendMessage = sendMessageMock;

      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard(
        { subtype: 'create_confirm_token', action: 'delete', id: 1 } as any,
        (r: any) => r.confirmToken,
        'Create token failed',
      );

      expect(result).toEqual({ success: true, data: 'new-token' });
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Additional: error path classification and decode failure
  // -------------------------------------------------------------------------
  describe('Error classification and decode', () => {
    it('Given destructive op throws Dashboard confirm token unavailable, Then it is classified as unknown with the unavailable message', async () => {
      (globalThis as any).chrome.runtime.sendMessage = vi.fn(async (msg: any) => {
        if (msg.payload.subtype === 'create_confirm_token') return { success: false } as any;
        throw new Error('should not be called');
      });
      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard({ subtype: 'delete', id: 1 } as any, () => undefined, 'Delete failed');
      expect(result).toEqual({
        success: false,
        error: { kind: 'unknown', message: 'Unexpected error: Dashboard confirm token unavailable', retriable: false },
      });
    });

    it('Given exempt op returns failure response, Then it returns the response error as unknown retriable false', async () => {
      (globalThis as any).chrome.runtime.sendMessage = vi.fn(async () => ({ success: false, error: 'DB locked' }));
      const gateway = new DashboardGateway();
      const result = await gateway.callDashboard({ subtype: 'query' } as any, () => undefined, 'Query failed');
      expect(result).toEqual({ success: false, error: { kind: 'unknown', message: 'DB locked', retriable: false } });
    });
  });
});
