/**
 * Shared test helper for dashboardSqliteService tests.
 *
 * PBI 2026-09-04-01: the confirm-token fail-closed change (PBI 03-v1) made
 * destructive dashboard SQLite ops a 2-step handshake — sendMessage first
 * carries `create_confirm_token`, then the operation with the token attached.
 * Tests that scripted a single response must now route by subtype:
 * the handshake call returns a fixed token, the operation call returns the
 * scripted response (or rejects).
 */

import { vi } from 'vitest';

export interface HandshakeMock {
  /** Raw list of sendMessage calls (message payloads in order). */
  calls: any[];
}

/**
 * Install a sendMessage mock that answers `create_confirm_token` with a
 * fixed token and every other subtype with the scripted response.
 */
export function givenHandshakeResponse(response: any): HandshakeMock {
  const calls: any[] = [];
  const mock = vi.fn((message: any) => {
    calls.push(message);
    const subtype = message?.payload?.subtype;
    if (subtype === 'create_confirm_token') {
      return Promise.resolve({ success: true, confirmToken: 'test-confirm-token' });
    }
    return Promise.resolve(response);
  });
  (globalThis as any).chrome.runtime.sendMessage = mock;
  return { calls };
}

/**
 * Install a handshake-aware sendMessage mock that rejects for operation calls
 * (simulating lastError / connection failure). The handshake itself succeeds.
 */
export function givenHandshakeError(errorMessage: string): HandshakeMock {
  const calls: any[] = [];
  const mock = vi.fn((message: any) => {
    calls.push(message);
    const subtype = message?.payload?.subtype;
    if (subtype === 'create_confirm_token') {
      return Promise.resolve({ success: true, confirmToken: 'test-confirm-token' });
    }
    return Promise.reject(new Error(errorMessage));
  });
  (globalThis as any).chrome.runtime.sendMessage = mock;
  return { calls };
}
